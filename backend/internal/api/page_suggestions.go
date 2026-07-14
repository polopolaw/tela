package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"github.com/zcag/tela/backend/internal/auth"
	"github.com/zcag/tela/backend/internal/merge"
	"github.com/zcag/tela/backend/internal/models"
)

// pageSuggestionRequest deliberately uses pointers for optional fields: a
// proposal may contain only a title or props change, while body is required.
type pageSuggestionRequest struct {
	Title   *string        `json:"title"`
	Body    *string        `json:"body"`
	Props   map[string]any `json:"props"`
	Summary *string        `json:"summary"`
}

type suggestionApplyRequest struct {
	Mode       string            `json:"mode"`
	Choices    map[string]string `json:"choices"`
	ReviewNote *string           `json:"review_note"`
}

type suggestionReviewRequest struct {
	ReviewNote *string `json:"review_note"`
}

func (s *Server) CreatePageSuggestion(w http.ResponseWriter, r *http.Request) {
	pageID, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	var req pageSuggestionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "could not parse request body")
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	suggestion, ae := s.createSuggestionCore(r.Context(), u, k, pageID, req)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"suggestion": suggestion})
}

func (s *Server) createSuggestionCore(ctx context.Context, u *auth.User, k *auth.APIKey, pageID int64, req pageSuggestionRequest) (models.PageSuggestion, *apiErr) {
	if req.Body == nil {
		return models.PageSuggestion{}, &apiErr{http.StatusBadRequest, "bad_request", "body is required"}
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "begin tx failed"}
	}
	defer tx.Rollback()
	page, err := selectPageByIDTx(ctx, tx, pageID)
	if errors.Is(err, sql.ErrNoRows) {
		return models.PageSuggestion{}, &apiErr{http.StatusForbidden, "forbidden", "not a member"}
	}
	if err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "lookup page failed"}
	}
	if _, ae := s.membershipCore(ctx, u, k, page.SpaceID); ae != nil {
		return models.PageSuggestion{}, ae
	}
	if req.Title == nil && req.Body == nil && req.Props == nil {
		return models.PageSuggestion{}, &apiErr{http.StatusBadRequest, "no_changes", "suggestion has no changes"}
	}
	if (req.Title == nil || *req.Title == page.Title) && *req.Body == page.Body && (req.Props == nil || propsEqual(req.Props, page.Props)) {
		return models.PageSuggestion{}, &apiErr{http.StatusBadRequest, "no_changes", "suggestion has no changes"}
	}
	var baseID sql.NullInt64
	if err := tx.QueryRowContext(ctx, `SELECT id FROM page_revisions WHERE page_id = $1 ORDER BY id DESC LIMIT 1`, pageID).Scan(&baseID); err != nil && !errors.Is(err, sql.ErrNoRows) {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "lookup base revision failed"}
	}
	var id int64
	err = tx.QueryRowContext(ctx, `
		INSERT INTO page_suggestions (page_id, author_id, title, body, props, base_revision_id, summary)
		VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7) RETURNING id`,
		pageID, u.ID, nullableStringPtr(req.Title), *req.Body, nullableProps(req.Props), nullableInt64Value(baseID), nullableStringPtr(req.Summary)).Scan(&id)
	if err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "create suggestion failed"}
	}
	suggestion, err := selectSuggestionByIDTx(ctx, tx, id)
	if err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "fetch created suggestion failed"}
	}
	if err := tx.Commit(); err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "commit failed"}
	}
	s.notifySuggestionCreated(ctx, u, page, suggestion)
	return suggestion, nil
}

// spaceSuggestionItem is the minimal rollup shape for GET /api/spaces/{id}/suggestions.
type spaceSuggestionItem struct {
	ID             int64   `json:"id"`
	PageID         int64   `json:"page_id"`
	PageTitle      string  `json:"page_title"`
	AuthorUsername *string `json:"author_username,omitempty"`
	Summary        *string `json:"summary,omitempty"`
	CreatedAt      string  `json:"created_at"`
	Status         string  `json:"status"`
}

func (s *Server) ListSpaceSuggestions(w http.ResponseWriter, r *http.Request) {
	spaceID, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	if _, ae := s.membershipCore(r.Context(), u, k, spaceID); ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	status := r.URL.Query().Get("status")
	if status != "" && !validSuggestionStatus(status) {
		writeError(w, 400, "invalid_query", "invalid status")
		return
	}
	items, err := listSpaceSuggestions(r.Context(), s.DB, spaceID, status)
	if err != nil {
		writeError(w, 500, "internal", "list space suggestions failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": items})
}

func (s *Server) ListPageSuggestions(w http.ResponseWriter, r *http.Request) {
	pageID, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	page, err := selectPageByID(r.Context(), s.DB, pageID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusForbidden, "forbidden", "not a member")
		return
	}
	if err != nil {
		writeError(w, 500, "internal", "lookup page failed")
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	if _, ae := s.membershipCore(r.Context(), u, k, page.SpaceID); ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	status := r.URL.Query().Get("status")
	if status != "" && !validSuggestionStatus(status) {
		writeError(w, 400, "invalid_query", "invalid status")
		return
	}
	items, err := listSuggestions(r.Context(), s.DB, pageID, status)
	if err != nil {
		writeError(w, 500, "internal", "list suggestions failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestions": items})
}

func (s *Server) GetPageSuggestion(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	suggestion, _, ae := s.getSuggestionCore(r.Context(), u, k, id, false)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestion": suggestion})
}

// getSuggestionCore resolves a suggestion and gates it at viewer+ or editor+.
func (s *Server) getSuggestionCore(ctx context.Context, u *auth.User, k *auth.APIKey, id int64, edit bool) (models.PageSuggestion, models.Page, *apiErr) {
	suggestion, err := selectSuggestionByID(ctx, s.DB, id)
	if errors.Is(err, sql.ErrNoRows) {
		return models.PageSuggestion{}, models.Page{}, &apiErr{http.StatusNotFound, "suggestion_not_found", "suggestion not found"}
	}
	if err != nil {
		return models.PageSuggestion{}, models.Page{}, &apiErr{http.StatusInternalServerError, "internal", "lookup suggestion failed"}
	}
	page, err := selectPageByID(ctx, s.DB, suggestion.PageID)
	if err != nil {
		return models.PageSuggestion{}, models.Page{}, &apiErr{http.StatusNotFound, "page_not_found", "page not found"}
	}
	if edit {
		tx, err := s.DB.BeginTx(ctx, nil)
		if err != nil {
			return models.PageSuggestion{}, models.Page{}, &apiErr{500, "internal", "begin tx failed"}
		}
		defer tx.Rollback()
		if ae := s.requireEditTx(ctx, tx, u, k, page.SpaceID); ae != nil {
			return models.PageSuggestion{}, models.Page{}, ae
		}
	} else if _, ae := s.membershipCore(ctx, u, k, page.SpaceID); ae != nil {
		return models.PageSuggestion{}, models.Page{}, ae
	}
	return suggestion, page, nil
}

// Hunk computation is implemented with the merge/hunks package. Kept in this
// dedicated method so REST and MCP share exactly the same review view.
func (s *Server) GetSuggestionHunks(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	suggestion, page, ae := s.getSuggestionCore(r.Context(), u, k, id, true)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	hunks, summary, ae := s.suggestionHunks(r.Context(), suggestion, page)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	visible := make([]merge.Hunk, 0, len(hunks))
	for _, h := range hunks {
		if h.Kind != merge.HunkBothSame {
			visible = append(visible, h)
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"hunks": visible, "summary": summary})
}

func (s *Server) ApplyPageSuggestion(w http.ResponseWriter, r *http.Request) {
	id, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	var req suggestionApplyRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad_request", "could not parse request body")
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	suggestion, ae := s.applySuggestionCore(r.Context(), u, k, id, req)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"suggestion": suggestion})
}

func (s *Server) applySuggestionCore(ctx context.Context, u *auth.User, k *auth.APIKey, id int64, req suggestionApplyRequest) (models.PageSuggestion, *apiErr) {
	if req.Mode != "full" && req.Mode != "partial" {
		return models.PageSuggestion{}, &apiErr{http.StatusBadRequest, "bad_request", "mode must be full or partial"}
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "begin tx failed"}
	}
	defer tx.Rollback()
	suggestion, err := selectSuggestionByIDTx(ctx, tx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return models.PageSuggestion{}, &apiErr{http.StatusNotFound, "suggestion_not_found", "suggestion not found"}
	}
	if err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "lookup suggestion failed"}
	}
	if suggestion.Status != "open" {
		return models.PageSuggestion{}, &apiErr{http.StatusConflict, "suggestion_not_open", "suggestion is not open"}
	}
	page, err := selectPageByIDTx(ctx, tx, suggestion.PageID)
	if err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusNotFound, "page_not_found", "page not found"}
	}
	if ae := s.requireEditTx(ctx, tx, u, k, page.SpaceID); ae != nil {
		return models.PageSuggestion{}, ae
	}
	hunks, _, ae := s.suggestionHunks(ctx, suggestion, page)
	if ae != nil {
		return models.PageSuggestion{}, ae
	}
	choices := make(map[string]merge.HunkSide, len(req.Choices))
	for id, side := range req.Choices {
		if side != string(merge.SideSuggestion) && side != string(merge.SideLive) {
			return models.PageSuggestion{}, &apiErr{http.StatusBadRequest, "bad_request", "invalid hunk choice"}
		}
		choices[id] = merge.HunkSide(side)
	}
	if req.Mode == "full" {
		for _, h := range hunks {
			if h.Kind == merge.HunkConflict {
				if _, ok := choices[h.ID]; !ok {
					return models.PageSuggestion{}, &apiErr{http.StatusConflict, "unresolved_hunks", "conflicting hunks require a choice"}
				}
			}
		}
	}
	base, ae := s.suggestionBase(ctx, suggestion, page)
	if ae != nil {
		return models.PageSuggestion{}, ae
	}
	suggestionTitle := page.Title
	if suggestion.Title != nil {
		suggestionTitle = *suggestion.Title
	}
	suggestionProps := page.Props
	if suggestion.Props != nil {
		suggestionProps = suggestion.Props
	}
	body, title, props, applied, skipped, unresolved := merge.ApplyHunkChoices(base.Body, page.Body, suggestion.Body, base.Title, page.Title, suggestionTitle, base.Props, page.Props, suggestionProps, choices)
	if len(unresolved) > 0 {
		return models.PageSuggestion{}, &apiErr{http.StatusBadRequest, "unresolved_hunks", "hunk choices are incomplete"}
	}
	if body == page.Body && title == page.Title && propsEqual(props, page.Props) {
		return models.PageSuggestion{}, &apiErr{http.StatusBadRequest, "no_effective_changes", "suggestion has no effective changes"}
	}
	update := pageUpdateRequest{Title: &title, Body: &body, Props: props}
	updated, ae := applyUpdateTx(ctx, tx, page.ID, update)
	if ae != nil {
		return models.PageSuggestion{}, ae
	}
	rawChoices, err := json.Marshal(choices)
	if err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "encode hunk choices failed"}
	}
	if _, err := tx.ExecContext(ctx, `UPDATE page_suggestions SET status='approved', review_note=$1, applied_hunks=$2::jsonb, reviewed_by=$3, reviewed_at=tela_now(), updated_at=tela_now() WHERE id=$4`,
		nullableStringPtr(req.ReviewNote), string(rawChoices), u.ID, id); err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "approve suggestion failed"}
	}
	out, err := selectSuggestionByIDTx(ctx, tx, id)
	if err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "fetch approved suggestion failed"}
	}
	if err := tx.Commit(); err != nil {
		return models.PageSuggestion{}, &apiErr{http.StatusInternalServerError, "internal", "commit failed"}
	}
	s.afterPageWrite(ctx, page, updated, true, false, u.ID, "suggestion")
	s.notifySuggestionApproved(ctx, u, updated, suggestion, req.Mode == "partial" || len(skipped) > 0, len(applied), len(hunks))
	return out, nil
}

func (s *Server) suggestionHunks(ctx context.Context, suggestion models.PageSuggestion, page models.Page) ([]merge.Hunk, merge.HunksSummary, *apiErr) {
	base, ae := s.suggestionBase(ctx, suggestion, page)
	if ae != nil {
		return nil, merge.HunksSummary{}, ae
	}
	title := page.Title
	if suggestion.Title != nil {
		title = *suggestion.Title
	}
	props := page.Props
	if suggestion.Props != nil {
		props = suggestion.Props
	}
	hunks, summary := merge.ComputeHunks(base.Body, page.Body, suggestion.Body, base.Title, page.Title, title, base.Props, page.Props, props)
	return hunks, summary, nil
}

func (s *Server) suggestionBase(ctx context.Context, suggestion models.PageSuggestion, live models.Page) (models.Page, *apiErr) {
	if suggestion.BaseRevisionID == nil {
		return live, nil
	}
	var base models.Page
	var raw []byte
	err := s.DB.QueryRowContext(ctx, `SELECT page_id, title, body, props FROM page_revisions WHERE id=$1 AND page_id=$2`, *suggestion.BaseRevisionID, suggestion.PageID).Scan(&base.ID, &base.Title, &base.Body, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return live, nil
	}
	if err != nil {
		return models.Page{}, &apiErr{http.StatusInternalServerError, "internal", "load suggestion base revision failed"}
	}
	base.Props = map[string]any{}
	if len(raw) > 0 && json.Unmarshal(raw, &base.Props) != nil {
		return models.Page{}, &apiErr{http.StatusInternalServerError, "internal", "decode suggestion base props failed"}
	}
	return base, nil
}

func (s *Server) RejectPageSuggestion(w http.ResponseWriter, r *http.Request) {
	s.transitionSuggestion(w, r, "rejected", true)
}
func (s *Server) WithdrawPageSuggestion(w http.ResponseWriter, r *http.Request) {
	s.transitionSuggestion(w, r, "withdrawn", false)
}
func (s *Server) transitionSuggestion(w http.ResponseWriter, r *http.Request, status string, editor bool) {
	id, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	u, ok := requireUser(w, r)
	if !ok {
		return
	}
	var req suggestionReviewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
		writeError(w, 400, "bad_request", "could not parse request body")
		return
	}
	k, _ := auth.APIKeyFromContext(r.Context())
	suggestion, page, ae := s.getSuggestionCore(r.Context(), u, k, id, editor)
	if ae != nil {
		writeError(w, ae.Status, ae.Code, ae.Message)
		return
	}
	if !editor && suggestion.AuthorID != u.ID {
		writeError(w, 403, "forbidden", "only the author can withdraw a suggestion")
		return
	}
	if suggestion.Status != "open" {
		writeError(w, 409, "suggestion_not_open", "suggestion is not open")
		return
	}
	tx, err := s.DB.BeginTx(r.Context(), nil)
	if err != nil {
		writeError(w, 500, "internal", "begin tx failed")
		return
	}
	defer tx.Rollback()
	if editor {
		if ae := s.requireEditTx(r.Context(), tx, u, k, page.SpaceID); ae != nil {
			writeError(w, ae.Status, ae.Code, ae.Message)
			return
		}
	}
	var reviewedBy any
	var reviewedAt any
	if editor {
		reviewedBy = u.ID
		reviewedAt = true // sentinel: set reviewed_at via SQL tela_now()
	}
	// Use a boolean flag for "set reviewed_at" so we never pass an untyped NULL
	// into a CASE that also binds reviewed_by (pgx rejects ambiguous $n types).
	if _, err := tx.ExecContext(r.Context(), `
		UPDATE page_suggestions
		SET status=$1,
		    review_note=$2,
		    reviewed_by=$3,
		    reviewed_at=CASE WHEN $4 THEN tela_now() ELSE NULL END,
		    updated_at=tela_now()
		WHERE id=$5 AND status='open'`,
		status, nullableStringPtr(req.ReviewNote), reviewedBy, reviewedAt != nil, id); err != nil {
		writeError(w, 500, "internal", "update suggestion failed")
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(w, 500, "internal", "commit failed")
		return
	}
	if editor {
		s.notifySuggestionRejected(r.Context(), u, page, suggestion)
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

const suggestionSelectColumns = `SELECT s.id,s.page_id,s.author_id,a.username,s.title,s.body,s.props,s.base_revision_id,s.status,s.summary,s.review_note,s.applied_hunks,s.reviewed_by,r.username,s.reviewed_at,s.created_at,s.updated_at`

func selectSuggestionByID(ctx context.Context, db *sql.DB, id int64) (models.PageSuggestion, error) {
	return scanSuggestion(db.QueryRowContext(ctx, suggestionSelectColumns+` FROM page_suggestions s JOIN users a ON a.id=s.author_id LEFT JOIN users r ON r.id=s.reviewed_by WHERE s.id=$1`, id))
}
func selectSuggestionByIDTx(ctx context.Context, tx *sql.Tx, id int64) (models.PageSuggestion, error) {
	return scanSuggestion(tx.QueryRowContext(ctx, suggestionSelectColumns+` FROM page_suggestions s JOIN users a ON a.id=s.author_id LEFT JOIN users r ON r.id=s.reviewed_by WHERE s.id=$1`, id))
}
func listSpaceSuggestions(ctx context.Context, db *sql.DB, spaceID int64, status string) ([]spaceSuggestionItem, error) {
	q := `SELECT s.id, s.page_id, p.title, a.username, s.summary, s.created_at, s.status
		FROM page_suggestions s
		JOIN pages p ON p.id = s.page_id
		JOIN users a ON a.id = s.author_id
		WHERE p.space_id = $1 AND p.deleted_at IS NULL`
	args := []any{spaceID}
	if status != "" {
		q += ` AND s.status = $2`
		args = append(args, status)
	}
	q += ` ORDER BY s.id DESC`
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []spaceSuggestionItem{}
	for rows.Next() {
		var item spaceSuggestionItem
		var author, summary sql.NullString
		if err := rows.Scan(&item.ID, &item.PageID, &item.PageTitle, &author, &summary, &item.CreatedAt, &item.Status); err != nil {
			return nil, err
		}
		item.AuthorUsername = nullableString(author)
		item.Summary = nullableString(summary)
		out = append(out, item)
	}
	return out, rows.Err()
}

func listSuggestions(ctx context.Context, db *sql.DB, pageID int64, status string) ([]models.PageSuggestion, error) {
	q, args := suggestionSelectColumns+` FROM page_suggestions s JOIN users a ON a.id=s.author_id LEFT JOIN users r ON r.id=s.reviewed_by WHERE s.page_id=$1`, []any{pageID}
	if status != "" {
		q += ` AND s.status=$2`
		args = append(args, status)
	}
	q += ` ORDER BY s.id DESC`
	rows, err := db.QueryContext(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.PageSuggestion{}
	for rows.Next() {
		item, err := scanSuggestion(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}
func scanSuggestion(r rowScanner) (models.PageSuggestion, error) {
	var s models.PageSuggestion
	var title, props, summary, note, hunks, authorName, reviewerName, reviewedAt sql.NullString
	var baseID, reviewedBy sql.NullInt64
	if err := r.Scan(&s.ID, &s.PageID, &s.AuthorID, &authorName, &title, &s.Body, &props, &baseID, &s.Status, &summary, &note, &hunks, &reviewedBy, &reviewerName, &reviewedAt, &s.CreatedAt, &s.UpdatedAt); err != nil {
		return s, err
	}
	s.AuthorUsername = nullableString(authorName)
	s.Title = nullableString(title)
	s.Summary = nullableString(summary)
	s.ReviewNote = nullableString(note)
	s.ReviewedByUsername = nullableString(reviewerName)
	s.ReviewedAt = nullableString(reviewedAt)
	if baseID.Valid {
		s.BaseRevisionID = &baseID.Int64
	}
	if reviewedBy.Valid {
		s.ReviewedBy = &reviewedBy.Int64
	}
	if props.Valid && props.String != "" {
		_ = json.Unmarshal([]byte(props.String), &s.Props)
	}
	if hunks.Valid {
		s.AppliedHunks = json.RawMessage(hunks.String)
	}
	return s, nil
}
func validSuggestionStatus(s string) bool {
	return s == "open" || s == "approved" || s == "rejected" || s == "withdrawn"
}
func nullableStringPtr(s *string) any {
	if s == nil {
		return nil
	}
	return *s
}
func nullableProps(p map[string]any) any {
	if p == nil {
		return nil
	}
	return propsJSON(p)
}
func nullableInt64Value(v sql.NullInt64) any {
	if v.Valid {
		return v.Int64
	}
	return nil
}
