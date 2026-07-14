package api

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/zcag/tela/backend/internal/auth"
)

// TestPageSuggestions_FullFlow exercises the page-suggestions REST surface
// end-to-end through the wired stack: viewer create + live unchanged, no-op
// guard, membership gating, editor-only hunks, apply/reject/withdraw paths,
// conflict resolution, and read-scope API key carve-outs.
func TestPageSuggestions_FullFlow(t *testing.T) {
	// Pin the API-key HMAC secret BEFORE newWiredServer — InitAPIKeySecret /
	// middleware may load it once, and Reset after the fact races with that.
	t.Setenv("TELA_API_KEY_SECRET", "deadbeef00112233445566778899aabbccddeeff00112233445566778899aabb")
	auth.ResetAPIKeySecretCache()

	ts, d := newWiredServer(t)
	admin := seedUser(t, d, "admin", "adminpw12", true)
	bob := seedUser(t, d, "bob", "bobpw1234", false)     // viewer
	carol := seedUser(t, d, "carol", "carolpw12", false) // editor
	_ = seedUser(t, d, "dave", "davepw1234", false)      // non-member
	space := seedSpace(t, d, "Test Space", "test-space", admin)
	seedMember(t, d, space, bob, roleViewer)
	seedMember(t, d, space, carol, roleEditor)

	pageSimple := seedPageInSpace(t, d, space, nil, "Simple", "hello world")
	pageConflict := seedPageInSpace(t, d, space, nil, "Conflict", "a\nb\nc")
	pageNoop := seedPageInSpace(t, d, space, nil, "Noop", "alpha\nbeta\ngamma")
	pageReview := seedPageInSpace(t, d, space, nil, "Review", "review body")

	adminC := loginClient(t, ts, "admin", "adminpw12")
	bobC := loginClient(t, ts, "bob", "bobpw1234")
	carolC := loginClient(t, ts, "carol", "carolpw12")
	daveC := loginClient(t, ts, "dave", "davepw1234")

	simpleCreateURL := fmt.Sprintf("%s/api/pages/%d/suggestions", ts.URL, pageSimple)
	simplePageURL := fmt.Sprintf("%s/api/pages/%d", ts.URL, pageSimple)
	revisionsURL := fmt.Sprintf("%s/api/pages/%d/revisions", ts.URL, pageSimple)

	// 1. non-member cannot create.
	resp, _ := postJSON(daveC, simpleCreateURL, `{"body":"x"}`)
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(string(body), `"code":"forbidden"`) {
		t.Fatalf("non-member create status=%d body=%s want 403 forbidden", resp.StatusCode, body)
	}

	// 2. identical body → 400 no_changes.
	resp, _ = postJSON(bobC, simpleCreateURL, `{"body":"hello world"}`)
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), `"code":"no_changes"`) {
		t.Fatalf("no-op create status=%d body=%s want 400 no_changes", resp.StatusCode, body)
	}

	// 3. viewer creates a real suggestion; live body stays put.
	simpleSuggestionID := mustCreateSuggestion(t, bobC, simpleCreateURL, `{"body":"hello universe","summary":"wider greeting"}`)
	if got := getPageField(t, bobC, simplePageURL, "body"); got != "hello world" {
		t.Fatalf("live body after create = %q, want unchanged hello world", got)
	}

	// 4. member list/get.
	listURL := simpleCreateURL
	resp, _ = bobC.Get(listURL)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("list status=%d body=%s", resp.StatusCode, b)
	}
	var listed struct {
		Suggestions []struct {
			ID     int64  `json:"id"`
			Status string `json:"status"`
		} `json:"suggestions"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&listed); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	resp.Body.Close()
	if len(listed.Suggestions) != 1 || listed.Suggestions[0].ID != simpleSuggestionID || listed.Suggestions[0].Status != "open" {
		t.Fatalf("listed=%+v want one open suggestion id=%d", listed.Suggestions, simpleSuggestionID)
	}

	resp, _ = bobC.Get(fmt.Sprintf("%s/api/suggestions/%d", ts.URL, simpleSuggestionID))
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("get suggestion status=%d body=%s", resp.StatusCode, b)
	}
	var gotOne struct {
		Suggestion struct {
			ID   int64  `json:"id"`
			Body string `json:"body"`
		} `json:"suggestion"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&gotOne); err != nil {
		t.Fatalf("decode get: %v", err)
	}
	resp.Body.Close()
	if gotOne.Suggestion.ID != simpleSuggestionID || gotOne.Suggestion.Body != "hello universe" {
		t.Fatalf("got suggestion=%+v", gotOne.Suggestion)
	}

	// 5. hunks require editor+.
	resp, _ = bobC.Get(fmt.Sprintf("%s/api/suggestions/%d/hunks", ts.URL, simpleSuggestionID))
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(string(body), `"code":"forbidden"`) {
		t.Fatalf("viewer hunks status=%d body=%s want 403", resp.StatusCode, body)
	}

	resp, _ = carolC.Get(fmt.Sprintf("%s/api/suggestions/%d/hunks", ts.URL, simpleSuggestionID))
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("editor hunks status=%d body=%s", resp.StatusCode, b)
	}
	resp.Body.Close()

	// 6. full apply as editor → approved, page updated, revision source=suggestion.
	applyURL := fmt.Sprintf("%s/api/suggestions/%d/apply", ts.URL, simpleSuggestionID)
	resp, _ = postJSON(carolC, applyURL, `{"mode":"full"}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("apply status=%d body=%s", resp.StatusCode, b)
	}
	var applied struct {
		Suggestion struct {
			Status       string   `json:"status"`
			AppliedHunks []string `json:"applied_hunks"`
		} `json:"suggestion"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&applied); err != nil {
		t.Fatalf("decode apply: %v", err)
	}
	resp.Body.Close()
	if applied.Suggestion.Status != "approved" {
		t.Fatalf("suggestion status=%q want approved", applied.Suggestion.Status)
	}
	if len(applied.Suggestion.AppliedHunks) == 0 {
		t.Fatalf("applied_hunks want non-empty array, got %v", applied.Suggestion.AppliedHunks)
	}
	if got := getPageField(t, carolC, simplePageURL, "body"); got != "hello universe" {
		t.Fatalf("page body after apply = %q want hello universe", got)
	}
	revs := getRevisions(t, adminC, revisionsURL)
	if len(revs) != 1 {
		t.Fatalf("revisions after apply = %d want 1", len(revs))
	}
	if revs[0].Source != "suggestion" {
		t.Fatalf("revision source=%q want suggestion", revs[0].Source)
	}

	// 7. conflict path: snapshot base, diverge live, require explicit choice.
	conflictPageURL := fmt.Sprintf("%s/api/pages/%d", ts.URL, pageConflict)
	conflictCreateURL := fmt.Sprintf("%s/api/pages/%d/suggestions", ts.URL, pageConflict)
	resp, _ = patchJSON(carolC, conflictPageURL, `{"body":"a\nBASE\nc"}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("seed base revision status=%d body=%s", resp.StatusCode, b)
	}
	resp.Body.Close()

	conflictSuggestionID := mustCreateSuggestion(t, bobC, conflictCreateURL, `{"body":"a\nSUGGEST\nc"}`)
	resp, _ = patchJSON(carolC, conflictPageURL, `{"body":"a\nLIVE\nc"}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("diverge live status=%d body=%s", resp.StatusCode, b)
	}
	resp.Body.Close()

	conflictApplyURL := fmt.Sprintf("%s/api/suggestions/%d/apply", ts.URL, conflictSuggestionID)
	resp, _ = postJSON(carolC, conflictApplyURL, `{"mode":"full"}`)
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusConflict || !strings.Contains(string(body), `"code":"unresolved_hunks"`) {
		t.Fatalf("apply without choices status=%d body=%s want 409 unresolved_hunks", resp.StatusCode, body)
	}

	resp, _ = postJSON(carolC, conflictApplyURL, `{"mode":"full","choices":{"body:1:2":"suggestion"}}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("apply with choice status=%d body=%s", resp.StatusCode, b)
	}
	resp.Body.Close()
	if got := getPageField(t, carolC, conflictPageURL, "body"); got != "a\nSUGGEST\nc" {
		t.Fatalf("conflict-resolved body = %q want a\\nSUGGEST\\nc", got)
	}

	// 8. no_effective_changes when reviewer keeps live for the only hunk.
	noopCreateURL := fmt.Sprintf("%s/api/pages/%d/suggestions", ts.URL, pageNoop)
	noopSuggestionID := mustCreateSuggestion(t, bobC, noopCreateURL, `{"body":"alpha\nBETA\ngamma"}`)
	noopApplyURL := fmt.Sprintf("%s/api/suggestions/%d/apply", ts.URL, noopSuggestionID)
	resp, _ = postJSON(carolC, noopApplyURL, `{"mode":"partial","choices":{"body:1:2":"live"}}`)
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusBadRequest || !strings.Contains(string(body), `"code":"no_effective_changes"`) {
		t.Fatalf("keep-live apply status=%d body=%s want 400 no_effective_changes", resp.StatusCode, body)
	}

	// 9. reject (editor+) and withdraw (author only).
	reviewCreateURL := fmt.Sprintf("%s/api/pages/%d/suggestions", ts.URL, pageReview)
	rejectID := mustCreateSuggestion(t, bobC, reviewCreateURL, `{"body":"reject me"}`)
	withdrawID := mustCreateSuggestion(t, bobC, reviewCreateURL, `{"body":"withdraw me"}`)

	resp, _ = postJSON(carolC, fmt.Sprintf("%s/api/suggestions/%d/reject", ts.URL, rejectID), `{}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("reject status=%d body=%s", resp.StatusCode, b)
	}
	var rejected struct {
		Suggestion struct {
			ID     int64  `json:"id"`
			Status string `json:"status"`
		} `json:"suggestion"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&rejected); err != nil {
		t.Fatalf("decode reject: %v", err)
	}
	resp.Body.Close()
	if rejected.Suggestion.ID != rejectID || rejected.Suggestion.Status != "rejected" {
		t.Fatalf("reject response=%+v", rejected.Suggestion)
	}

	resp, _ = postJSON(carolC, fmt.Sprintf("%s/api/suggestions/%d/withdraw", ts.URL, withdrawID), `{}`)
	body, _ = io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden || !strings.Contains(string(body), "only the author") {
		t.Fatalf("non-author withdraw status=%d body=%s want 403", resp.StatusCode, body)
	}

	resp, _ = postJSON(bobC, fmt.Sprintf("%s/api/suggestions/%d/withdraw", ts.URL, withdrawID), `{}`)
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("author withdraw status=%d body=%s", resp.StatusCode, b)
	}
	var withdrawn struct {
		Suggestion struct {
			ID     int64  `json:"id"`
			Status string `json:"status"`
		} `json:"suggestion"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&withdrawn); err != nil {
		t.Fatalf("decode withdraw: %v", err)
	}
	resp.Body.Close()
	if withdrawn.Suggestion.ID != withdrawID || withdrawn.Suggestion.Status != "withdrawn" {
		t.Fatalf("withdraw response=%+v", withdrawn.Suggestion)
	}

	// 10. read-scope API key can POST create but cannot apply.
	rawKey, prefix, _, err := auth.NewAPIKey(auth.LoadAPIKeySecret())
	if err != nil {
		t.Fatalf("new api key: %v", err)
	}
	if _, err := d.ExecContext(context.Background(), `
		INSERT INTO api_keys (user_id, name, key_prefix, key_hmac, scope, space_id)
		VALUES ($1, 'read', $2, $3, $4, NULL)`,
		bob, prefix, auth.HMACAPIKey(auth.LoadAPIKeySecret(), rawKey), auth.ScopeRead); err != nil {
		t.Fatalf("seed read key: %v", err)
	}

	apiPage := seedPageInSpace(t, d, space, nil, "API", "api body")
	apiCreateURL := fmt.Sprintf("%s/api/pages/%d/suggestions", ts.URL, apiPage)
	r := bearerRequest(t, http.MethodPost, apiCreateURL, rawKey, `{"body":"api suggested"}`)
	if r.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(r.Body)
		t.Fatalf("read key create status=%d body=%s want 201", r.StatusCode, b)
	}
	var apiCreated struct {
		Suggestion struct {
			ID int64 `json:"id"`
		} `json:"suggestion"`
	}
	if err := json.NewDecoder(r.Body).Decode(&apiCreated); err != nil {
		t.Fatalf("decode api create: %v", err)
	}
	r.Body.Close()

	r = bearerRequest(t, http.MethodPost, fmt.Sprintf("%s/api/suggestions/%d/apply", ts.URL, apiCreated.Suggestion.ID), rawKey, `{"mode":"full"}`)
	body, _ = io.ReadAll(r.Body)
	r.Body.Close()
	if r.StatusCode != http.StatusForbidden || !strings.Contains(string(body), `"code":"api_key_scope"`) {
		t.Fatalf("read key apply status=%d body=%s want 403 api_key_scope", r.StatusCode, body)
	}
}

func mustCreateSuggestion(t *testing.T, c *http.Client, url, payload string) int64 {
	t.Helper()
	resp, err := postJSON(c, url, payload)
	if err != nil {
		t.Fatalf("post suggestion: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("create suggestion status=%d body=%s payload=%s", resp.StatusCode, b, payload)
	}
	var got struct {
		Suggestion struct {
			ID int64 `json:"id"`
		} `json:"suggestion"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode suggestion: %v", err)
	}
	return got.Suggestion.ID
}

func getPageField(t *testing.T, c *http.Client, url, field string) string {
	t.Helper()
	resp, err := c.Get(url)
	if err != nil {
		t.Fatalf("get page: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("get page status=%d body=%s", resp.StatusCode, b)
	}
	var got map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
		t.Fatalf("decode page: %v", err)
	}
	page, _ := got["page"].(map[string]any)
	v, _ := page[field].(string)
	return v
}
