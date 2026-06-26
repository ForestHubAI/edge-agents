//go:build !linux

package driver

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Off Linux there is no V4L2 or libcamera, so both capture sources fall back to
// the in-memory debug driver — a camera workflow still builds and boots, it just
// never produces a real frame.
func openV4L2(device string) (CameraDriver, error) { return openDebugCamera(CameraSourceV4L2, device) }
func openGStreamer(device string) (CameraDriver, error) {
	return openDebugCamera(CameraSourceGStreamer, device)
}

// Compile-time assertion: debugCamera implements CameraDriver.
var _ CameraDriver = (*debugCamera)(nil)

// debugCamera is an in-memory CameraDriver standing in for the real sources.
// Capture logs and returns no frame — a debug build never produces image data.
type debugCamera struct {
	log    zerolog.Logger
	source CameraSource
	device string
}

func openDebugCamera(source CameraSource, device string) (CameraDriver, error) {
	if device == "" {
		return nil, fmt.Errorf("camera: device is required")
	}
	d := &debugCamera{
		source: source,
		device: device,
		log: logging.Logger.With().
			Str("driver", "camera-debug").
			Str("source", string(source)).
			Str("device", device).
			Logger(),
	}
	d.log.Info().Msg("opened camera")
	return d, nil
}

func (d *debugCamera) Capture(ctx context.Context, width, height int) ([]byte, error) {
	d.log.Info().Int("width", width).Int("height", height).Msg("capture (debug: returns no frame)")
	return nil, nil
}

func (d *debugCamera) Close() error {
	d.log.Info().Msg("closing camera")
	return nil
}
