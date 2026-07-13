// Package macromd parses macro-def and macro directive blocks from canonical
// page markdown. Macro definitions (`:::macro-def{id=…}`) hold reusable content;
// macro references (`:::macro{id=…}` or `:::macro{page=…}`) are live includes on
// consumer pages. Votes live in pages.body — this package is pure text surgery
// for indexing and validation on save.
package macromd

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

var (
	// ErrDuplicateMacroID — the same macro id appears more than once in one body.
	ErrDuplicateMacroID = errors.New("duplicate macro id in page body")
	// ErrEmptyMacroID — a macro-def block has no id attribute.
	ErrEmptyMacroID = errors.New("macro-def missing id")
)

// MacroDef is a macro definition block extracted from a page body.
type MacroDef struct {
	ID   string
	Body string
}

// MacroRef is an outgoing macro include from a consumer page.
type MacroRef struct {
	MacroID      string
	TargetPageID int64 // >0 for whole-page includes
}

// ParseMacroDefs returns every `:::macro-def{id=…}` block in body with its inner
// markdown (without the wrapper fences). Order follows document order.
func ParseMacroDefs(body string) ([]MacroDef, error) {
	lines := splitLines(body)
	var out []MacroDef
	seen := make(map[string]struct{})
	for i := 0; i < len(lines); i++ {
		t := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(t, ":::macro-def") {
			continue
		}
		id := attrValue(t, "id")
		if id == "" {
			return nil, ErrEmptyMacroID
		}
		if _, ok := seen[id]; ok {
			return nil, fmt.Errorf("%w: %s", ErrDuplicateMacroID, id)
		}
		seen[id] = struct{}{}
		close := -1
		for j := i + 1; j < len(lines); j++ {
			if strings.TrimSpace(lines[j]) == ":::" {
				close = j
				break
			}
		}
		if close < 0 {
			continue // unterminated — skip (degraded markdown)
		}
		inner := strings.Join(lines[i+1:close], "\n")
		out = append(out, MacroDef{ID: id, Body: inner})
		i = close
	}
	return out, nil
}

// ParseMacroRefs returns every `:::macro{…}` reference in body (block id or page).
func ParseMacroRefs(body string) []MacroRef {
	lines := splitLines(body)
	var out []MacroRef
	seen := make(map[string]struct{})
	for i := 0; i < len(lines); i++ {
		t := strings.TrimSpace(lines[i])
		if !strings.HasPrefix(t, ":::macro") || strings.HasPrefix(t, ":::macro-def") {
			continue
		}
		macroID := attrValue(t, "id")
		pageStr := attrValue(t, "page")
		if macroID != "" {
			key := "m:" + macroID
			if _, ok := seen[key]; !ok {
				seen[key] = struct{}{}
				out = append(out, MacroRef{MacroID: macroID})
			}
		} else if pageStr != "" {
			if pid, err := strconv.ParseInt(pageStr, 10, 64); err == nil && pid > 0 {
				key := fmt.Sprintf("p:%d", pid)
				if _, ok := seen[key]; !ok {
					seen[key] = struct{}{}
					out = append(out, MacroRef{TargetPageID: pid})
				}
			}
		}
		// Skip optional body until closing fence.
		for j := i + 1; j < len(lines); j++ {
			if strings.TrimSpace(lines[j]) == ":::" {
				i = j
				break
			}
		}
	}
	return out
}

func splitLines(body string) []string {
	nl := "\n"
	if strings.Contains(body, "\r\n") {
		body = strings.ReplaceAll(body, "\r\n", "\n")
	}
	return strings.Split(body, nl)
}

// attrValue extracts a named attribute from a directive opening line's `{…}` block.
func attrValue(line, key string) string {
	l, r := strings.IndexByte(line, '{'), strings.LastIndexByte(line, '}')
	if l < 0 || r <= l {
		return ""
	}
	inner := line[l+1 : r]
	for _, tok := range strings.Fields(inner) {
		if !strings.HasPrefix(tok, key+"=") {
			continue
		}
		return strings.Trim(tok[len(key)+1:], `"'`)
	}
	return ""
}
