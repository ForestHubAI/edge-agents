// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"fmt"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/websearch"
)

// Implementation guard
var _ engine.ToolProvider = (*WebSearchTool)(nil)

const (
	webSearchDefaultMax = 5
	webSearchHardMax    = 20 // upper bound — providers like Brave cap around this

	// webSearchToolDescription is hardcoded since this node has no user-
	// configurable description — the tool behaviour is fully determined by
	// the backend.
	webSearchToolDescription = "Search the web for up-to-date information. " +
		"Returns a list of result titles, URLs, and short snippets. " +
		"Follow up with a fetch tool when more detail is needed."
)

// WebSearchTool exposes a web search engine as an LLM-callable tool. Tool-only
// — never participates in control flow, never emits a scope variable.
type WebSearchTool struct {
	engine.ToolNode
	provider   websearch.Provider
	maxResults int
}

// NewWebSearchTool builds a WebSearchTool node bound to the given provider.
// provider may be nil; the build path is expected to reject that case so a
// misconfigured engine fails at boot rather than at tool-call time.
func NewWebSearchTool(id string, provider websearch.Provider, maxResults int) *WebSearchTool {
	if maxResults <= 0 || maxResults > webSearchHardMax {
		maxResults = webSearchDefaultMax
	}
	return &WebSearchTool{
		ToolNode:   engine.NewToolNode(id),
		provider:   provider,
		maxResults: maxResults,
	}
}

// Tools exposes this node as `web_search(query, count?)` → string.
func (n *WebSearchTool) Tools() ([]llmproxy.FunctionTool, error) {
	type input struct {
		Query string `json:"query"`
		Count int    `json:"count,omitempty"`
	}
	run := func(ctx context.Context, args input) (string, error) {
		query := strings.TrimSpace(args.Query)
		if query == "" {
			return "", fmt.Errorf("web_search %s: query is required", n.ID())
		}
		if n.provider == nil {
			return "", fmt.Errorf("web_search %s: no search provider configured", n.ID())
		}
		count := args.Count
		if count <= 0 || count > n.maxResults {
			count = n.maxResults
		}
		out, err := n.provider.Search(ctx, query, count)
		if err != nil {
			return "", fmt.Errorf("web_search %s: %w", n.ID(), err)
		}
		return out, nil
	}
	ft, err := llmproxy.NewFunctionTool("web_search", webSearchToolDescription, run)
	if err != nil {
		return nil, fmt.Errorf("web_search %s: %w", n.ID(), err)
	}
	return []llmproxy.FunctionTool{ft}, nil
}
