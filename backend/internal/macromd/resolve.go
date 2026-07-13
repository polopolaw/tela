package macromd

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// MaxResolveDepth matches the frontend macro include depth guard.
const MaxResolveDepth = 8

var (
	ErrResolveDepth = errors.New("macro resolve depth exceeded")
)

// MacroSource fetches macro inner bodies and page bodies for live resolution.
type MacroSource interface {
	MacroInnerBody(macroID string) (body string, found bool, err error)
	PageBody(pageID int64) (body string, found bool, err error)
}

// ResolveMacros expands :::macro{…} includes and unwraps :::macro-def blocks to
// their inner markdown. Macro/page cycles are replaced with HTML comments.
func ResolveMacros(body string, src MacroSource) (string, error) {
	return resolveBody(body, src, 0, map[string]struct{}{}, map[int64]struct{}{})
}

func resolveBody(
	body string,
	src MacroSource,
	depth int,
	visitedMacros map[string]struct{},
	visitedPages map[int64]struct{},
) (string, error) {
	if depth >= MaxResolveDepth {
		return "", ErrResolveDepth
	}
	nl := "\n"
	if strings.Contains(body, "\r\n") {
		nl = "\r\n"
	}
	lines := splitLines(body)
	out := make([]string, 0, len(lines))
	for i := 0; i < len(lines); i++ {
		t := strings.TrimSpace(lines[i])
		if strings.HasPrefix(t, ":::macro-def") {
			close, ok := macroBlockClose(lines, i)
			if !ok {
				out = append(out, lines[i])
				continue
			}
			inner := strings.Join(lines[i+1:close], nl)
			resolved, err := resolveBody(inner, src, depth, visitedMacros, visitedPages)
			if err != nil {
				return "", err
			}
			if resolved != "" {
				out = append(out, strings.Split(resolved, nl)...)
			}
			i = close
			continue
		}
		if strings.HasPrefix(t, ":::macro") && !strings.HasPrefix(t, ":::macro-def") {
			macroID := attrValue(t, "id")
			pageStr := attrValue(t, "page")
			close, ok := macroBlockClose(lines, i)
			if !ok {
				out = append(out, lines[i])
				continue
			}
			if macroID != "" {
				if _, seen := visitedMacros[macroID]; seen {
					out = append(out, fmt.Sprintf("<!-- circular macro include: %s -->", macroID))
					i = close
					continue
				}
				visitedMacros[macroID] = struct{}{}
				inner, found, err := src.MacroInnerBody(macroID)
				if err != nil {
					delete(visitedMacros, macroID)
					return "", err
				}
				if !found {
					out = append(out, fmt.Sprintf("<!-- macro not found: %s -->", macroID))
				} else {
					resolved, err := resolveBody(inner, src, depth+1, visitedMacros, visitedPages)
					if err != nil {
						delete(visitedMacros, macroID)
						return "", err
					}
					if resolved != "" {
						out = append(out, strings.Split(resolved, nl)...)
					}
				}
				delete(visitedMacros, macroID)
			} else if pageStr != "" {
				pageID, err := strconv.ParseInt(pageStr, 10, 64)
				if err != nil || pageID <= 0 {
					out = append(out, fmt.Sprintf("<!-- invalid page include: %s -->", pageStr))
				} else if _, seen := visitedPages[pageID]; seen {
					out = append(out, fmt.Sprintf("<!-- circular page include: %d -->", pageID))
				} else {
					visitedPages[pageID] = struct{}{}
					inner, found, err := src.PageBody(pageID)
					if err != nil {
						delete(visitedPages, pageID)
						return "", err
					}
					if !found {
						out = append(out, fmt.Sprintf("<!-- page not found: %d -->", pageID))
					} else {
						resolved, err := resolveBody(inner, src, depth+1, visitedMacros, visitedPages)
						if err != nil {
							delete(visitedPages, pageID)
							return "", err
						}
						if resolved != "" {
							out = append(out, strings.Split(resolved, nl)...)
						}
					}
					delete(visitedPages, pageID)
				}
			}
			i = close
			continue
		}
		out = append(out, lines[i])
	}
	return strings.Join(out, nl), nil
}

func macroBlockClose(lines []string, start int) (close int, ok bool) {
	for j := start + 1; j < len(lines); j++ {
		if strings.TrimSpace(lines[j]) == ":::" {
			return j, true
		}
	}
	return start, false
}
