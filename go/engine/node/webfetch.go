package node

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"sync"
	"time"

	"fh-backend/pkg/api"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*WebFetch)(nil)
var _ engine.Emitter = (*WebFetch)(nil)

const webFetchOutID = "output"

const (
	webFetchDefaultMaxChars = 50_000
	webFetchMaxBytes        = 5 << 20 // 5 MiB hard cap on response body
	webFetchTimeout         = 30 * time.Second
	webFetchUserAgent       = "Mozilla/5.0 (compatible; ForestHub/1.0; +https://foresthub.ai)"
)

// HTML-to-text regexes. Compiled once at package init.
var (
	reWebFetchScript     = regexp.MustCompile(`<script[\s\S]*?</script>`)
	reWebFetchStyle      = regexp.MustCompile(`<style[\s\S]*?</style>`)
	reWebFetchTags       = regexp.MustCompile(`<[^>]+>`)
	reWebFetchWhitespace = regexp.MustCompile(`[^\S\n]+`)
	reWebFetchBlankLines = regexp.MustCompile(`\n{3,}`)
)

// webFetchClient is a process-wide HTTP client with SSRF-safe dialing.
// Built lazily on first use.
var webFetchClient = sync.OnceValue(newWebFetchClient)

func newWebFetchClient() *http.Client {
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	transport := &http.Transport{
		DialContext:           safeDialContext(dialer),
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		ExpectContinueTimeout: 1 * time.Second,
		MaxIdleConns:          50,
		IdleConnTimeout:       90 * time.Second,
	}
	return &http.Client{Timeout: webFetchTimeout, Transport: transport}
}

// WebFetch fetches an HTTP(S) URL and emits the cleaned page text. Evaluates
// the configured URL expression against the scope and writes the extracted
// text to the bound slot. Control-flow only — not exposed as an LLM tool.
type WebFetch struct {
	engine.LinearNode
	url      api.Expression
	maxChars int
	binding  api.OutputBinding
}

// NewWebFetch builds a WebFetch node. maxChars <= 0 falls back to the default cap.
func NewWebFetch(id string, urlExpr api.Expression, maxChars int, binding api.OutputBinding) *WebFetch {
	if maxChars <= 0 {
		maxChars = webFetchDefaultMaxChars
	}
	return &WebFetch{
		LinearNode: engine.NewLinearNode(id),
		url:        urlExpr,
		maxChars:   maxChars,
		binding:    binding,
	}
}

func (n *WebFetch) Outputs() map[string]api.DataType {
	return engine.FilterEmitted(
		map[string]api.DataType{webFetchOutID: api.String},
		map[string]api.OutputBinding{webFetchOutID: n.binding},
	)
}

func (n *WebFetch) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	urlStr, err := expr.EvalString(n.url, scope)
	if err != nil {
		return "", fmt.Errorf("web_fetch %s: url: %w", n.ID(), err)
	}
	text, err := n.fetch(ctx, urlStr, n.maxChars)
	if err != nil {
		return "", fmt.Errorf("web_fetch %s: %w", n.ID(), err)
	}
	if err := engine.ApplyOutput(scope, n.ID(), webFetchOutID, n.binding, expr.StringVal(text)); err != nil {
		return "", fmt.Errorf("web_fetch %s: applying output: %w", n.ID(), err)
	}
	return n.Next(engine.PortCtrl, scope)
}

// fetch validates the URL, applies SSRF pre-checks, performs the GET, reads up
// to webFetchMaxBytes, extracts text from HTML payloads, and truncates the
// result to maxChars.
func (n *WebFetch) fetch(ctx context.Context, rawURL string, maxChars int) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return "", fmt.Errorf("invalid url: %w", err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return "", fmt.Errorf("only http/https urls allowed, got %q", parsed.Scheme)
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("missing host in url")
	}
	if isObviousPrivateHost(parsed.Hostname()) {
		return "", fmt.Errorf("fetching private or local hosts is not allowed")
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, parsed.String(), nil)
	if err != nil {
		return "", fmt.Errorf("building request: %w", err)
	}
	req.Header.Set("User-Agent", webFetchUserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")

	resp, err := webFetchClient().Do(req)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(http.MaxBytesReader(nil, resp.Body, webFetchMaxBytes))
	if err != nil {
		var maxBytesErr *http.MaxBytesError
		if errors.As(err, &maxBytesErr) {
			return "", fmt.Errorf("response exceeded %d byte limit", webFetchMaxBytes)
		}
		return "", fmt.Errorf("reading response: %w", err)
	}

	bodyStr := string(body)
	contentType := strings.ToLower(resp.Header.Get("Content-Type"))
	var text string
	if strings.Contains(contentType, "text/html") || looksLikeHTML(bodyStr) {
		text = extractTextFromHTML(bodyStr)
	} else {
		text = bodyStr
	}
	if len(text) > maxChars {
		text = text[:maxChars] + "\n[Content truncated due to size limit]"
	}
	return text, nil
}

// extractTextFromHTML strips <script>, <style>, and all other tags, then
// collapses whitespace into readable text. Not a full HTML parser — regex-based,
// good enough for prose extraction from typical pages.
func extractTextFromHTML(htmlContent string) string {
	out := reWebFetchScript.ReplaceAllLiteralString(htmlContent, "")
	out = reWebFetchStyle.ReplaceAllLiteralString(out, "")
	out = reWebFetchTags.ReplaceAllLiteralString(out, "")
	out = strings.TrimSpace(out)
	out = reWebFetchWhitespace.ReplaceAllString(out, " ")
	out = reWebFetchBlankLines.ReplaceAllString(out, "\n\n")
	lines := strings.Split(out, "\n")
	clean := lines[:0]
	for _, line := range lines {
		if line = strings.TrimSpace(line); line != "" {
			clean = append(clean, line)
		}
	}
	return strings.Join(clean, "\n")
}

func looksLikeHTML(body string) bool {
	if body == "" {
		return false
	}
	lower := strings.ToLower(strings.TrimSpace(body))
	return strings.HasPrefix(lower, "<!doctype") || strings.HasPrefix(lower, "<html")
}

// isObviousPrivateHost performs a fast, no-DNS check for hosts that should
// never be fetched. The real guard is safeDialContext, which re-resolves at
// connect time to defeat DNS rebinding.
func isObviousPrivateHost(host string) bool {
	h := strings.ToLower(strings.TrimSpace(host))
	h = strings.TrimSuffix(h, ".")
	if h == "" || h == "localhost" || strings.HasSuffix(h, ".localhost") {
		return true
	}
	if ip := net.ParseIP(h); ip != nil {
		return isPrivateOrRestrictedIP(ip)
	}
	return false
}

// isPrivateOrRestrictedIP blocks loopback, private (RFC 1918), link-local
// (including 169.254.169.254 cloud metadata), carrier-grade NAT, IPv6
// unique-local (fc00::/7), 6to4 (2002::/16), and Teredo (2001:0000::/32).
func isPrivateOrRestrictedIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsLoopback() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() ||
		ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	if ip4 := ip.To4(); ip4 != nil {
		switch {
		case ip4[0] == 10,
			ip4[0] == 127,
			ip4[0] == 0,
			ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31,
			ip4[0] == 192 && ip4[1] == 168,
			ip4[0] == 169 && ip4[1] == 254,
			ip4[0] == 100 && ip4[1] >= 64 && ip4[1] <= 127:
			return true
		}
		return false
	}
	if len(ip) == net.IPv6len {
		if (ip[0] & 0xfe) == 0xfc {
			return true
		}
		if ip[0] == 0x20 && ip[1] == 0x02 {
			return isPrivateOrRestrictedIP(net.IPv4(ip[2], ip[3], ip[4], ip[5]))
		}
		if ip[0] == 0x20 && ip[1] == 0x01 && ip[2] == 0x00 && ip[3] == 0x00 {
			return isPrivateOrRestrictedIP(net.IPv4(ip[12]^0xff, ip[13]^0xff, ip[14]^0xff, ip[15]^0xff))
		}
	}
	return false
}

// safeDialContext re-resolves DNS at connect time so a hostname that pre-flight
// resolved to a public IP cannot be flipped to a private IP by an attacker
// (DNS rebinding). Any resolved address that fails isPrivateOrRestrictedIP is
// dropped from the candidate list.
func safeDialContext(dialer *net.Dialer) func(context.Context, string, string) (net.Conn, error) {
	return func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, fmt.Errorf("invalid target %q: %w", address, err)
		}
		if host == "" {
			return nil, fmt.Errorf("empty target host")
		}
		if ip := net.ParseIP(host); ip != nil {
			if isPrivateOrRestrictedIP(ip) {
				return nil, fmt.Errorf("blocked private target: %s", host)
			}
			return dialer.DialContext(ctx, network, net.JoinHostPort(ip.String(), port))
		}
		ipAddrs, err := net.DefaultResolver.LookupIPAddr(ctx, host)
		if err != nil {
			return nil, fmt.Errorf("resolving %s: %w", host, err)
		}
		var lastErr error
		attempted := 0
		for _, a := range ipAddrs {
			if isPrivateOrRestrictedIP(a.IP) {
				continue
			}
			attempted++
			conn, derr := dialer.DialContext(ctx, network, net.JoinHostPort(a.IP.String(), port))
			if derr == nil {
				return conn, nil
			}
			lastErr = derr
		}
		if attempted == 0 {
			return nil, fmt.Errorf("all resolved addresses for %s are private or restricted", host)
		}
		return nil, fmt.Errorf("connect failed for %s: %w", host, lastErr)
	}
}
