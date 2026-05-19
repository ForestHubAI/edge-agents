package websearch

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

const braveEndpoint = "https://api.search.brave.com/res/v1/web/search"

// braveProvider implements Provider against the Brave Search API.
// https://api.search.brave.com/app/documentation/web-search/get-started
type braveProvider struct {
	apiKey string
	client *http.Client
}

func (p *braveProvider) Search(ctx context.Context, query string, count int) (string, error) {
	u, err := url.Parse(braveEndpoint)
	if err != nil {
		return "", fmt.Errorf("brave: build url: %w", err)
	}
	q := u.Query()
	q.Set("q", query)
	if count > 0 {
		q.Set("count", strconv.Itoa(count))
	}
	u.RawQuery = q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return "", fmt.Errorf("brave: build request: %w", err)
	}
	req.Header.Set("X-Subscription-Token", p.apiKey)
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Accept-Encoding", "gzip")

	resp, err := p.client.Do(req)
	if err != nil {
		return "", fmt.Errorf("brave: request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return "", fmt.Errorf("brave: %s: %s", resp.Status, strings.TrimSpace(string(body)))
	}

	var br struct {
		Web struct {
			Results []struct {
				Title       string `json:"title"`
				URL         string `json:"url"`
				Description string `json:"description"`
			} `json:"results"`
		} `json:"web"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&br); err != nil {
		return "", fmt.Errorf("brave: parse: %w", err)
	}
	if len(br.Web.Results) == 0 {
		return "No results.", nil
	}

	var sb strings.Builder
	for i, r := range br.Web.Results {
		if i > 0 {
			sb.WriteString("\n\n")
		}
		fmt.Fprintf(&sb, "%d. %s\n   URL: %s\n   %s",
			i+1, strings.TrimSpace(r.Title), strings.TrimSpace(r.URL), strings.TrimSpace(r.Description))
	}
	return sb.String(), nil
}
