// Package backend is the engine-side HTTP client for everything the engine
// needs from fh-backend: log shipping, memory sync, LLM chat, RAG queries.
// All requests authenticate with the engine's agent secret via the Agent-Key
// header (validated by the backend's AgentKeyAuth middleware). Status and
// liveness are NOT here — Ranger observes the engine container and reports them.
package backend

import (
	"time"

	"github.com/ForestHubAI/edge-agents/go/util/httpclient"
)

const (
	// ProviderLoadTimeout caps the one-shot /llm/providers fetch used to
	// discover backend-routed LLM fallbacks at engine startup.
	ProviderLoadTimeout = 10 * time.Second
)

// Client is the engine-side HTTP client for backend interactions.
// All requests carry the Agent-Key authorization header.
type Client struct {
	BackendURL string
	Secret     string
	http       *httpclient.Client
}

// NewClient constructs a Client backed by the shared httpclient.
func NewClient(backendURL, secret string) *Client {
	return &Client{
		BackendURL: backendURL,
		Secret:     secret,
		http:       httpclient.NewClient(backendURL, "Agent-Key", secret),
	}
}
