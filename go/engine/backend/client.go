// Package backend is the engine-side HTTP client for everything the engine
// needs from fh-backend: agent registration, log ingestion, LLM chat, RAG
// queries. All requests authenticate with the engine's agent secret via the
// Agent-Key header (validated by the backend's AgentKeyAuth middleware).
package backend

import (
	"time"

	"github.com/ForestHubAI/edge-agents/go/util/httpclient"
)

const (
	// BootCallbackTimeout caps the one-shot boot callback HTTP call so a
	// single unreachable backend cannot wedge engine startup.
	BootCallbackTimeout = 10 * time.Second
	// RegisterRetryInterval is the wait between failed Register attempts
	// when the backend is unreachable at engine startup.
	RegisterRetryInterval = 30 * time.Second
	// ProviderLoadTimeout caps the one-shot /llm/providers fetch used to
	// discover backend-routed LLM fallbacks at engine startup.
	ProviderLoadTimeout = 10 * time.Second
	// HeartbeatInterval is the cadence at which HeartbeatLoop ticks. Sized
	// at one third of the backend's 90s online-threshold so a single missed
	// tick does not flip the agent to offline.
	HeartbeatInterval = 30 * time.Second
	// HeartbeatTimeout caps a single heartbeat HTTP call so a hung attempt
	// cannot wedge the loop.
	HeartbeatTimeout = 5 * time.Second
)

// Client is the engine-side HTTP client for backend interactions.
// All requests carry the Agent-Key authorization header.
type Client struct {
	BackendURL  string
	AgentSecret string
	http        *httpclient.Client
}

// NewClient constructs a Client backed by the shared httpclient.
func NewClient(backendURL, agentSecret string) *Client {
	return &Client{
		BackendURL:  backendURL,
		AgentSecret: agentSecret,
		http:        httpclient.NewClient(backendURL, "Agent-Key", agentSecret),
	}
}
