// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package camera

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
)

// wantLocation is the multifilesink location the pipeline builds for dir. It uses
// filepath.Join like the production code, so the expectation matches on any OS —
// the camera binary only runs on Linux, but its unit tests must pass on any dev host.
func wantLocation(dir string) string {
	return "location=" + filepath.Join(dir, "f%05d.jpg")
}

func TestPipeline_V4L2(t *testing.T) {
	s := newGStreamerSource(Camera{Kind: KindV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, s.pipeline("/tmp/cap", 0, 0))
}

func TestPipeline_V4L2WithResolution(t *testing.T) {
	// The size is pinned at the source, not scaled at the tail: statically
	// configured capture nodes stream only in their pinned format.
	s := newGStreamerSource(Camera{Kind: KindV4L2, Device: "/dev/video0"})
	assert.Equal(t, []string{
		"v4l2src", "device=/dev/video0", "!", "video/x-raw,width=640,height=480",
		"!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, s.pipeline("/tmp/cap", 640, 480))
}

func TestPipeline_Libcamera(t *testing.T) {
	s := newGStreamerSource(Camera{Kind: KindLibcamera})
	args := s.pipeline("/tmp/cap", 0, 0)
	assert.Equal(t, []string{
		"libcamerasrc", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, args)
	// libcamerasrc has no num-buffers property; frame limiting must not rely on it.
	assert.NotContains(t, args, "num-buffers=1")
}

func TestPipeline_LibcameraNamedSensor(t *testing.T) {
	s := newGStreamerSource(Camera{Kind: KindLibcamera, CameraName: "/base/soc/i2c0mux/imx477@1a"})
	assert.Subset(t, s.pipeline("/tmp/cap", 0, 0), []string{"libcamerasrc", "camera-name=/base/soc/i2c0mux/imx477@1a"})
}

func TestPipeline_LibcameraWithResolution(t *testing.T) {
	// Non-v4l2 sources keep the videoscale tail: the source negotiates its own
	// native size and the request is honored by scaling.
	s := newGStreamerSource(Camera{Kind: KindLibcamera})
	assert.Equal(t, []string{
		"libcamerasrc", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "videoscale", "!", "video/x-raw,width=640,height=480",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, s.pipeline("/tmp/cap", 640, 480))
}

func TestPipeline_RTSPDecodesGenerically(t *testing.T) {
	// decodebin negotiates depay+decode from the stream, so no codec is named.
	s := newGStreamerSource(Camera{Kind: KindRTSP, URL: "rtsp://cam.local/s1"})
	assert.Equal(t, []string{
		"rtspsrc", "location=rtsp://cam.local/s1", "!", "decodebin",
		"!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, s.pipeline("/tmp/cap", 0, 0))
}

func TestPipeline_RTSPCredentials(t *testing.T) {
	// The password reaches the pipeline from the secret document, never config.
	s := newGStreamerSource(Camera{Kind: KindRTSP, URL: "rtsp://cam.local/s1", User: "admin", Password: "hunter2"})
	assert.Subset(t, s.pipeline("/tmp/cap", 0, 0), []string{"user-id=admin", "user-pw=hunter2"})
}

func TestPipeline_RTSPOmitsAbsentCredentials(t *testing.T) {
	// An anonymous stream must not get empty credential properties.
	s := newGStreamerSource(Camera{Kind: KindRTSP, URL: "rtsp://cam.local/s1"})
	args := s.pipeline("/tmp/cap", 0, 0)
	assert.NotContains(t, args, "user-id=")
	assert.NotContains(t, args, "user-pw=")
}

func TestPipeline_HTTP(t *testing.T) {
	s := newGStreamerSource(Camera{Kind: KindHTTP, URL: "http://cam.local/video.mjpg"})
	assert.Subset(t, s.pipeline("/tmp/cap", 0, 0), []string{"souphttpsrc", "location=http://cam.local/video.mjpg", "decodebin"})
}

func TestPipeline_RawUsedVerbatim(t *testing.T) {
	// The escape hatch is split on whitespace and dropped in as-is.
	s := newGStreamerSource(Camera{Kind: KindRaw, Pipeline: "myweirdsrc foo=1 ! mydepay"})
	assert.Equal(t, []string{
		"myweirdsrc", "foo=1", "!", "mydepay", "!", "identity", "eos-after=2", "!", "videoconvert",
		"!", "jpegenc", "!", "multifilesink", wantLocation("/tmp/cap"),
	}, s.pipeline("/tmp/cap", 0, 0))
}

func TestPipeline_WarmupFrames(t *testing.T) {
	// eos-after counts the warmup frames, the kept frame, and the dropped
	// EOS-trigger buffer.
	s := newGStreamerSource(Camera{Kind: KindLibcamera, WarmupFrames: 8})
	assert.Contains(t, s.pipeline("/tmp/cap", 0, 0), "eos-after=10")
}
