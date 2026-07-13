package api

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"

	"github.com/zcag/tela/backend/internal/auth"
	"github.com/zcag/tela/backend/internal/macromd"
)

// syncPageMacros rebuilds page_macros rows for pageID from macro-def blocks in
// body. Returns 400 when a macro id collides with another page's definition.
func syncPageMacros(ctx context.Context, tx *sql.Tx, pageID, spaceID int64, body string) error {
	defs, err := macromd.ParseMacroDefs(body)
	if err != nil {
		if errors.Is(err, macromd.ErrDuplicateMacroID) || errors.Is(err, macromd.ErrEmptyMacroID) {
			return &apiErr{http.StatusBadRequest, "invalid_macro", err.Error()}
		}
		return fmt.Errorf("parse macro defs: %w", err)
	}
	for _, d := range defs {
		var ownerPageID int64
		err := tx.QueryRowContext(ctx,
			`SELECT page_id FROM page_macros WHERE macro_id = $1`, d.ID).Scan(&ownerPageID)
		if err == nil && ownerPageID != pageID {
			return &apiErr{http.StatusBadRequest, "macro_id_collision",
				fmt.Sprintf("macro id %q is already defined on another page", d.ID)}
		}
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return fmt.Errorf("check macro id collision: %w", err)
		}
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM page_macros WHERE page_id = $1`, pageID); err != nil {
		return fmt.Errorf("delete page macros: %w", err)
	}
	for _, d := range defs {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO page_macros (macro_id, page_id, space_id, body, updated_at)
			VALUES ($1, $2, $3, $4, tela_now())`,
			d.ID, pageID, spaceID, d.Body); err != nil {
			return fmt.Errorf("insert page macro: %w", err)
		}
	}
	return nil
}

// syncMacroRefs rebuilds macro_refs rows for sourceID from macro includes in body.
func syncMacroRefs(ctx context.Context, tx *sql.Tx, sourceID int64, body string) error {
	if _, err := tx.ExecContext(ctx, `DELETE FROM macro_refs WHERE source_page_id = $1`, sourceID); err != nil {
		return fmt.Errorf("delete macro refs: %w", err)
	}
	for _, ref := range macromd.ParseMacroRefs(body) {
		macroID := ref.MacroID
		targetPageID := ref.TargetPageID
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO macro_refs (source_page_id, macro_id, target_page_id)
			VALUES ($1, $2, $3)
			ON CONFLICT DO NOTHING`,
			sourceID, macroID, targetPageID); err != nil {
			return fmt.Errorf("insert macro ref: %w", err)
		}
	}
	return nil
}

type macroDTO struct {
	MacroID   string `json:"macro_id"`
	PageID    int64  `json:"page_id"`
	SpaceID   int64  `json:"space_id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	UpdatedAt string `json:"updated_at"`
}

type pageIncludeDTO struct {
	PageID    int64  `json:"page_id"`
	Title     string `json:"title"`
	Body      string `json:"body"`
	UpdatedAt string `json:"updated_at"`
}

type macroListItem struct {
	MacroID   string `json:"macro_id"`
	PageID    int64  `json:"page_id"`
	Title     string `json:"title"`
	UpdatedAt string `json:"updated_at"`
}

// GetMacro — GET /api/macros/{id}. Returns a macro block body for live includes.
func (s *Server) GetMacro(w http.ResponseWriter, r *http.Request) {
	macroID := r.PathValue("id")
	if macroID == "" {
		writeError(w, http.StatusBadRequest, "invalid_id", "macro id required")
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	dto, ae := s.getMacroCore(r.Context(), u, k, macroID)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"macro": dto})
}

func (s *Server) getMacroCore(ctx context.Context, u *auth.User, k *auth.APIKey, macroID string) (macroDTO, *apiErr) {
	var (
		pageID, spaceID int64
		body, updatedAt string
		title           string
	)
	err := s.DB.QueryRowContext(ctx, `
		SELECT m.page_id, m.space_id, m.body, m.updated_at, p.title
		  FROM page_macros m
		  JOIN pages p ON p.id = m.page_id AND p.deleted_at IS NULL
		 WHERE m.macro_id = $1`, macroID).Scan(&pageID, &spaceID, &body, &updatedAt, &title)
	if errors.Is(err, sql.ErrNoRows) {
		return macroDTO{}, &apiErr{http.StatusNotFound, "not_found", "macro not found"}
	}
	if err != nil {
		return macroDTO{}, &apiErr{http.StatusInternalServerError, "internal", "lookup macro failed"}
	}
	if _, ae := s.membershipCore(ctx, u, k, spaceID); ae != nil {
		return macroDTO{}, ae
	}
	return macroDTO{
		MacroID: macroID, PageID: pageID, SpaceID: spaceID,
		Title: title, Body: body, UpdatedAt: updatedAt,
	}, nil
}

// ListMacros — GET /api/macros?space_id=. Lists macro definitions in a space.
func (s *Server) ListMacros(w http.ResponseWriter, r *http.Request) {
	spaceIDStr := r.URL.Query().Get("space_id")
	if spaceIDStr == "" {
		writeError(w, http.StatusBadRequest, "missing_space_id", "space_id query param required")
		return
	}
	spaceID, err := strconv.ParseInt(spaceIDStr, 10, 64)
	if err != nil || spaceID <= 0 {
		writeError(w, http.StatusBadRequest, "invalid_space_id", "invalid space_id")
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	items, ae := s.listMacrosCore(r.Context(), u, k, spaceID)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"macros": items})
}

func (s *Server) listMacrosCore(ctx context.Context, u *auth.User, k *auth.APIKey, spaceID int64) ([]macroListItem, *apiErr) {
	if _, ae := s.membershipCore(ctx, u, k, spaceID); ae != nil {
		return nil, ae
	}
	rows, err := s.DB.QueryContext(ctx, `
		SELECT m.macro_id, m.page_id, p.title, m.updated_at
		  FROM page_macros m
		  JOIN pages p ON p.id = m.page_id AND p.deleted_at IS NULL
		 WHERE m.space_id = $1
		 ORDER BY p.title ASC, m.macro_id ASC`, spaceID)
	if err != nil {
		return nil, &apiErr{http.StatusInternalServerError, "internal", "list macros failed"}
	}
	defer rows.Close()
	var out []macroListItem
	for rows.Next() {
		var it macroListItem
		if err := rows.Scan(&it.MacroID, &it.PageID, &it.Title, &it.UpdatedAt); err != nil {
			return nil, &apiErr{http.StatusInternalServerError, "internal", "scan macro row failed"}
		}
		out = append(out, it)
	}
	if err := rows.Err(); err != nil {
		return nil, &apiErr{http.StatusInternalServerError, "internal", "iterate macros failed"}
	}
	return out, nil
}

// GetPageInclude — GET /api/pages/{id}/include. Returns page body for whole-page includes.
func (s *Server) GetPageInclude(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	dto, ae := s.getPageIncludeCore(r.Context(), u, k, id)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"include": dto})
}

func (s *Server) getPageIncludeCore(ctx context.Context, u *auth.User, k *auth.APIKey, pageID int64) (pageIncludeDTO, *apiErr) {
	p, ae := s.getPageCore(ctx, u, k, pageID)
	if ae != nil {
		return pageIncludeDTO{}, ae
	}
	return pageIncludeDTO{
		PageID: p.ID, Title: p.Title, Body: p.Body, UpdatedAt: p.UpdatedAt,
	}, nil
}

// getMacroForPublicShare returns macro content when the source page is in share scope.
func (s *Server) getMacroForPublicShare(ctx context.Context, share shareLink, macroID string) (macroDTO, *apiErr) {
	var pageID, spaceID int64
	var body, updatedAt, title string
	err := s.DB.QueryRowContext(ctx, `
		SELECT m.page_id, m.space_id, m.body, m.updated_at, p.title
		  FROM page_macros m
		  JOIN pages p ON p.id = m.page_id AND p.deleted_at IS NULL
		 WHERE m.macro_id = $1`, macroID).Scan(&pageID, &spaceID, &body, &updatedAt, &title)
	if errors.Is(err, sql.ErrNoRows) {
		return macroDTO{}, &apiErr{http.StatusNotFound, "not_found", "macro not found"}
	}
	if err != nil {
		return macroDTO{}, &apiErr{http.StatusInternalServerError, "internal", "lookup macro failed"}
	}
	if ae := s.assertPageInShareScope(ctx, share, pageID); ae != nil {
		return macroDTO{}, ae
	}
	return macroDTO{
		MacroID: macroID, PageID: pageID, SpaceID: spaceID,
		Title: title, Body: body, UpdatedAt: updatedAt,
	}, nil
}

func (s *Server) getPageIncludeForPublicShare(ctx context.Context, share shareLink, pageID int64) (pageIncludeDTO, *apiErr) {
	if ae := s.assertPageInShareScope(ctx, share, pageID); ae != nil {
		return pageIncludeDTO{}, ae
	}
	p, err := selectPageByID(ctx, s.DB, pageID)
	if errors.Is(err, sql.ErrNoRows) {
		return pageIncludeDTO{}, &apiErr{http.StatusNotFound, "not_found", "page not found"}
	}
	if err != nil {
		return pageIncludeDTO{}, &apiErr{http.StatusInternalServerError, "internal", "lookup page failed"}
	}
	return pageIncludeDTO{
		PageID: p.ID, Title: p.Title, Body: p.Body, UpdatedAt: p.UpdatedAt,
	}, nil
}

func (s *Server) getMacroForPublicSpace(ctx context.Context, spaceID int64, macroID string) (macroDTO, *apiErr) {
	var pageID int64
	var body, updatedAt, title string
	err := s.DB.QueryRowContext(ctx, `
		SELECT m.page_id, m.body, m.updated_at, p.title
		  FROM page_macros m
		  JOIN pages p ON p.id = m.page_id AND p.deleted_at IS NULL
		 WHERE m.macro_id = $1 AND m.space_id = $2`, macroID, spaceID).Scan(&pageID, &body, &updatedAt, &title)
	if errors.Is(err, sql.ErrNoRows) {
		return macroDTO{}, &apiErr{http.StatusNotFound, "not_found", "macro not found"}
	}
	if err != nil {
		return macroDTO{}, &apiErr{http.StatusInternalServerError, "internal", "lookup macro failed"}
	}
	return macroDTO{
		MacroID: macroID, PageID: pageID, SpaceID: spaceID,
		Title: title, Body: body, UpdatedAt: updatedAt,
	}, nil
}

func (s *Server) getPageIncludeForPublicSpace(ctx context.Context, spaceID, pageID int64) (pageIncludeDTO, *apiErr) {
	p, err := selectPageByID(ctx, s.DB, pageID)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && p.SpaceID != spaceID) {
		return pageIncludeDTO{}, &apiErr{http.StatusNotFound, "not_found", "page not found"}
	}
	if err != nil {
		return pageIncludeDTO{}, &apiErr{http.StatusInternalServerError, "internal", "lookup page failed"}
	}
	return pageIncludeDTO{
		PageID: p.ID, Title: p.Title, Body: p.Body, UpdatedAt: p.UpdatedAt,
	}, nil
}

func (s *Server) assertPageInShareScope(ctx context.Context, share shareLink, pageID int64) *apiErr {
	if pageID == share.PageID {
		return nil
	}
	if !share.IncludeDescendants {
		return &apiErr{http.StatusNotFound, "not_found", "page not in share scope"}
	}
	inScope, err := pageInShareSubtree(ctx, s.DB, share.PageID, pageID)
	if err != nil {
		return &apiErr{http.StatusInternalServerError, "internal", "scope check failed"}
	}
	if !inScope {
		return &apiErr{http.StatusNotFound, "not_found", "page not in share scope"}
	}
	return nil
}

// GetPublicShareMacro — GET /api/share/{token}/macros/{id}
func (s *Server) GetPublicShareMacro(w http.ResponseWriter, r *http.Request) {
	share, ok := s.publicShareLookup(w, r)
	if !ok {
		return
	}
	if !s.requirePublicShareAuth(w, r, &share) {
		return
	}
	macroID := r.PathValue("id")
	if macroID == "" {
		writeError(w, http.StatusBadRequest, "invalid_id", "macro id required")
		return
	}
	dto, ae := s.getMacroForPublicShare(r.Context(), share, macroID)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"macro": dto})
}

// GetPublicSharePageInclude — GET /api/share/{token}/page/{page_id}/include
func (s *Server) GetPublicSharePageInclude(w http.ResponseWriter, r *http.Request) {
	share, ok := s.publicShareLookup(w, r)
	if !ok {
		return
	}
	if !s.requirePublicShareAuth(w, r, &share) {
		return
	}
	pageID, ok := parseIDParam(w, r, "page_id")
	if !ok {
		return
	}
	dto, ae := s.getPageIncludeForPublicShare(r.Context(), share, pageID)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"include": dto})
}

// GetPublicSpaceMacro — GET /api/public/spaces/{id}/macros/{macro_id}
func (s *Server) GetPublicSpaceMacro(w http.ResponseWriter, r *http.Request) {
	spaceID, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	if _, ok := s.requirePublicSpace(w, r, spaceID); !ok {
		return
	}
	macroID := r.PathValue("macro_id")
	if macroID == "" {
		writeError(w, http.StatusBadRequest, "invalid_id", "macro id required")
		return
	}
	dto, ae := s.getMacroForPublicSpace(r.Context(), spaceID, macroID)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"macro": dto})
}

// GetPublicSpacePageInclude — GET /api/public/spaces/{id}/pages/{page_id}/include
func (s *Server) GetPublicSpacePageInclude(w http.ResponseWriter, r *http.Request) {
	spaceID, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	if _, ok := s.requirePublicSpace(w, r, spaceID); !ok {
		return
	}
	pageID, ok := parseIDParam(w, r, "page_id")
	if !ok {
		return
	}
	dto, ae := s.getPageIncludeForPublicSpace(r.Context(), spaceID, pageID)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"include": dto})
}

// macroIncludeHit is a page that live-includes content from the target page.
type macroIncludeHit struct {
	PageID     int64    `json:"page_id"`
	SpaceID    int64    `json:"space_id"`
	SpaceName  string   `json:"space_name"`
	Title      string   `json:"title"`
	Breadcrumb []string `json:"breadcrumb"`
	Kind       string   `json:"kind"` // "macro" | "page"
	MacroID    string   `json:"macro_id,omitempty"`
}

func (s *Server) macroIncludesCore(ctx context.Context, u *auth.User, k *auth.APIKey, pageID int64) ([]macroIncludeHit, *apiErr) {
	var targetSpaceID int64
	err := s.DB.QueryRowContext(ctx, `SELECT space_id FROM pages WHERE id = $1 AND deleted_at IS NULL`, pageID).Scan(&targetSpaceID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, &apiErr{http.StatusForbidden, "forbidden", "not a member"}
	}
	if err != nil {
		return nil, &apiErr{http.StatusInternalServerError, "internal", "lookup page failed"}
	}
	if _, ae := s.membershipCore(ctx, u, k, targetSpaceID); ae != nil {
		return nil, ae
	}

	rows, err := s.DB.QueryContext(ctx, `
		SELECT DISTINCT r.source_page_id, p.space_id, s.name, p.title,
		       CASE WHEN r.target_page_id > 0 THEN 'page' ELSE 'macro' END,
		       r.macro_id
		  FROM macro_refs r
		  JOIN pages p ON p.id = r.source_page_id AND p.deleted_at IS NULL
		  JOIN spaces s ON s.id = p.space_id
		  JOIN (SELECT DISTINCT space_id FROM space_access WHERE user_id = $1) sm ON sm.space_id = p.space_id
		 WHERE (r.target_page_id = $2)
		    OR (r.macro_id <> '' AND r.macro_id IN (SELECT macro_id FROM page_macros WHERE page_id = $2))
		 ORDER BY s.name ASC, p.title ASC`, u.ID, pageID)
	if err != nil {
		return nil, &apiErr{http.StatusInternalServerError, "internal", "list macro includes failed"}
	}
	defer rows.Close()

	out := []macroIncludeHit{}
	for rows.Next() {
		var (
			sourceID, spaceID int64
			spaceName, title  string
			kind, macroID     string
		)
		if err := rows.Scan(&sourceID, &spaceID, &spaceName, &title, &kind, &macroID); err != nil {
			return nil, &apiErr{http.StatusInternalServerError, "internal", "scan macro include failed"}
		}
		bc, err := pageBreadcrumb(ctx, s.DB, sourceID)
		if err != nil {
			return nil, &apiErr{http.StatusInternalServerError, "internal", "build breadcrumb failed"}
		}
		hit := macroIncludeHit{
			PageID: sourceID, SpaceID: spaceID, SpaceName: spaceName,
			Title: title, Breadcrumb: bc, Kind: kind,
		}
		if kind == "macro" {
			hit.MacroID = macroID
		}
		out = append(out, hit)
	}
	if err := rows.Err(); err != nil {
		return nil, &apiErr{http.StatusInternalServerError, "internal", "iterate macro includes failed"}
	}
	return out, nil
}
