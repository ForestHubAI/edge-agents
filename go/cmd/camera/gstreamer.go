package main

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

// captureTimeout bounds a single capture so a stuck pipeline is killed.
const captureTimeout = 15 * time.Second

// gstreamerSource captures one still per request via a one-shot gst-launch-1.0
// pipeline, reading the JPEG off its stdout. Stateless — every frame spawns and
// tears down its own pipeline.
type gstreamerSource struct {
	sourceElement string
}

// newGStreamerSource builds the pipeline source element: v4l2 wraps the /dev path
// as v4l2src (USB/UVC); gstreamer takes the device verbatim (e.g. libcamerasrc).
func newGStreamerSource(cc cameraConfig) *gstreamerSource {
	element := cc.Device
	if cc.Source == sourceV4L2 {
		element = fmt.Sprintf("v4l2src device=%s", cc.Device)
	}
	return &gstreamerSource{sourceElement: element}
}

func (s *gstreamerSource) capture(ctx context.Context, width, height int) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, captureTimeout)
	defer cancel()

	// -q keeps gst-launch's progress chatter off stdout so only the JPEG lands there.
	args := append([]string{"-q"}, s.pipeline(width, height)...)
	cmd := exec.CommandContext(ctx, "gst-launch-1.0", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("gst-launch-1.0: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	if stdout.Len() == 0 {
		return nil, fmt.Errorf("capture produced no data")
	}
	return stdout.Bytes(), nil
}

// pipeline assembles the gst-launch arguments: source limited to one buffer, an
// optional resolution cap, then JPEG encoding onto stdout.
func (s *gstreamerSource) pipeline(width, height int) []string {
	args := strings.Fields(s.sourceElement)
	args = append(args, "num-buffers=1", "!", "videoconvert")
	if width > 0 && height > 0 {
		args = append(args, "!", fmt.Sprintf("video/x-raw,width=%d,height=%d", width, height))
	}
	args = append(args, "!", "jpegenc", "!", "fdsink", "fd=1")
	return args
}
