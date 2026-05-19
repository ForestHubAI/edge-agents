package backend

import (
	"context"
	"net/http"
	"time"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/logging"
)

// retryInterval is the cadence at which BootCallbackWithRetry re-tries while
// the backend is still unreachable. Declared as a var (not const) so tests
// can shrink it without forcing real-time delays.
var retryInterval = 30 * time.Second

// bootCallbackBody mirrors workflow.AgentBootCallback. The JSON tags on
// domain.DeviceManifest match the wire shape the backend expects, so we
// don't need a separate api-typed conversion here. Address is omitempty so
// Cloud-mode engines behind NAT can omit it; the backend then keeps the
// stored address as SQL NULL.
type bootCallbackBody struct {
	Address              string                 `json:"address,omitempty"`
	Status               string                 `json:"status"`
	LoadedDeviceManifest *engine.DeviceManifest `json:"loadedDeviceManifest,omitempty"`
	Error                *string                `json:"error,omitempty"`
}

// BootCallback performs a single POST /agents/bootCallback. The
// publicAddress is the externally reachable URL of this engine, e.g.
// "http://10.0.1.50:8081". The status is either "online" or "booterror";
// loadedManifest may be nil when status is "booterror" (e.g. the engine
// could not parse its manifest at all). errorMsg is populated only on
// "booterror" with a human-readable failure detail.
func (c *Client) BootCallback(ctx context.Context, publicAddress, status string, loadedManifest *engine.DeviceManifest, errorMsg *string) error {
	body := bootCallbackBody{
		Address:              publicAddress,
		Status:               status,
		LoadedDeviceManifest: loadedManifest,
		Error:                errorMsg,
	}
	return c.http.Do(ctx, http.MethodPost, "/agents/bootCallback", nil, body, nil)
}

// BootCallbackWithRetry calls BootCallback repeatedly until the first
// success or until ctx is canceled (typically SIGTERM). Each attempt gets
// its own BootCallbackTimeout so a wedged attempt cannot stall the loop.
// Engines that boot before the backend is reachable use this to become
// self-healing — the registration eventually lands once the backend is up.
func (c *Client) BootCallbackWithRetry(ctx context.Context, publicAddress, status string, loadedManifest *engine.DeviceManifest, errorMsg *string) {
	attempt := 0
	for {
		attempt++
		attemptCtx, cancel := context.WithTimeout(ctx, BootCallbackTimeout)
		err := c.BootCallback(attemptCtx, publicAddress, status, loadedManifest, errorMsg)
		cancel()
		if err == nil {
			logging.Logger.Info().Int("attempt", attempt).Str("address", publicAddress).Str("status", status).Msg("agent boot callback acknowledged by backend")
			return
		}
		logging.Logger.Warn().Err(err).Int("attempt", attempt).Msg("boot callback failed; retrying")

		select {
		case <-ctx.Done():
			return
		case <-time.After(retryInterval):
		}
	}
}
