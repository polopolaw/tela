package macromd

import (
	"strings"
	"testing"
)

func TestParseMacroDefs(t *testing.T) {
	body := `# Page

:::macro-def{id="m_abc"}
### Hello
- one
:::

plain

:::macro-def{id="m_xyz"}
More content
:::
`
	defs, err := ParseMacroDefs(body)
	if err != nil {
		t.Fatal(err)
	}
	if len(defs) != 2 {
		t.Fatalf("got %d defs, want 2", len(defs))
	}
	if defs[0].ID != "m_abc" || !strings.Contains(defs[0].Body, "### Hello") {
		t.Fatalf("first def: %+v", defs[0])
	}
	if defs[1].ID != "m_xyz" {
		t.Fatalf("second id: %s", defs[1].ID)
	}
}

func TestParseMacroDefsDuplicate(t *testing.T) {
	body := `:::macro-def{id="dup"}
a
:::

:::macro-def{id="dup"}
b
:::`
	_, err := ParseMacroDefs(body)
	if err == nil || !strings.Contains(err.Error(), "duplicate") {
		t.Fatalf("want duplicate error, got %v", err)
	}
}

func TestNormalizeMacroDirectives(t *testing.T) {
	body := `:::macro-def{id="m_51aeed39fe" #m_c4bfa2f1c0}
Hello world 1
:::

:::macro{#m_b9712e3e8e}
:::

:::macro{#m_badc7e45d1}
:::`
	out := NormalizeMacroDirectives(body)
	if !strings.Contains(out, `:::macro-def{id="m_51aeed39fe"}`) {
		t.Fatalf("macro-def not normalized: %q", out)
	}
	if strings.Contains(out, "#m_c4bfa2f1c0") {
		t.Fatalf("confluence hash leaked: %q", out)
	}
	if !strings.Contains(out, `:::macro{id="m_b9712e3e8e"}`) || !strings.Contains(out, `:::macro{id="m_badc7e45d1"}`) {
		t.Fatalf("macro refs not normalized: %q", out)
	}
	defs, err := ParseMacroDefs(out)
	if err != nil {
		t.Fatal(err)
	}
	if len(defs) != 1 || defs[0].ID != "m_51aeed39fe" {
		t.Fatalf("defs: %+v", defs)
	}
	refs := ParseMacroRefs(out)
	if len(refs) != 2 || refs[0].MacroID != "m_b9712e3e8e" || refs[1].MacroID != "m_badc7e45d1" {
		t.Fatalf("refs: %+v", refs)
	}
}

func TestStampMacroDefIDs(t *testing.T) {
	body := `intro

:::macro-def
### Hello
- one
:::

tail`
	stamped := StampMacroDefIDs(body)
	if stamped == body {
		t.Fatal("expected body to change")
	}
	defs, err := ParseMacroDefs(stamped)
	if err != nil {
		t.Fatal(err)
	}
	if len(defs) != 1 || defs[0].ID == "" {
		t.Fatalf("stamped def: %+v", defs)
	}
	if !strings.Contains(defs[0].Body, "### Hello") {
		t.Fatalf("inner body: %q", defs[0].Body)
	}
}

func TestParseMacroRefs(t *testing.T) {
	body := `intro

:::macro{id="m_abc"}
:::

:::macro{page=42}
:::

:::macro-def{id="m_src"}
ignored
:::
`
	refs := ParseMacroRefs(body)
	if len(refs) != 2 {
		t.Fatalf("got %d refs, want 2", len(refs))
	}
	if refs[0].MacroID != "m_abc" || refs[0].TargetPageID != 0 {
		t.Fatalf("block ref: %+v", refs[0])
	}
	if refs[1].TargetPageID != 42 || refs[1].MacroID != "" {
		t.Fatalf("page ref: %+v", refs[1])
	}
}
