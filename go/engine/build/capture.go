package build

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/captureapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
)

// captureClientTimeout bounds a single capture call. It sits above the sidecar's
// worst case (captureTimeout 15s + WaitDelay 5s) so the sidecar's own 500 wins the
// race, while still freeing the node if the sidecar is unreachable.
const captureClientTimeout = 25 * time.Second

// captureEndpoint is the HTTP adapter for one declared camera channel: it
// implements engine.CaptureClient over the generated sidecar client, binding
// the camera name and capture size so callers pass only the context.
type captureEndpoint struct {
	client *captureapi.ClientWithResponses
	name   string
	width  int
	height int
}

var _ engine.CaptureClient = (*captureEndpoint)(nil)

// Capture asks the sidecar for one frame from the bound camera and returns the
// encoded bytes. Width and height are sent only when set.
func (e *captureEndpoint) Capture(ctx context.Context) ([]byte, error) {
	params := &captureapi.CaptureParams{Name: e.name}
	if e.width > 0 {
		params.Width = &e.width
	}
	if e.height > 0 {
		params.Height = &e.height
	}
	resp, err := e.client.CaptureWithResponse(ctx, params)
	if err != nil {
		return nil, fmt.Errorf("calling sidecar: %w", err)
	}
	if resp.StatusCode() != http.StatusOK {
		return nil, fmt.Errorf("sidecar returned %d: %s", resp.StatusCode(), captureErrorMessage(resp))
	}
	if len(resp.Body) == 0 {
		return nil, fmt.Errorf("sidecar returned an empty frame")
	}
	return resp.Body, nil
}

// captureErrorMessage extracts the sidecar's error message from a non-2xx
// response, falling back to the HTTP status text.
func captureErrorMessage(resp *captureapi.CaptureResponse) string {
	switch {
	case resp.JSON404 != nil:
		return resp.JSON404.Message
	case resp.JSON500 != nil:
		return resp.JSON500.Message
	default:
		return resp.Status()
	}
}

// buildDeployCapture resolves a workflow's declared camera channels into
// per-camera capture endpoints. A CAMERA channel that is unbound or points at a
// missing config is a deploy error. Many cameras may resolve to the same sidecar
// url — expected, since one sidecar owns a set of cameras and the camera name is
// sent per request. No network call is made here.
func buildDeployCapture(wf *workflow.Workflow, dm engine.DeploymentMapping, ext *engine.ExternalResources) (map[string]*captureEndpoint, error) {
	endpoints := make(map[string]*captureEndpoint)
	for _, cu := range wf.Channels {
		disc, err := cu.Discriminator()
		if err != nil {
			return nil, fmt.Errorf("declared channel: %w", err)
		}
		if disc != string(workflow.CAMERA) {
			continue
		}
		ch, err := cu.AsCAMERAChannel()
		if err != nil {
			return nil, fmt.Errorf("declared channel: %w", err)
		}
		b, ok := dm[ch.Id]
		if !ok || b.Ref == "" {
			return nil, fmt.Errorf("camera %q: declared but not bound by the deployment mapping", ch.Id)
		}
		var cfg engine.CameraConfig
		if ext != nil {
			cfg, ok = ext.Cameras[b.Ref]
		}
		if !ok {
			return nil, fmt.Errorf("camera %q: bound to %q but no camera config in deploy externalResources", ch.Id, b.Ref)
		}
		client, err := captureapi.NewClientWithResponses(cfg.URL, captureapi.WithHTTPClient(&http.Client{Timeout: captureClientTimeout}))
		if err != nil {
			return nil, fmt.Errorf("camera %q: building capture client: %w", ch.Id, err)
		}
		endpoints[ch.Id] = &captureEndpoint{
			client: client,
			name:   ch.Id,
			width:  derefInt(ch.Width),
			height: derefInt(ch.Height),
		}
	}
	return endpoints, nil
}

// derefInt returns the pointed-to int, or zero when the pointer is nil.
func derefInt(p *int) int {
	if p == nil {
		return 0
	}
	return *p
}
