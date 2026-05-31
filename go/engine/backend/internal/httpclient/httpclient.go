// Package httpclient is a minimal JSON HTTP client vendored into the engine
// so the fh-backend capability implementation has no dependency on the
// closed fh-backend module. It mirrors the small surface the backend client
// used: NewClient(baseURL, authHeader, authValue) + Do(ctx, ...).
package httpclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// defaultTimeout is the per-request ceiling for the underlying http.Client.
// Callers are expected to pass their own context.WithTimeout for tighter
// per-call deadlines (e.g. BootCallbackTimeout=10s, HeartbeatTimeout=5s),
// but this default protects call sites that forget — most notably the deploy
// path (engine.Engine.Deploy → memory.Restore → Snapshot), which inherits an
// uncapped context and would otherwise hang the engine on an unreachable
// backend. 30s is loose enough not to interfere with the tighter per-call
// timeouts and long enough for a slow first-byte on a healthy backend.
const defaultTimeout = 30 * time.Second

// Client is a JSON-over-HTTP client that attaches a fixed auth header to
// every request.
type Client struct {
	baseURL    string
	authHeader string
	authValue  string
	http       *http.Client
}

// NewClient builds a Client. authHeader/authValue are sent on every request
// (e.g. "Agent-Key", <secret>); pass "" for authHeader to disable auth.
func NewClient(baseURL, authHeader, authValue string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		authHeader: authHeader,
		authValue:  authValue,
		http:       &http.Client{Timeout: defaultTimeout},
	}
}

// Do executes method baseURL+path. body, when non-nil, is JSON-encoded as the
// request body. out, when non-nil, receives the JSON-decoded response. A
// non-2xx status returns an error carrying the status and response snippet.
// Per-call deadlines come from ctx (callers wrap with context.WithTimeout).
func (c *Client) Do(ctx context.Context, method, path string, query url.Values, body, out any) error {
	u := c.baseURL + path
	if len(query) > 0 {
		u += "?" + query.Encode()
	}

	var reader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("httpclient: marshal body: %w", err)
		}
		reader = bytes.NewReader(b)
	}

	req, err := http.NewRequestWithContext(ctx, method, u, reader)
	if err != nil {
		return fmt.Errorf("httpclient: new request: %w", err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.authHeader != "" {
		req.Header.Set(c.authHeader, c.authValue)
	}

	resp, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("httpclient: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		snippet, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("httpclient: %s %s: status %d: %s", method, path, resp.StatusCode, strings.TrimSpace(string(snippet)))
	}

	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil && err != io.EOF {
			return fmt.Errorf("httpclient: decode response: %w", err)
		}
	}
	return nil
}
