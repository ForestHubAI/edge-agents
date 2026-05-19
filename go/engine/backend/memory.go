package backend

import (
	"context"
	"fmt"
	"net/http"

	"fh-backend/pkg/api"
)

// MemorySnapshot pulls every memory file owned by the calling agent. Called
// once at engine boot to populate the local working copy.
func (c *Client) MemorySnapshot(ctx context.Context) ([]api.MemoryFile, error) {
	var out []api.MemoryFile
	if err := c.http.Do(ctx, http.MethodGet, "/agents/memory", nil, nil, &out); err != nil {
		return nil, fmt.Errorf("backend memory snapshot: %w", err)
	}
	return out, nil
}

// MemoryUpsert pushes new content for the memory file identified by uid.
// The engine calls this synchronously after every successful local write.
// The backend rejects unknown uids (404) and oversized payloads (413).
func (c *Client) MemoryUpsert(ctx context.Context, uid, content string) error {
	body := api.MemoryFileWrite{Content: content}
	if err := c.http.Do(ctx, http.MethodPut, "/agents/memory/"+uid, nil, body, nil); err != nil {
		return fmt.Errorf("backend memory upsert: %w", err)
	}
	return nil
}
