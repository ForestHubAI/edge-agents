package backend

import (
	"context"
	"net/http"

	"github.com/ForestHubAI/fh-core/go/engine"
)

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

// Register performs a single POST /agents/bootCallback. reg.Address is
// the externally reachable URL of this engine and may be empty for
// Cloud-mode engines behind NAT. reg.Manifest may be nil and reg.Error
// populated only when reg.Status is StatusBootError.
func (c *Client) Register(ctx context.Context, reg engine.AgentRegistration) error {
	body := bootCallbackBody{
		Address:              reg.Address,
		Status:               string(reg.Status),
		LoadedDeviceManifest: reg.Manifest,
		Error:                reg.Error,
	}
	return c.http.Do(ctx, http.MethodPost, "/agents/bootCallback", nil, body, nil)
}
