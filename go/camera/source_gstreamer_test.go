// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package camera

import (
	"path/filepath"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/stretchr/testify/assert"
)

// wantLocation is the multifilesink location the pipeline builds for dir. It uses
// filepath.Join like the production code, so the expectation matches on any OS —
// the camera binary only runs on Linux, but its unit tests must pass on any dev host.
func wantLocation(dir string) string {
	return "location=" + filepath.Join(dir, "f%05d.jpg")
}

func TestPipeline_V4L2(t *testing.T) {
	s := newGStreamerSource(cameraapi.CameraSource{Source: sourceV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, s.pipeline("/tmp/cap", 0, 0))
}

func TestPipeline_V4L2WithResolution(t *testing.T) {
	// The size is pinned at the source, not scaled at the tail: statically
	// configured capture nodes stream only in their pinned format.
	s := newGStreamerSource(cameraapi.CameraSource{Source: sourceV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "!", "video/x-raw,width=640,height=480",
		"!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, s.pipeline("/tmp/cap", 640, 480))
}

func TestPipeline_GStreamerFragmentWithResolution(t *testing.T) {
	// Non-v4l2 sources keep the videoscale tail: the source negotiates its own
	// native size and the request is honored by scaling.
	s := newGStreamerSource(cameraapi.CameraSource{Source: sourceGStreamer, Device: "libcamerasrc"})
	assert.Equal(t, []string{
		"libcamerasrc", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "videoscale", "!", "video/x-raw,width=640,height=480",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, s.pipeline("/tmp/cap", 640, 480))
}

func TestPipeline_GStreamerFragment(t *testing.T) {
	s := newGStreamerSource(cameraapi.CameraSource{Source: sourceGStreamer, Device: "libcamerasrc"})
	args := s.pipeline("/tmp/cap", 0, 0)
	assert.Equal(t, []string{
		"libcamerasrc", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, args)
	// libcamerasrc has no num-buffers property; frame limiting must not rely on it.
	assert.NotContains(t, args, "num-buffers=1")
}

func TestPipeline_WarmupFrames(t *testing.T) {
	// eos-after counts the warmup frames, the kept frame, and the dropped
	// EOS-trigger buffer.
	s := newGStreamerSource(cameraapi.CameraSource{Source: sourceGStreamer, Device: "libcamerasrc", WarmupFrames: 8})
	assert.Contains(t, s.pipeline("/tmp/cap", 0, 0), "eos-after=10")
}
