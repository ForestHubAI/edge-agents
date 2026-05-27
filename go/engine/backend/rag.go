package backend

import (
	"context"
	"fmt"
	"net/http"

	"github.com/ForestHubAI/fh-core/go/api/engineapi"
	"github.com/ForestHubAI/fh-core/go/engine"
)

// QueryRAG forwards a similarity-search query through the backend's
// /rag/query route and returns the ranked results.
func (c *Client) QueryRAG(ctx context.Context, params engine.RAGQueryParams) ([]engine.RAGQueryResult, error) {
	body := engineapi.RagQueryRequest{
		CollectionID: params.CollectionID,
		Query:        params.Query,
		TopK:         &params.TopK,
	}
	var results []engineapi.RagQueryResult
	if err := c.http.Do(ctx, http.MethodPost, "/rag/query", nil, body, &results); err != nil {
		return nil, fmt.Errorf("backend rag query: %w", err)
	}
	out := make([]engine.RAGQueryResult, len(results))
	for i, r := range results {
		out[i] = engine.RAGQueryResult{
			ChunkID:    r.ChunkID,
			DocumentID: r.DocumentID,
			Content:    r.Content,
			Score:      r.Score,
		}
	}
	return out, nil
}
