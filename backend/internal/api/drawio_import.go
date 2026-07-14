package api

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"
)

// Draw.io diagram import: POST /api/drawio/import fetches remote diagram XML
// for the editor's "import from URL" flow. Session-authed only — makes outbound
// requests with the same SSRF guards as unfurl.

const drawioImportMaxBodyBytes = 2 << 20 // 2 MiB

type drawioImportRequest struct {
	URL string `json:"url"`
}

type drawioImportResponse struct {
	XML   string `json:"xml"`
	Title string `json:"title,omitempty"`
}

func isDrawioXML(body []byte) bool {
	s := strings.ToLower(string(body))
	return strings.Contains(s, "<mxfile") || strings.Contains(s, "<mxgraphmodel")
}

// ImportDrawioDiagram handles POST /api/drawio/import.
func (s *Server) ImportDrawioDiagram(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireUser(w, r); !ok {
		return
	}
	if !s.allowRateLimit(w, r, "drawio_import", s.unfurlLimiter) {
		return
	}

	var req drawioImportRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096)).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "could not parse request body")
		return
	}
	raw := strings.TrimSpace(req.URL)
	if raw == "" {
		writeError(w, http.StatusBadRequest, "bad_request", "url required")
		return
	}
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" {
		writeError(w, http.StatusBadRequest, "unsupported_url", "url must be a valid http(s) URL")
		return
	}

	ctx, cancel := context.WithTimeout(r.Context(), unfurlTimeout)
	defer cancel()
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad_request", "could not build request")
		return
	}
	httpReq.Header.Set("User-Agent", "tela-drawio-import/1.0 (+https://telawiki.com)")
	httpReq.Header.Set("Accept", "application/xml,text/xml,text/plain,*/*")

	resp, err := newUnfurlClient().Do(httpReq)
	if err != nil {
		writeError(w, http.StatusBadGateway, "fetch_failed", "could not fetch URL")
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		writeError(w, http.StatusBadGateway, "fetch_failed", "remote URL returned non-200")
		return
	}

	body, err := io.ReadAll(io.LimitReader(resp.Body, drawioImportMaxBodyBytes))
	if err != nil {
		writeError(w, http.StatusBadGateway, "fetch_failed", "could not read response")
		return
	}
	if !isDrawioXML(body) {
		writeError(w, http.StatusUnprocessableEntity, "not_a_diagram", "response is not draw.io XML")
		return
	}

	writeJSON(w, http.StatusOK, drawioImportResponse{XML: string(body)})
}
