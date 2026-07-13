package api

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
)

func testAPIServer(t *testing.T) *Server {
	t.Helper()
	return New(newAPITestDB(t))
}

func TestRenderPlantuml_Unconfigured(t *testing.T) {
	t.Setenv("TELA_KROKI_URL", "")
	srv := testAPIServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/render/plantuml",
		strings.NewReader(`{"source":"@startuml\nA -> B\n@enduml"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.RenderPlantuml(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), plantumlUnconfiguredCode) {
		t.Fatalf("body = %q", rec.Body.String())
	}
}

func TestRenderPlantuml_Oversized(t *testing.T) {
	t.Setenv("TELA_KROKI_URL", "http://127.0.0.1:1")
	srv := testAPIServer(t)

	big := strings.Repeat("x", maxPlantumlSourceBytes+1)
	req := httptest.NewRequest(http.MethodPost, "/api/render/plantuml",
		strings.NewReader(`{"source":"`+big+`"}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.RenderPlantuml(rec, req)

	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d, want 413", rec.Code)
	}
}

func TestRenderPlantumlViaKroki_RoundTrip(t *testing.T) {
	kroki := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/plantuml/svg" {
			t.Fatalf("path = %q", r.URL.Path)
		}
		if ct := r.Header.Get("Content-Type"); ct != "text/plain" {
			t.Fatalf("content-type = %q", ct)
		}
		body, _ := io.ReadAll(r.Body)
		if !strings.Contains(string(body), "@startuml") {
			t.Fatalf("body = %q", body)
		}
		w.Header().Set("Content-Type", "image/svg+xml")
		_, _ = w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"/>`))
	}))
	defer kroki.Close()

	t.Setenv("TELA_KROKI_URL", kroki.URL)
	svg, status, err := renderPlantumlViaKroki(t.Context(), "@startuml\nAlice -> Bob\n@enduml")
	if err != nil || status != http.StatusOK {
		t.Fatalf("render: status=%d err=%v", status, err)
	}
	if !strings.Contains(string(svg), "<svg") {
		t.Fatalf("svg = %q", svg)
	}
}

func TestRenderPlantumlPrint_InvalidToken(t *testing.T) {
	t.Setenv("TELA_KROKI_URL", "")
	srv := testAPIServer(t)

	req := httptest.NewRequest(http.MethodPost, "/api/print/bad-token/render/plantuml",
		strings.NewReader(`{"source":"@startuml\n@enduml"}`))
	req.Header.Set("Content-Type", "application/json")
	req.SetPathValue("token", "bad-token")
	rec := httptest.NewRecorder()
	srv.RenderPlantumlPrint(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status = %d, want 404", rec.Code)
	}
}

func krokiReachable(base string) bool {
	resp, err := http.Post(strings.TrimRight(base, "/")+"/plantuml/svg", "text/plain",
		strings.NewReader("@startuml\n@enduml"))
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	return resp.StatusCode == http.StatusOK
}

func TestIntegration_RenderPlantuml(t *testing.T) {
	base := os.Getenv("TELA_KROKI_URL")
	if base == "" {
		base = "http://127.0.0.1:18080"
	}
	if !krokiReachable(base) {
		t.Skipf("kroki not reachable at %s (start with: docker run -p 18080:8000 yuzutech/kroki:0.26.0)", base)
	}
	t.Setenv("TELA_KROKI_URL", base)

	ts, d := newWiredServer(t)
	seedUser(t, d, "alice", "alicepw12", false)
	c := loginClient(t, ts, "alice", "alicepw12")

	resp, err := c.Post(ts.URL+"/api/render/plantuml", "application/json",
		strings.NewReader(`{"source":"@startuml\nAlice -> Bob: hi\n@enduml"}`))
	if err != nil {
		t.Fatalf("post render: %v", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("authed render status=%d body=%s", resp.StatusCode, body)
	}
	if ct := resp.Header.Get("Content-Type"); !strings.Contains(ct, "image/svg+xml") {
		t.Fatalf("content-type = %q", ct)
	}
	if !strings.Contains(string(body), "<svg") {
		t.Fatalf("body missing svg: %q", string(body[:min(120, len(body))]))
	}

	// Unauthed request must not render.
	resp2, err := http.Post(ts.URL+"/api/render/plantuml", "application/json",
		strings.NewReader(`{"source":"@startuml\n@enduml"}`))
	if err != nil {
		t.Fatalf("unauthed post: %v", err)
	}
	defer resp2.Body.Close()
	if resp2.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unauthed status=%d want 401", resp2.StatusCode)
	}
}
