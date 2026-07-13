package api

import (
	"context"
	"errors"
	"net/http"

	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/zcag/tela/backend/internal/auth"
	"github.com/zcag/tela/backend/internal/macromd"
)

// mcpMacroSource resolves macro includes using the same auth gates as the REST API.
type mcpMacroSource struct {
	ctx context.Context
	s   *Server
	u   *auth.User
	k   *auth.APIKey
}

func (src *mcpMacroSource) MacroInnerBody(macroID string) (string, bool, error) {
	dto, ae := src.s.getMacroCore(src.ctx, src.u, src.k, macroID)
	if ae != nil {
		if ae.Status == http.StatusNotFound {
			return "", false, nil
		}
		return "", false, errors.New(ae.Message)
	}
	return dto.Body, true, nil
}

func (src *mcpMacroSource) PageBody(pageID int64) (string, bool, error) {
	dto, ae := src.s.getPageIncludeCore(src.ctx, src.u, src.k, pageID)
	if ae != nil {
		if ae.Status == http.StatusNotFound {
			return "", false, nil
		}
		return "", false, errors.New(ae.Message)
	}
	return dto.Body, true, nil
}

func (s *Server) mcpGetPageResolved(ctx context.Context, req *mcp.CallToolRequest, in getPageIn) (*mcp.CallToolResult, getPageOut, error) {
	u, k := mcpIdentity(req)
	if u == nil {
		return mcpUnauthErr(), getPageOut{}, nil
	}
	p, ae := s.getPageCore(ctx, u, k, in.ID)
	if ae != nil {
		return mcpErr(ae), getPageOut{}, nil
	}
	if in.Format == "map" || in.Format == "values" {
		return mcpErr(&apiErr{
			http.StatusBadRequest, "invalid_format",
			`format "map" and "values" apply to get_page only; get_page_resolved always returns the expanded body`,
		}), getPageOut{}, nil
	}
	epi := s.pageEpistemic(ctx, p)
	src := &mcpMacroSource{ctx: ctx, s: s, u: u, k: k}
	resolved, err := macromd.ResolveMacros(p.Body, src)
	if err != nil {
		if errors.Is(err, macromd.ErrResolveDepth) {
			return mcpErr(&apiErr{http.StatusBadRequest, "macro_depth", err.Error()}), getPageOut{}, nil
		}
		return mcpErr(&apiErr{http.StatusInternalServerError, "internal", "resolve macros failed"}), getPageOut{}, nil
	}
	p.Body = resolved
	body, whole := mcpCapBody(p.Body)
	p.Body = body
	out := getPageOut{Page: mcpPage{Page: p, URL: s.mcpPageURL(ctx, p), Truncated: !whole, Epistemic: epi}}
	return nil, out, nil
}
