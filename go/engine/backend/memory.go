package backend

import (
	"context"
	"fmt"
	"net/http"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
)

type memoryUpsertBody struct {
	Content string `json:"content"`
}

// Hydrate pulls every memory file owned by the calling agent. The Manager
// calls this on a cold start to seed an empty local working copy.
func (c *Client) Hydrate(ctx context.Context) ([]workflow.MemoryFile, error) {
	var out []workflow.MemoryFile
	if err := c.http.Do(ctx, http.MethodGet, "/agents/memory", nil, nil, &out); err != nil {
		return nil, fmt.Errorf("backend memory hydrate: %w", err)
	}
	return out, nil
}

// Push mirrors new content for the memory file identified by uid to the
// backend. The Manager calls this best-effort after every local write.
// The backend rejects unknown uids (404) and oversized payloads (413).
func (c *Client) Push(ctx context.Context, uid, content string) error {
	body := memoryUpsertBody{Content: content}
	if err := c.http.Do(ctx, http.MethodPut, "/agents/memory/"+uid, nil, body, nil); err != nil {
		return fmt.Errorf("backend memory push: %w", err)
	}
	return nil
}
