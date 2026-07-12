// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package camera

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CaptureTimeout bounds a single capture so a stuck pipeline is killed. It is
// exported so cmd/camera can size the graceful-shutdown window around an
// in-flight capture.
const CaptureTimeout = 15 * time.Second

// gstreamerSource captures one still per request via a one-shot gst-launch-1.0
// pipeline. Every frame spawns and tears down its own pipeline; a mutex
// serializes captures so concurrent requests to the same device don't race for a
// single-open V4L2 node.
type gstreamerSource struct {
	mu         sync.Mutex
	sourceArgs []string
	frames     int
	v4l2       bool
}

// newGStreamerSource builds the pipeline source tokens: v4l2 wraps the /dev path
// as a v4l2src device arg (USB/UVC), kept as discrete tokens so a path with
// spaces is safe; gstreamer takes the device as a source fragment (e.g.
// libcamerasrc) split on whitespace — operator-trusted by design. frames is the
// total run through the pipeline; only the last is kept, so the warmup frames
// ahead of it give auto-exposure time to settle.
func newGStreamerSource(cc cameraConfig) *gstreamerSource {
	var args []string
	if cc.Source == sourceV4L2 {
		args = []string{"v4l2src", "device=" + cc.Device}
	} else {
		args = strings.Fields(cc.Device)
	}
	return &gstreamerSource{sourceArgs: args, frames: cc.WarmupFrames + 1, v4l2: cc.Source == sourceV4L2}
}

func (s *gstreamerSource) capture(ctx context.Context, width, height int) ([]byte, error) {
	// Serialize captures on this device: a V4L2 node is typically single-open,
	// so concurrent requests would otherwise fail with EBUSY.
	s.mu.Lock()
	defer s.mu.Unlock()

	ctx, cancel := context.WithTimeout(ctx, CaptureTimeout)
	defer cancel()

	// Frames land as one file each in a private temp dir so the last (warmed-up)
	// one can be picked unambiguously — a concatenated JPEG byte stream has no
	// reliable boundary to split on. The dir is removed whatever the outcome.
	dir, err := os.MkdirTemp("", "fh-camera-")
	if err != nil {
		return nil, fmt.Errorf("creating capture dir: %w", err)
	}
	defer os.RemoveAll(dir)

	args := append([]string{"-q"}, s.pipeline(dir, width, height)...)
	cmd := exec.CommandContext(ctx, "gst-launch-1.0", args...)
	// Run gst in its own process group and kill the whole group on cancel, so a
	// lingering plugin child can't keep running — WaitDelay then bounds Wait so
	// one stuck capture can't hold the device mutex forever. The process-group
	// setup is Linux-only.
	killChildProcessGroup(cmd)
	cmd.WaitDelay = 5 * time.Second
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("gst-launch-1.0: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}

	return readLastFrame(dir)
}

// pipeline assembles the gst-launch arguments: the source, a frame limiter, an
// optional resolution cap, JPEG encoding, then one file per frame into dir.
// num-buffers is not used — it is a GstBaseSrc property that live sources such as
// libcamerasrc do not expose, so the frame count is bounded source-agnostically
// with identity eos-after.
func (s *gstreamerSource) pipeline(dir string, width, height int) []string {
	args := append([]string{}, s.sourceArgs...)
	if s.v4l2 && width > 0 && height > 0 {
		// Pin the size directly at the source: a statically configured capture
		// node (CSI/ISP media graph, frame grabber) streams only in its pinned
		// format, and left to itself v4l2src fixates on something else.
		args = append(args, "!", fmt.Sprintf("video/x-raw,width=%d,height=%d", width, height))
	}
	// identity drops the buffer that triggers the EOS, so N frames need eos-after=N+1.
	args = append(args, "!", "identity", fmt.Sprintf("eos-after=%d", s.frames+1), "!", "videoconvert")
	if !s.v4l2 && width > 0 && height > 0 {
		// videoscale so the request is honored regardless of the camera's
		// native resolution, rather than failing caps negotiation.
		args = append(args, "!", "videoscale", "!", fmt.Sprintf("video/x-raw,width=%d,height=%d", width, height))
	}
	args = append(args, "!", "jpegenc", "!", "multifilesink", "location="+filepath.Join(dir, "f%05d.jpg"))
	return args
}

// readLastFrame returns the highest-indexed JPEG multifilesink wrote into dir.
// Filenames are zero-padded, so lexical order matches capture order and the last
// entry is the kept frame.
func readLastFrame(dir string) ([]byte, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("reading capture dir: %w", err)
	}
	var last string
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		if name := e.Name(); name > last {
			last = name
		}
	}
	if last == "" {
		return nil, fmt.Errorf("capture produced no data")
	}
	data, err := os.ReadFile(filepath.Join(dir, last))
	if err != nil {
		return nil, fmt.Errorf("reading captured frame: %w", err)
	}
	return data, nil
}
