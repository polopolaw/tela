package merge

import (
	"reflect"
	"testing"
)

func TestComputeHunks_SuggestionOnlyBody(t *testing.T) {
	hunks, summary := ComputeHunks("a\nb\nc\n", "a\nb\nc\n", "a\nB\nc\n", "", "", "", nil, nil, nil)
	if len(hunks) != 1 || hunks[0].Kind != HunkSuggestionOnly || hunks[0].ID != "body:1:2" {
		t.Fatalf("hunks = %+v, want one suggestion-only body hunk", hunks)
	}
	if hunks[0].Default != SideSuggestion || summary.SuggestionOnly != 1 {
		t.Fatalf("hunk/default/summary = %+v/%+v, want suggestion default and count", hunks[0], summary)
	}
}

func TestComputeHunks_LiveOnlyBody(t *testing.T) {
	hunks, summary := ComputeHunks("a\nb\nc\n", "a\nB\nc\n", "a\nb\nc\n", "", "", "", nil, nil, nil)
	if len(hunks) != 1 || hunks[0].Kind != HunkLiveOnly || hunks[0].Default != SideLive {
		t.Fatalf("hunks = %+v, want one live-only body hunk", hunks)
	}
	if summary.LiveOnly != 1 {
		t.Fatalf("summary = %+v, want one live-only hunk", summary)
	}
}

func TestComputeHunks_ConflictBody(t *testing.T) {
	hunks, summary := ComputeHunks("a\nb\nc\n", "a\nL\nc\n", "a\nS\nc\n", "", "", "", nil, nil, nil)
	if len(hunks) != 1 || hunks[0].Kind != HunkConflict || hunks[0].Default != SideSuggestion {
		t.Fatalf("hunks = %+v, want one conflict body hunk", hunks)
	}
	if summary.Conflict != 1 {
		t.Fatalf("summary = %+v, want one conflict", summary)
	}
}

func TestComputeHunks_BothSame(t *testing.T) {
	hunks, summary := ComputeHunks("a\nb\nc\n", "a\nX\nc\n", "a\nX\nc\n", "", "", "", nil, nil, nil)
	if len(hunks) != 1 || hunks[0].Kind != HunkBothSame || summary.BothSame != 1 {
		t.Fatalf("hunks/summary = %+v/%+v, want one same change", hunks, summary)
	}
}

func TestApplyHunkChoices_PartialSuggestionApply(t *testing.T) {
	base := "a\nb\nc\nd\n"
	suggestion := "a\nB\nc\nD\n"
	merged, _, _, applied, skipped, unresolved := ApplyHunkChoices(
		base, base, suggestion, "", "", "", nil, nil, nil,
		map[string]HunkSide{"body:3:4": SideLive},
	)
	if merged != "a\nB\nc\nd\n" {
		t.Fatalf("merged body = %q, want only first suggestion", merged)
	}
	if !reflect.DeepEqual(applied, []string{"body:1:2"}) || !reflect.DeepEqual(skipped, []string{"body:3:4"}) || len(unresolved) != 0 {
		t.Fatalf("applied/skipped/unresolved = %v/%v/%v", applied, skipped, unresolved)
	}
}

func TestApplyHunkChoices_UnresolvedConflict(t *testing.T) {
	_, _, _, _, _, unresolved := ApplyHunkChoices(
		"a\nb\n", "a\nL\n", "a\nS\n", "", "", "", nil, nil, nil, nil,
	)
	if !reflect.DeepEqual(unresolved, []string{"body:1:2"}) {
		t.Fatalf("unresolved = %v, want body conflict", unresolved)
	}
}

func TestApplyHunkChoices_TitleConflict(t *testing.T) {
	_, title, _, applied, _, unresolved := ApplyHunkChoices(
		"", "", "", "base", "live", "suggestion", nil, nil, nil,
		map[string]HunkSide{"title": SideLive},
	)
	if title != "live" || !reflect.DeepEqual(applied, []string{"title"}) || len(unresolved) != 0 {
		t.Fatalf("title/applied/unresolved = %q/%v/%v", title, applied, unresolved)
	}
}

func TestApplyHunkChoices_ConflictResolved(t *testing.T) {
	merged, _, _, applied, _, unresolved := ApplyHunkChoices(
		"a\nb\n", "a\nL\n", "a\nS\n", "", "", "", nil, nil, nil,
		map[string]HunkSide{"body:1:2": SideSuggestion},
	)
	if merged != "a\nS\n" || !reflect.DeepEqual(applied, []string{"body:1:2"}) || len(unresolved) != 0 {
		t.Fatalf("merged/applied/unresolved = %q/%v/%v", merged, applied, unresolved)
	}
}

func TestApplyHunkChoices_PropsConflict(t *testing.T) {
	_, _, props, applied, _, unresolved := ApplyHunkChoices(
		"", "", "", "", "", "",
		map[string]any{"state": "draft"},
		map[string]any{"state": "live"},
		map[string]any{"state": "suggested"},
		map[string]HunkSide{"props:state": SideSuggestion},
	)
	if props["state"] != "suggested" || !reflect.DeepEqual(applied, []string{"props:state"}) || len(unresolved) != 0 {
		t.Fatalf("props/applied/unresolved = %+v/%v/%v", props, applied, unresolved)
	}
}
