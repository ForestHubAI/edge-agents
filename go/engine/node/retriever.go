// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"fmt"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Implementation guards
var _ engine.Executable = (*Retriever)(nil)
var _ engine.Emitter = (*Retriever)(nil)
var _ engine.ToolProvider = (*Retriever)(nil)

// retrieverOutID is the ID used for the retriever's result slot.
const retrieverOutID = "output"

// Retriever queries a RAG collection. In control-flow mode it evaluates the
// configured query expression against the scope and writes a formatted results
// string to the bound slot. As a tool, the LLM supplies the query directly and
// the output binding is bypassed — the tool returns the formatted string.
type Retriever struct {
	engine.LinearNode
	collectionID    string
	topK            int
	query           workflowapi.Expression
	binding         workflowapi.OutputBinding
	toolDescription string
	retriever       engine.Retriever
	logger          zerolog.Logger // child of logging.Logger with stable per-node attrs
}

// NewRetriever builds a Retriever. Fails the build path if rag is nil; tool
// path will fail at invocation time through the same nil check.
func NewRetriever(
	id string,
	collectionID string,
	topK int,
	query workflowapi.Expression,
	binding workflowapi.OutputBinding,
	toolDescription string,
	ret engine.Retriever,
) *Retriever {
	return &Retriever{
		LinearNode:      engine.NewLinearNode(id),
		collectionID:    collectionID,
		topK:            topK,
		query:           query,
		binding:         binding,
		toolDescription: toolDescription,
		retriever:       ret,
		logger: logging.Logger.With().
			Str("node", id).
			Str("collectionId", collectionID).
			Int("topK", topK).
			Logger(),
	}
}

func (r *Retriever) Outputs() map[string]workflowapi.DataType {
	return engine.FilterEmitted(
		map[string]workflowapi.DataType{retrieverOutID: workflowapi.String},
		map[string]workflowapi.OutputBinding{retrieverOutID: r.binding},
	)
}

func (r *Retriever) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	query, err := expr.EvalString(r.query, scope)
	if err != nil {
		return "", fmt.Errorf("retriever %s: query: %w", r.ID(), err)
	}
	text, err := r.retrieve(ctx, query)
	if err != nil {
		return "", fmt.Errorf("retriever %s: %w", r.ID(), err)
	}
	if err := engine.ApplyOutput(scope, r.ID(), retrieverOutID, r.binding, expr.StringVal(text)); err != nil {
		return "", fmt.Errorf("retriever %s: applying output: %w", r.ID(), err)
	}
	return r.Next(engine.PortCtrl, scope)
}

// retrieve runs the similarity query and concatenates the result chunks into a
// single context string separated by "\n---\n". No results → empty string.
// Emits an Activity log on success so the backend's agent_activity ledger
// records the call.
func (r *Retriever) retrieve(ctx context.Context, query string) (string, error) {
	results, err := r.retriever.QueryRAG(ctx, engine.RAGQueryParams{
		CollectionID: r.collectionID,
		Query:        query,
		TopK:         r.topK,
	})
	if err != nil {
		return "", err
	}
	r.logger.Info().
		Str("action", "rag_query").
		Str("summary", fmt.Sprintf("%q · %d results", truncate(query, 50), len(results))).
		Str("query", query).
		Int("resultCount", len(results)).
		Msg("rag.query")
	var sb strings.Builder
	for i, res := range results {
		if i > 0 {
			sb.WriteString("\n---\n")
		}
		sb.WriteString(res.Content)
	}
	return sb.String(), nil
}

// truncate returns s shortened to maxLen runes with an ellipsis suffix when cut.
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "…"
}

// Tools exposes this retriever as an LLM-callable tool.
func (r *Retriever) Tools() ([]llmproxy.FunctionTool, error) {
	type inputQuery struct {
		Query string `json:"query"`
	}
	run := func(ctx context.Context, args inputQuery) (string, error) {
		text, err := r.retrieve(ctx, args.Query)
		if err != nil {
			return "", fmt.Errorf("retriever %s: %w", r.ID(), err)
		}
		return text, nil
	}
	ft, err := llmproxy.NewFunctionTool("retrieve_context", r.toolDescription, run)
	if err != nil {
		return nil, fmt.Errorf("retriever %s: %w", r.ID(), err)
	}
	return []llmproxy.FunctionTool{ft}, nil
}
