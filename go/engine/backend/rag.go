package backend

import (
	"context"
	"fmt"
	"net/http"

	"fh-backend/pkg/api"
	"fh-backend/pkg/domain"
)

// QueryRAG forwards a similarity-search query through the backend's
// /rag/query route and returns the ranked results.
func (c *Client) QueryRAG(ctx context.Context, params domain.RAGQueryParams) ([]domain.RAGQueryResult, error) {
	body := api.RagQueryRequest{
		CollectionID: params.CollectionID,
		Query:        params.Query,
		TopK:         &params.TopK,
	}
	var results []api.RagQueryResult
	if err := c.http.Do(ctx, http.MethodPost, "/rag/query", nil, body, &results); err != nil {
		return nil, fmt.Errorf("backend rag query: %w", err)
	}
	out := make([]domain.RAGQueryResult, len(results))
	for i, r := range results {
		out[i] = domain.RAGQueryResult{
			ChunkID:    r.ChunkID,
			DocumentID: r.DocumentID,
			Content:    r.Content,
			Score:      float64(r.Score),
		}
	}
	return out, nil
}
