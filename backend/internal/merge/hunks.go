package merge

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

// HunkKind describes how a section changed relative to its common base.
type HunkKind string

const (
	HunkUnchanged      HunkKind = "unchanged"
	HunkSuggestionOnly HunkKind = "suggestion_only"
	HunkLiveOnly       HunkKind = "live_only"
	HunkBothSame       HunkKind = "both_same"
	HunkConflict       HunkKind = "conflict"
)

// HunkSide identifies a version a reviewer can select.
type HunkSide string

const (
	SideSuggestion HunkSide = "suggestion"
	SideLive       HunkSide = "live"
)

// Hunk is one independently reviewable change to a page field.
type Hunk struct {
	ID              string   `json:"id"`
	Kind            HunkKind `json:"kind"`
	Field           string   `json:"field"`
	PropsKey        string   `json:"props_key,omitempty"`
	BaseLines       []string `json:"base_lines,omitempty"`
	LiveLines       []string `json:"live_lines,omitempty"`
	SuggestionLines []string `json:"suggestion_lines,omitempty"`
	Default         HunkSide `json:"default"`
}

// HunksSummary counts returned hunks by kind.
type HunksSummary struct {
	SuggestionOnly int `json:"suggestion_only"`
	LiveOnly       int `json:"live_only"`
	BothSame       int `json:"both_same"`
	Conflict       int `json:"conflict"`
}

type bodyHunk struct {
	Hunk
	baseLo, baseHi             int
	liveLo, liveHi             int
	suggestionLo, suggestionHi int
}

// ComputeHunks reports every changed body region and changed title or props
// field. The live page is "current" and the suggestion is "incoming" in the
// terminology used by Merge3.
func ComputeHunks(baseBody, liveBody, suggestionBody string, baseTitle, liveTitle, suggestionTitle string, baseProps, liveProps, suggestionProps map[string]any) ([]Hunk, HunksSummary) {
	body := computeBodyHunks(baseBody, liveBody, suggestionBody)
	hunks := make([]Hunk, 0, len(body)+1)
	for _, h := range body {
		hunks = append(hunks, h.Hunk)
	}

	if kind := scalarHunkKind(baseTitle, liveTitle, suggestionTitle); kind != HunkUnchanged {
		hunks = append(hunks, Hunk{
			ID: "title", Kind: kind, Field: "title",
			BaseLines: []string{baseTitle}, LiveLines: []string{liveTitle}, SuggestionLines: []string{suggestionTitle},
			Default: defaultFor(kind),
		})
	}

	for _, key := range unionKeys(baseProps, liveProps, suggestionProps) {
		bv, bok := baseProps[key]
		lv, lok := liveProps[key]
		sv, sok := suggestionProps[key]
		kind := valueHunkKind(bv, bok, lv, lok, sv, sok)
		if kind == HunkUnchanged {
			continue
		}
		hunks = append(hunks, Hunk{
			ID: "props:" + key, Kind: kind, Field: "props", PropsKey: key,
			BaseLines: jsonValueLines(bv, bok), LiveLines: jsonValueLines(lv, lok), SuggestionLines: jsonValueLines(sv, sok),
			Default: defaultFor(kind),
		})
	}
	return hunks, summarize(hunks)
}

func computeBodyHunks(base, live, suggestion string) []bodyHunk {
	o, a, b := splitLines(base), splitLines(live), splitLines(suggestion)
	atA, atB := alignment(o, a), alignment(o, b)
	regions := append(diffRegions(o, a, 0), diffRegions(o, b, 1)...)
	sort.Slice(regions, func(i, j int) bool {
		if regions[i].baseLo != regions[j].baseLo {
			return regions[i].baseLo < regions[j].baseLo
		}
		if regions[i].baseHi != regions[j].baseHi {
			return regions[i].baseHi < regions[j].baseHi
		}
		return regions[i].side < regions[j].side
	})

	var out []bodyHunk
	for i := 0; i < len(regions); {
		lo, hi := regions[i].baseLo, regions[i].baseHi
		j := i + 1
		for j < len(regions) && regions[j].baseLo < hi {
			if regions[j].baseHi > hi {
				hi = regions[j].baseHi
			}
			j++
		}

		liveLo, liveHi := spanInOther(atA, lo, hi, len(a))
		suggestionLo, suggestionHi := spanInOther(atB, lo, hi, len(b))
		if j == i+1 {
			r := regions[i]
			if r.side == 0 {
				liveLo, liveHi = r.sideLo, r.sideHi
			} else {
				suggestionLo, suggestionHi = r.sideLo, r.sideHi
			}
		}
		kind := lineHunkKind(o[lo:hi], a[liveLo:liveHi], b[suggestionLo:suggestionHi])
		out = append(out, bodyHunk{
			Hunk: Hunk{
				ID: fmt.Sprintf("body:%d:%d", lo, hi), Kind: kind, Field: "body",
				BaseLines: cloneLines(o[lo:hi]), LiveLines: cloneLines(a[liveLo:liveHi]), SuggestionLines: cloneLines(b[suggestionLo:suggestionHi]),
				Default: defaultFor(kind),
			},
			baseLo: lo, baseHi: hi,
			liveLo: liveLo, liveHi: liveHi,
			suggestionLo: suggestionLo, suggestionHi: suggestionHi,
		})
		i = j
	}
	return out
}

// ApplyHunkChoices merges fields by applying reviewer choices. A conflicting
// hunk needs an explicit valid choice; callers must reject the result when
// unresolved is non-empty.
func ApplyHunkChoices(baseBody, liveBody, suggestionBody string, baseTitle, liveTitle, suggestionTitle string, baseProps, liveProps, suggestionProps map[string]any, choices map[string]HunkSide) (mergedBody, mergedTitle string, mergedProps map[string]any, applied []string, skipped []string, unresolved []string) {
	bodyHunks := computeBodyHunks(baseBody, liveBody, suggestionBody)
	var out []string
	baseLines, liveLines, suggestionLines := splitLines(baseBody), splitLines(liveBody), splitLines(suggestionBody)
	baseIdx := 0
	for _, h := range bodyHunks {
		out = append(out, baseLines[baseIdx:h.baseLo]...)
		side, ok := chooseHunk(h.Hunk, choices)
		if !ok {
			unresolved = append(unresolved, h.ID)
			out = append(out, h.BaseLines...)
		} else if side == SideLive {
			out = append(out, liveLines[h.liveLo:h.liveHi]...)
			applied, skipped = recordChoice(h.Hunk, side, applied, skipped)
		} else {
			out = append(out, suggestionLines[h.suggestionLo:h.suggestionHi]...)
			applied, skipped = recordChoice(h.Hunk, side, applied, skipped)
		}
		baseIdx = h.baseHi
	}
	out = append(out, baseLines[baseIdx:]...)
	mergedBody = strings.Join(out, "\n")

	if kind := scalarHunkKind(baseTitle, liveTitle, suggestionTitle); kind == HunkUnchanged {
		mergedTitle = baseTitle
	} else {
		h := Hunk{ID: "title", Kind: kind, Field: "title", Default: defaultFor(kind)}
		if side, ok := chooseHunk(h, choices); ok {
			if side == SideLive {
				mergedTitle = liveTitle
			} else {
				mergedTitle = suggestionTitle
			}
			applied, skipped = recordChoice(h, side, applied, skipped)
		} else {
			mergedTitle = baseTitle
			unresolved = append(unresolved, h.ID)
		}
	}

	mergedProps = map[string]any{}
	for _, key := range unionKeys(baseProps, liveProps, suggestionProps) {
		bv, bok := baseProps[key]
		lv, lok := liveProps[key]
		sv, sok := suggestionProps[key]
		kind := valueHunkKind(bv, bok, lv, lok, sv, sok)
		if kind == HunkUnchanged {
			if bok {
				mergedProps[key] = bv
			}
			continue
		}
		h := Hunk{ID: "props:" + key, Kind: kind, Field: "props", PropsKey: key, Default: defaultFor(kind)}
		side, ok := chooseHunk(h, choices)
		if !ok {
			unresolved = append(unresolved, h.ID)
			if bok {
				mergedProps[key] = bv
			}
			continue
		}
		if side == SideLive {
			if lok {
				mergedProps[key] = lv
			}
		} else if sok {
			mergedProps[key] = sv
		}
		applied, skipped = recordChoice(h, side, applied, skipped)
	}
	return mergedBody, mergedTitle, mergedProps, applied, skipped, unresolved
}

func lineHunkKind(base, live, suggestion []string) HunkKind {
	return valueHunkKind(base, true, live, true, suggestion, true)
}

func scalarHunkKind(base, live, suggestion string) HunkKind {
	return valueHunkKind(base, true, live, true, suggestion, true)
}

func valueHunkKind(base any, baseOK bool, live any, liveOK bool, suggestion any, suggestionOK bool) HunkKind {
	liveChanged := !sameVal(base, baseOK, live, liveOK)
	suggestionChanged := !sameVal(base, baseOK, suggestion, suggestionOK)
	switch {
	case !liveChanged && !suggestionChanged:
		return HunkUnchanged
	case !liveChanged:
		return HunkSuggestionOnly
	case !suggestionChanged:
		return HunkLiveOnly
	case sameVal(live, liveOK, suggestion, suggestionOK):
		return HunkBothSame
	default:
		return HunkConflict
	}
}

func defaultFor(kind HunkKind) HunkSide {
	if kind == HunkLiveOnly {
		return SideLive
	}
	return SideSuggestion
}

func chooseHunk(h Hunk, choices map[string]HunkSide) (HunkSide, bool) {
	if h.Kind == HunkConflict {
		side, ok := choices[h.ID]
		return side, ok && (side == SideLive || side == SideSuggestion)
	}
	if side, ok := choices[h.ID]; ok && (side == SideLive || side == SideSuggestion) {
		return side, true
	}
	return h.Default, true
}

func recordChoice(h Hunk, side HunkSide, applied, skipped []string) ([]string, []string) {
	if (h.Kind == HunkSuggestionOnly && side == SideLive) || (h.Kind == HunkLiveOnly && side == SideSuggestion) {
		return applied, append(skipped, h.ID)
	}
	return append(applied, h.ID), skipped
}

func summarize(hunks []Hunk) (summary HunksSummary) {
	for _, h := range hunks {
		switch h.Kind {
		case HunkSuggestionOnly:
			summary.SuggestionOnly++
		case HunkLiveOnly:
			summary.LiveOnly++
		case HunkBothSame:
			summary.BothSame++
		case HunkConflict:
			summary.Conflict++
		}
	}
	return summary
}

func jsonValueLines(value any, ok bool) []string {
	if !ok {
		return nil
	}
	data, err := json.Marshal(value)
	if err != nil {
		return []string{fmt.Sprintf("%v", value)}
	}
	return []string{string(data)}
}
