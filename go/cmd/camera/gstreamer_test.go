package main

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPipeline_V4L2(t *testing.T) {
	s := newGStreamerSource(cameraConfig{Source: sourceV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "num-buffers=1", "!", "videoconvert",
		"!", "jpegenc", "!", "fdsink", "fd=1",
	}, s.pipeline(0, 0))
}

func TestPipeline_V4L2WithResolution(t *testing.T) {
	s := newGStreamerSource(cameraConfig{Source: sourceV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "num-buffers=1", "!", "videoconvert",
		"!", "videoscale", "!", "video/x-raw,width=640,height=480", "!", "jpegenc", "!", "fdsink", "fd=1",
	}, s.pipeline(640, 480))
}

func TestPipeline_GStreamerFragment(t *testing.T) {
	s := newGStreamerSource(cameraConfig{Source: sourceGStreamer, Device: "libcamerasrc"})
	assert.Equal(t, []string{
		"libcamerasrc", "num-buffers=1", "!", "videoconvert",
		"!", "jpegenc", "!", "fdsink", "fd=1",
	}, s.pipeline(0, 0))
}
