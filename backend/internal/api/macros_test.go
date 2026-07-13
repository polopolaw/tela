package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"github.com/zcag/tela/backend/internal/testdb"
)

func macroTestSpace(t *testing.T, d *sql.DB) (spaceID int64) {
	t.Helper()
	ctx := context.Background()
	if _, err := d.ExecContext(ctx, `INSERT INTO spaces(name, slug) VALUES ($1,$2)`, "Macros", "macros"); err != nil {
		t.Fatalf("seed space: %v", err)
	}
	if err := d.QueryRowContext(ctx, `SELECT id FROM spaces WHERE slug = 'macros'`).Scan(&spaceID); err != nil {
		t.Fatalf("read space: %v", err)
	}
	return spaceID
}

func macroTestPage(t *testing.T, d *sql.DB, spaceID int64, title, body string) int64 {
	t.Helper()
	ctx := context.Background()
	var id int64
	if err := d.QueryRowContext(ctx,
		`INSERT INTO pages(space_id, parent_id, title, body, position) VALUES ($1, NULL, $2, $3, 0) RETURNING id`,
		spaceID, title, body).Scan(&id); err != nil {
		t.Fatalf("insert page: %v", err)
	}
	return id
}

// TestSyncPageMacros_IndexesDefs verifies macro-def blocks land in page_macros.
func TestSyncPageMacros_IndexesDefs(t *testing.T) {
	ctx := context.Background()
	d := testdb.New(t)
	spaceID := macroTestSpace(t, d)
	pageID := macroTestPage(t, d, spaceID, "Source", `intro

:::macro-def{id="m_test1"}
### Hello macro
- one
:::

tail`)

	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := syncPageMacros(ctx, tx, pageID, spaceID, `intro

:::macro-def{id="m_test1"}
### Hello macro
- one
:::

tail`); err != nil {
		tx.Rollback()
		t.Fatalf("syncPageMacros: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var body string
	if err := d.QueryRowContext(ctx,
		`SELECT body FROM page_macros WHERE macro_id = $1`, "m_test1").Scan(&body); err != nil {
		t.Fatalf("lookup macro: %v", err)
	}
	if !strings.Contains(body, "### Hello macro") || !strings.Contains(body, "- one") {
		t.Fatalf("macro body = %q", body)
	}
}

// TestSyncPageMacros_RejectsDuplicateID rejects two macro-def with same id in one body.
func TestSyncPageMacros_RejectsDuplicateID(t *testing.T) {
	ctx := context.Background()
	d := testdb.New(t)
	spaceID := macroTestSpace(t, d)
	pageID := macroTestPage(t, d, spaceID, "Dup", "")

	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	err = syncPageMacros(ctx, tx, pageID, spaceID, `:::macro-def{id="dup"}
a
:::

:::macro-def{id="dup"}
b
:::`)
	tx.Rollback()
	if err == nil {
		t.Fatal("want error for duplicate macro id in body")
	}
	if ae, ok := err.(*apiErr); !ok || ae.Code != "invalid_macro" {
		t.Fatalf("got err %v, want invalid_macro apiErr", err)
	}
}

// TestSyncMacroRefs_TracksIncludes records block and page-level includes.
func TestSyncMacroRefs_TracksIncludes(t *testing.T) {
	ctx := context.Background()
	d := testdb.New(t)
	spaceID := macroTestSpace(t, d)
	consumer := macroTestPage(t, d, spaceID, "Consumer", "")

	body := `:::macro{id="m_abc"}
:::

:::macro{page=99}
:::`

	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := syncMacroRefs(ctx, tx, consumer, body); err != nil {
		tx.Rollback()
		t.Fatalf("syncMacroRefs: %v", err)
	}
	if err := tx.Commit(); err != nil {
		t.Fatalf("commit: %v", err)
	}

	var macroCount, pageCount int
	if err := d.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM macro_refs WHERE source_page_id = $1 AND macro_id = $2`,
		consumer, "m_abc").Scan(&macroCount); err != nil {
		t.Fatalf("count macro ref: %v", err)
	}
	if err := d.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM macro_refs WHERE source_page_id = $1 AND target_page_id = $2`,
		consumer, int64(99)).Scan(&pageCount); err != nil {
		t.Fatalf("count page ref: %v", err)
	}
	if macroCount != 1 || pageCount != 1 {
		t.Fatalf("macro refs macro=%d page=%d, want 1/1", macroCount, pageCount)
	}
}

// TestMacros_HTTP_FullFlow exercises macro sync on save + GET endpoints + backlinks.
func TestMacros_HTTP_FullFlow(t *testing.T) {
	ts, d := newWiredServer(t)
	owner := seedUser(t, d, "macroowner", "macroownerpw", false)
	spaceID := seedSpace(t, d, "Macro Space", "macro-space", owner)
	c := loginClient(t, ts, "macroowner", "macroownerpw")

	// Create source page with macro-def.
	createBody := fmt.Sprintf(`{"space_id":%d,"title":"Source","body":%q}`,
		spaceID, ":::macro-def{id=\"m_live\"}\n## Shared bit\n\nHello from macro.\n:::\n")
	resp, err := c.Post(ts.URL+"/api/pages", "application/json", strings.NewReader(createBody))
	if err != nil {
		t.Fatalf("create source: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK && resp.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp.Body)
		t.Fatalf("create source status=%d body=%s", resp.StatusCode, b)
	}
	var created struct {
		Page struct {
			ID int64 `json:"id"`
		} `json:"page"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&created); err != nil {
		t.Fatalf("decode create: %v", err)
	}
	sourceID := created.Page.ID

	// GET macro by id.
	resp2, err := c.Get(ts.URL + "/api/macros/m_live")
	if err != nil {
		t.Fatalf("get macro: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp2.Body)
		t.Fatalf("get macro status=%d body=%s", resp2.StatusCode, b)
	}
	var macroResp struct {
		Macro struct {
			Body  string `json:"body"`
			Title string `json:"title"`
		} `json:"macro"`
	}
	if err := json.NewDecoder(resp2.Body).Decode(&macroResp); err != nil {
		t.Fatalf("decode macro: %v", err)
	}
	if !strings.Contains(macroResp.Macro.Body, "Hello from macro") {
		t.Fatalf("macro body = %q", macroResp.Macro.Body)
	}
	if macroResp.Macro.Title != "Source" {
		t.Fatalf("macro title = %q want Source", macroResp.Macro.Title)
	}

	// Create consumer referencing the macro.
	consBody := fmt.Sprintf(`{"space_id":%d,"title":"Consumer","body":%q}`,
		spaceID, ":::macro{id=\"m_live\"}\n:::\n")
	resp3, err := c.Post(ts.URL+"/api/pages", "application/json", strings.NewReader(consBody))
	if err != nil {
		t.Fatalf("create consumer: %v", err)
	}
	defer resp3.Body.Close()
	if resp3.StatusCode != http.StatusOK && resp3.StatusCode != http.StatusCreated {
		b, _ := io.ReadAll(resp3.Body)
		t.Fatalf("create consumer status=%d body=%s", resp3.StatusCode, b)
	}
	var consCreated struct {
		Page struct {
			ID int64 `json:"id"`
		} `json:"page"`
	}
	if err := json.NewDecoder(resp3.Body).Decode(&consCreated); err != nil {
		t.Fatalf("decode consumer: %v", err)
	}

	// GET page include.
	resp4, err := c.Get(fmt.Sprintf("%s/api/pages/%d/include", ts.URL, sourceID))
	if err != nil {
		t.Fatalf("get include: %v", err)
	}
	defer resp4.Body.Close()
	if resp4.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp4.Body)
		t.Fatalf("get include status=%d body=%s", resp4.StatusCode, b)
	}
	var incResp struct {
		Include struct {
			Body string `json:"body"`
		} `json:"include"`
	}
	if err := json.NewDecoder(resp4.Body).Decode(&incResp); err != nil {
		t.Fatalf("decode include: %v", err)
	}
	if !strings.Contains(incResp.Include.Body, "macro-def") {
		t.Fatalf("include body should contain macro-def wrapper: %q", incResp.Include.Body)
	}

	// Backlinks on source should list consumer in macro_includes.
	resp5, err := c.Get(fmt.Sprintf("%s/api/pages/%d/backlinks", ts.URL, sourceID))
	if err != nil {
		t.Fatalf("backlinks: %v", err)
	}
	defer resp5.Body.Close()
	if resp5.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp5.Body)
		t.Fatalf("backlinks status=%d body=%s", resp5.StatusCode, b)
	}
	var bl struct {
		MacroIncludes []struct {
			PageID  int64  `json:"page_id"`
			Kind    string `json:"kind"`
			MacroID string `json:"macro_id"`
		} `json:"macro_includes"`
	}
	if err := json.NewDecoder(resp5.Body).Decode(&bl); err != nil {
		t.Fatalf("decode backlinks: %v", err)
	}
	if len(bl.MacroIncludes) != 1 {
		t.Fatalf("macro_includes = %+v want 1", bl.MacroIncludes)
	}
	if bl.MacroIncludes[0].PageID != consCreated.Page.ID || bl.MacroIncludes[0].MacroID != "m_live" {
		t.Fatalf("macro_include = %+v", bl.MacroIncludes[0])
	}

	// List macros in space.
	resp6, err := c.Get(fmt.Sprintf("%s/api/macros?space_id=%d", ts.URL, spaceID))
	if err != nil {
		t.Fatalf("list macros: %v", err)
	}
	defer resp6.Body.Close()
	if resp6.StatusCode != http.StatusOK {
		b, _ := io.ReadAll(resp6.Body)
		t.Fatalf("list macros status=%d body=%s", resp6.StatusCode, b)
	}
	var list struct {
		Macros []struct {
			MacroID string `json:"macro_id"`
		} `json:"macros"`
	}
	if err := json.NewDecoder(resp6.Body).Decode(&list); err != nil {
		t.Fatalf("decode list: %v", err)
	}
	if len(list.Macros) != 1 || list.Macros[0].MacroID != "m_live" {
		t.Fatalf("macros list = %+v", list.Macros)
	}
}

// TestGetMacro_NonMember_Returns403 ensures cross-space macro fetch is gated.
func TestGetMacro_NonMember_Returns403(t *testing.T) {
	d := newAPITestDB(t)
	srv := New(d)
	owner := seedUser(t, d, "owner", "ownerpw1234", false)
	stranger := seedUser(t, d, "stranger", "strangerpw1", false)
	spaceID := seedSpace(t, d, "Private", "private-macro", owner)

	ctx := context.Background()
	var pageID int64
	body := ":::macro-def{id=\"m_secret\"}\nsecret\n:::\n"
	if err := d.QueryRowContext(ctx,
		`INSERT INTO pages(space_id, parent_id, title, body, position) VALUES ($1, NULL, 'S', $2, 0) RETURNING id`,
		spaceID, body).Scan(&pageID); err != nil {
		t.Fatalf("insert page: %v", err)
	}
	tx, err := d.BeginTx(ctx, nil)
	if err != nil {
		t.Fatalf("begin: %v", err)
	}
	if err := syncPageMacros(ctx, tx, pageID, spaceID, body); err != nil {
		tx.Rollback()
		t.Fatalf("sync: %v", err)
	}
	tx.Commit()

	req := userRequest(http.MethodGet, "/api/macros/m_secret", "", authUser(stranger, "stranger", false))
	rec := routedRecorder("GET /api/macros/{id}", srv.GetMacro, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("status=%d body=%q want 403", rec.Code, rec.Body.String())
	}
}
