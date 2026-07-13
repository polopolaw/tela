package macromd

import (
	"strings"
	"testing"
)

type stubMacroSource struct {
	macros map[string]string
	pages  map[int64]string
}

func (s stubMacroSource) MacroInnerBody(macroID string) (string, bool, error) {
	b, ok := s.macros[macroID]
	return b, ok, nil
}

func (s stubMacroSource) PageBody(pageID int64) (string, bool, error) {
	b, ok := s.pages[pageID]
	return b, ok, nil
}

func TestResolveMacros_BlockInclude(t *testing.T) {
	src := stubMacroSource{
		macros: map[string]string{
			"m_a": "**Hello** from macro",
		},
	}
	body := `Before

:::macro{id="m_a"}
:::

After`
	out, err := ResolveMacros(body, src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Before") || !strings.Contains(out, "**Hello** from macro") || !strings.Contains(out, "After") {
		t.Fatalf("got %q", out)
	}
	if strings.Contains(out, ":::macro{") {
		t.Fatalf("macro ref not expanded: %q", out)
	}
}

func TestResolveMacros_PageInclude(t *testing.T) {
	src := stubMacroSource{
		pages: map[int64]string{
			2: "# Included page\n\nSome text.",
		},
	}
	body := `:::macro{page=2}
:::`
	out, err := ResolveMacros(body, src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "Included page") || !strings.Contains(out, "Some text") {
		t.Fatalf("got %q", out)
	}
}

func TestResolveMacros_Nested(t *testing.T) {
	src := stubMacroSource{
		macros: map[string]string{
			"m_outer": ":::macro{id=\"m_inner\"}\n:::",
			"m_inner": "deep content",
		},
	}
	out, err := ResolveMacros(`:::macro{id="m_outer"}
:::`, src)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(out, "deep content") {
		t.Fatalf("got %q", out)
	}
}

func TestResolveMacros_UnwrapsMacroDef(t *testing.T) {
	src := stubMacroSource{}
	body := `:::macro-def{id="m_x"}
Inner **def**
:::`
	out, err := ResolveMacros(body, src)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(out, "macro-def") {
		t.Fatalf("wrapper leaked: %q", out)
	}
	if !strings.Contains(out, "Inner **def**") {
		t.Fatalf("got %q", out)
	}
}
