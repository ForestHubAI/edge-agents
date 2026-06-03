package backend

import (
	"context"
	"net/http"
)

// heartbeatBody mirrors workflow.AgentHeartbeatRequest. Address uses omitempty so
// Cloud-mode engines behind NAT can send {} instead of triggering an
// address-write on the backend.
type heartbeatBody struct {
	Address string `json:"address,omitempty"`
}

// Heartbeat performs a single POST /agents/heartbeat. The publicAddress is
// the externally reachable URL of this engine, e.g. "http://10.0.1.50:8081",
// or "" for Cloud-mode engines behind NAT.
func (c *Client) Heartbeat(ctx context.Context, publicAddress string) error {
	body := heartbeatBody{Address: publicAddress}
	return c.http.Do(ctx, http.MethodPost, "/agents/heartbeat", nil, body, nil)
}
