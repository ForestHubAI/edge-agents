// Package websearch hosts the web search provider abstraction used by the
// engine's WebSearchTool node. The Provider interface is the contract; one
// concrete implementation per supported engine lives alongside it.
package websearch

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

const requestTimeout = 15 * time.Second

// Provider runs a search query against an external engine and returns a
// human-readable, LLM-consumable formatted string of results.
type Provider interface {
	Search(ctx context.Context, query string, count int) (string, error)
}

// New returns a configured Provider for the given engine name. An empty
// apiKey is rejected for engines that require one. Unknown names produce
// an error so misconfiguration surfaces early.
func New(name, apiKey string) (Provider, error) {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "brave":
		if apiKey == "" {
			return nil, errors.New("brave search requires an api key")
		}
		return &braveProvider{
			apiKey: apiKey,
			client: &http.Client{Timeout: requestTimeout},
		}, nil
	default:
		return nil, fmt.Errorf("unknown web search provider %q", name)
	}
}
