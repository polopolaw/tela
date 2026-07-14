package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestImportDrawioDiagramRequiresAuth(t *testing.T) {
	srv := testAPIServer(t)
	req := httptest.NewRequest(http.MethodPost, "/api/drawio/import", strings.NewReader(`{"url":"https://example.com/d.xml"}`))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	srv.ImportDrawioDiagram(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d, want 401", rr.Code)
	}
}

func TestImportDrawioDiagramRejectsPrivateIP(t *testing.T) {
	ts, _ := newWiredServer(t)
	c := loginClient(t, ts, "admin", "adminpw12")

	req, err := http.NewRequest(http.MethodPost, ts.URL+"/api/drawio/import", strings.NewReader(`{"url":"http://127.0.0.1/diagram.xml"}`))
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Fatalf("status = %d, want 502", resp.StatusCode)
	}
}

func TestIsDrawioXML(t *testing.T) {
	if !isDrawioXML([]byte(`<mxfile><diagram></diagram></mxfile>`)) {
		t.Fatal("expected mxfile to match")
	}
	if isDrawioXML([]byte(`<html></html>`)) {
		t.Fatal("expected html to not match")
	}
}
