package api

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

// PlantUML render via Kroki. Canonical markdown stays a ```plantuml fence;
// the backend proxies diagram source to an optional Kroki sidecar
// (TELA_KROKI_URL). Unset → 503 (feature dark, same posture as RAG).
//
// Routes:
//   POST /api/render/plantuml                         — session-authed
//   POST /api/print/{token}/render/plantuml           — print token (PDF)
//   POST /api/share/{token}/render/plantuml           — public share reader
//   POST /api/public/spaces/{id}/render/plantuml      — public-space reader

const (
	plantumlRenderTO         = 15 * time.Second
	maxPlantumlSourceBytes   = 256 * 1024
	plantumlUnconfiguredCode = "plantuml_unconfigured"
)

type plantumlRenderRequest struct {
	Source string `json:"source"`
}

// krokiBaseURL is the internal address of the Kroki HTTP API.
func krokiBaseURL() string {
	return strings.TrimRight(os.Getenv("TELA_KROKI_URL"), "/")
}

func readPlantumlSource(w http.ResponseWriter, r *http.Request) (string, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxPlantumlSourceBytes+1024)
	defer r.Body.Close()
	var req plantumlRenderRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			writeError(w, http.StatusRequestEntityTooLarge, "source_too_large",
				fmt.Sprintf("source exceeds %d bytes", maxPlantumlSourceBytes))
			return "", false
		}
		writeError(w, http.StatusBadRequest, "invalid_json", "invalid JSON body")
		return "", false
	}
	src := strings.TrimSpace(req.Source)
	if src == "" {
		writeError(w, http.StatusBadRequest, "invalid_request", "source is required")
		return "", false
	}
	if len(src) > maxPlantumlSourceBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "source_too_large",
			fmt.Sprintf("source exceeds %d bytes", maxPlantumlSourceBytes))
		return "", false
	}
	return src, true
}

func renderPlantumlViaKroki(ctx context.Context, source string) ([]byte, int, error) {
	base := krokiBaseURL()
	if base == "" {
		return nil, http.StatusServiceUnavailable, fmt.Errorf("kroki not configured")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/plantuml/svg",
		strings.NewReader(source))
	if err != nil {
		return nil, http.StatusInternalServerError, err
	}
	req.Header.Set("Content-Type", "text/plain")
	resp, err := (&http.Client{Timeout: plantumlRenderTO}).Do(req)
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, http.StatusBadGateway, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		msg := strings.TrimSpace(string(body))
		if msg == "" {
			msg = "kroki render failed"
		}
		if len(msg) > 500 {
			msg = msg[:500]
		}
		return nil, resp.StatusCode, fmt.Errorf("%s", msg)
	}
	return body, http.StatusOK, nil
}

func writePlantumlSVG(w http.ResponseWriter, svg []byte) {
	w.Header().Set("Content-Type", "image/svg+xml; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=300")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(svg)
}

func (s *Server) writePlantumlRender(w http.ResponseWriter, r *http.Request, source string) {
	svg, status, err := renderPlantumlViaKroki(r.Context(), source)
	if err != nil {
		if status == http.StatusServiceUnavailable {
			writeError(w, status, plantumlUnconfiguredCode, "PlantUML rendering is not configured")
			return
		}
		if status >= 400 && status < 500 {
			writeError(w, status, "plantuml_invalid", err.Error())
			return
		}
		writeError(w, http.StatusBadGateway, "plantuml_render_failed", err.Error())
		return
	}
	writePlantumlSVG(w, svg)
}

// RenderPlantuml POST /api/render/plantuml — session-authed (normal middleware).
func (s *Server) RenderPlantuml(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	source, ok := readPlantumlSource(w, r)
	if !ok {
		return
	}
	s.writePlantumlRender(w, r, source)
}

// RenderPlantumlPrint POST /api/print/{token}/render/plantuml — PUBLIC; print token.
func (s *Server) RenderPlantumlPrint(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	if _, ok := s.verifyPrintToken(r.PathValue("token")); !ok {
		writeError(w, http.StatusNotFound, "not_found", "invalid or expired token")
		return
	}
	source, ok := readPlantumlSource(w, r)
	if !ok {
		return
	}
	s.writePlantumlRender(w, r, source)
}

// RenderPlantumlShare POST /api/share/{token}/render/plantuml — PUBLIC; share token.
func (s *Server) RenderPlantumlShare(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	if _, ok := s.publicShareLookup(w, r); !ok {
		return
	}
	source, ok := readPlantumlSource(w, r)
	if !ok {
		return
	}
	s.writePlantumlRender(w, r, source)
}

// RenderPlantumlPublicSpace POST /api/public/spaces/{id}/render/plantuml — PUBLIC.
func (s *Server) RenderPlantumlPublicSpace(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "POST required")
		return
	}
	spaceID, ok := parseIDParam(w, r, "id")
	if !ok {
		return
	}
	if _, ok := s.requirePublicSpace(w, r, spaceID); !ok {
		return
	}
	source, ok := readPlantumlSource(w, r)
	if !ok {
		return
	}
	s.writePlantumlRender(w, r, source)
}
