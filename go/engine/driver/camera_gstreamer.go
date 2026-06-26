//go:build linux

package driver

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Compile-time assertion: gstreamerCamera implements CameraDriver.
var _ CameraDriver = (*gstreamerCamera)(nil)

// Both camera sources capture through GStreamer; they differ only in how the
// manifest device becomes the pipeline's source element. v4l2 wraps a /dev path
// as a v4l2src element (USB/UVC); gstreamer takes the device verbatim as a source
// element (e.g. "libcamerasrc" for CSI/ISP).

func openV4L2(device string) (CameraDriver, error) {
	if device == "" {
		return nil, fmt.Errorf("camera: device is required")
	}
	return newGStreamerCamera(fmt.Sprintf("v4l2src device=%s", device), "v4l2"), nil
}

func openGStreamer(device string) (CameraDriver, error) {
	if device == "" {
		return nil, fmt.Errorf("camera: device is required")
	}
	return newGStreamerCamera(device, "gstreamer"), nil
}

// gstreamerCamera captures stills by running a one-shot gst-launch-1.0 pipeline
// per frame and reading the encoded JPEG off its stdout. Capture is stateless —
// every frame spawns and tears down its own pipeline, which fits occasional
// snapshots.
type gstreamerCamera struct {
	log           zerolog.Logger
	sourceElement string
}

func newGStreamerCamera(sourceElement, source string) *gstreamerCamera {
	return &gstreamerCamera{
		sourceElement: sourceElement,
		log: logging.Logger.With().
			Str("driver", "camera-gstreamer").
			Str("source", source).
			Str("sourceElement", sourceElement).
			Logger(),
	}
}

func (c *gstreamerCamera) Capture(ctx context.Context, width, height int) ([]byte, error) {
	// -q keeps gst-launch's progress chatter off stdout so only the fdsink JPEG
	// bytes land there.
	args := append([]string{"-q"}, c.pipeline(width, height)...)
	cmd := exec.CommandContext(ctx, "gst-launch-1.0", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	c.log.Info().Int("width", width).Int("height", height).Msg("capturing frame")
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("gst-launch-1.0: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	if stdout.Len() == 0 {
		return nil, fmt.Errorf("gstreamer capture produced no data")
	}
	return stdout.Bytes(), nil
}

// pipeline assembles the gst-launch arguments: the source element limited to one
// buffer, an optional resolution cap, then JPEG encoding onto stdout. The exact
// source element and caps are device-specific and tuned via the manifest.
func (c *gstreamerCamera) pipeline(width, height int) []string {
	args := strings.Fields(c.sourceElement)
	args = append(args, "num-buffers=1", "!", "videoconvert")
	if width > 0 && height > 0 {
		args = append(args, "!", fmt.Sprintf("video/x-raw,width=%d,height=%d", width, height))
	}
	args = append(args, "!", "jpegenc", "!", "fdsink", "fd=1")
	return args
}

func (c *gstreamerCamera) Close() error { return nil }
