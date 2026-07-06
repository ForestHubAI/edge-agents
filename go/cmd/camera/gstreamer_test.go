package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPipeline_V4L2(t *testing.T) {
	s := newGStreamerSource(cameraConfig{Source: sourceV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "!", "identity", "eos-after=1", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", "location=/tmp/cap/f%05d.jpg",
	}, s.pipeline("/tmp/cap", 0, 0))
}

func TestPipeline_V4L2WithResolution(t *testing.T) {
	s := newGStreamerSource(cameraConfig{Source: sourceV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "!", "identity", "eos-after=1", "!", "videoconvert",
		"!", "videoscale", "!", "video/x-raw,width=640,height=480",
		"!", "jpegenc", "!", "multifilesink", "location=/tmp/cap/f%05d.jpg",
	}, s.pipeline("/tmp/cap", 640, 480))
}

func TestPipeline_GStreamerFragment(t *testing.T) {
	s := newGStreamerSource(cameraConfig{Source: sourceGStreamer, Device: "libcamerasrc"})
	args := s.pipeline("/tmp/cap", 0, 0)
	assert.Equal(t, []string{
		"libcamerasrc", "!", "identity", "eos-after=1", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", "location=/tmp/cap/f%05d.jpg",
	}, args)
	// libcamerasrc has no num-buffers property; frame limiting must not rely on it.
	assert.NotContains(t, args, "num-buffers=1")
}

func TestPipeline_WarmupFrames(t *testing.T) {
	// eos-after counts the warmup frames plus the one kept frame.
	s := newGStreamerSource(cameraConfig{Source: sourceGStreamer, Device: "libcamerasrc", WarmupFrames: 8})
	assert.Contains(t, s.pipeline("/tmp/cap", 0, 0), "eos-after=9")
}
