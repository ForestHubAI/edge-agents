package backend

import (
	"context"
	"net/http"
	"time"

	"github.com/ForestHubAI/fh-core/go/engine/logging"
)

// heartbeatInterval is the cadence at which HeartbeatLoop ticks. Declared as
// a var (not const) so tests can shrink it without forcing real-time delays.
var heartbeatInterval = HeartbeatInterval

// heartbeatBody mirrors api.AgentHeartbeatRequest. Address uses omitempty so
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

// HeartbeatLoop ticks every heartbeatInterval, posting one Heartbeat per
// tick. Each call gets its own HeartbeatTimeout so a stuck attempt cannot
// stall the loop. HTTP errors are logged at warn level and the loop
// continues — heartbeats are best-effort liveness signals; a failed tick
// just means the backend will mark the agent offline once last_seen_at
// crosses the OnlineThreshold. Returns when ctx is canceled.
func (c *Client) HeartbeatLoop(ctx context.Context, publicAddress string) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()

	logging.Logger.Info().Dur("interval", heartbeatInterval).Str("address", publicAddress).Msg("heartbeat loop started")
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			attemptCtx, cancel := context.WithTimeout(ctx, HeartbeatTimeout)
			err := c.Heartbeat(attemptCtx, publicAddress)
			cancel()
			if err != nil {
				logging.Logger.Warn().Err(err).Msg("heartbeat failed")
			}
		}
	}
}
