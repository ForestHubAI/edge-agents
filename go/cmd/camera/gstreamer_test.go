// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPipeline_V4L2(t *testing.T) {
	s := newGStreamerSource(cameraConfig{Source: sourceV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", "location=/tmp/cap/f%05d.jpg",
	}, s.pipeline("/tmp/cap", 0, 0))
}

func TestPipeline_V4L2WithResolution(t *testing.T) {
	// The size is pinned at the source, not scaled at the tail: statically
	// configured capture nodes stream only in their pinned format.
	s := newGStreamerSource(cameraConfig{Source: sourceV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "!", "video/x-raw,width=640,height=480",
		"!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", "location=/tmp/cap/f%05d.jpg",
	}, s.pipeline("/tmp/cap", 640, 480))
}

func TestPipeline_GStreamerFragmentWithResolution(t *testing.T) {
	// Non-v4l2 sources keep the videoscale tail: the source negotiates its own
	// native size and the request is honored by scaling.
	s := newGStreamerSource(cameraConfig{Source: sourceGStreamer, Device: "libcamerasrc"})
	assert.Equal(t, []string{
		"libcamerasrc", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "videoscale", "!", "video/x-raw,width=640,height=480",
		"!", "jpegenc", "!", "multifilesink", "location=/tmp/cap/f%05d.jpg",
	}, s.pipeline("/tmp/cap", 640, 480))
}

func TestPipeline_GStreamerFragment(t *testing.T) {
	s := newGStreamerSource(cameraConfig{Source: sourceGStreamer, Device: "libcamerasrc"})
	args := s.pipeline("/tmp/cap", 0, 0)
	assert.Equal(t, []string{
		"libcamerasrc", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", "location=/tmp/cap/f%05d.jpg",
	}, args)
	// libcamerasrc has no num-buffers property; frame limiting must not rely on it.
	assert.NotContains(t, args, "num-buffers=1")
}

func TestPipeline_WarmupFrames(t *testing.T) {
	// eos-after counts the warmup frames, the kept frame, and the dropped
	// EOS-trigger buffer.
	s := newGStreamerSource(cameraConfig{Source: sourceGStreamer, Device: "libcamerasrc", WarmupFrames: 8})
	assert.Contains(t, s.pipeline("/tmp/cap", 0, 0), "eos-after=10")
}
