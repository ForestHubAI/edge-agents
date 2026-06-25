package channel

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/engine/driver"
)

// Camera is a still-capture channel wrapping a CameraDriver. Width and Height
// are the capture resolution from the channel declaration; zero requests the
// source's native resolution.
type Camera struct {
	Driver driver.CameraDriver
	Width  int
	Height int
}

// Setup is a no-op: the driver is opened by the registry at boot and the
// camera needs no per-channel wiring.
func (c *Camera) Setup() error { return nil }

// Capture grabs one frame at the channel's configured resolution.
func (c *Camera) Capture(ctx context.Context) ([]byte, error) {
	return c.Driver.Capture(ctx, c.Width, c.Height)
}
