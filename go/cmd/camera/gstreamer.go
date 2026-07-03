package main

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"syscall"
	"time"
)

// captureTimeout bounds a single capture so a stuck pipeline is killed.
const captureTimeout = 15 * time.Second

// gstreamerSource captures one still per request via a one-shot gst-launch-1.0
// pipeline, reading the JPEG off its stdout. Every frame spawns and tears down
// its own pipeline; a mutex serializes captures so concurrent requests to the
// same device don't race for a single-open V4L2 node.
type gstreamerSource struct {
	mu         sync.Mutex
	sourceArgs []string
}

// newGStreamerSource builds the pipeline source tokens: v4l2 wraps the /dev path
// as a v4l2src device arg (USB/UVC), kept as discrete tokens so a path with
// spaces is safe; gstreamer takes the device as a source fragment (e.g.
// libcamerasrc) split on whitespace — operator-trusted by design.
func newGStreamerSource(cc cameraConfig) *gstreamerSource {
	var args []string
	if cc.Source == sourceV4L2 {
		args = []string{"v4l2src", "device=" + cc.Device}
	} else {
		args = strings.Fields(cc.Device)
	}
	return &gstreamerSource{sourceArgs: args}
}

func (s *gstreamerSource) capture(ctx context.Context, width, height int) ([]byte, error) {
	// Serialize captures on this device: a V4L2 node is typically single-open,
	// so concurrent requests would otherwise fail with EBUSY.
	s.mu.Lock()
	defer s.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, captureTimeout)
	defer cancel()

	// -q keeps gst-launch's progress chatter off stdout so only the JPEG lands there.
	args := append([]string{"-q"}, s.pipeline(width, height)...)
	cmd := exec.CommandContext(ctx, "gst-launch-1.0", args...)
	// Run gst in its own process group and kill the whole group on cancel, so a
	// lingering plugin child can't keep the output pipe open — WaitDelay then
	// bounds Wait so one stuck capture can't hold the device mutex forever.
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
	cmd.WaitDelay = 5 * time.Second
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
	args := append([]string{}, s.sourceArgs...)
	args = append(args, "num-buffers=1", "!", "videoconvert")
	if width > 0 && height > 0 {
		// videoscale so the request is honored regardless of the camera's
		// native resolution, rather than failing caps negotiation.
		args = append(args, "!", "videoscale", "!", fmt.Sprintf("video/x-raw,width=%d,height=%d", width, height))
	}
	args = append(args, "!", "jpegenc", "!", "fdsink", "fd=1")
	return args
}
