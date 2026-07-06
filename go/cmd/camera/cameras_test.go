package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func writeConfig(t *testing.T, body string) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "cameras.json")
	require.NoError(t, os.WriteFile(path, []byte(body), 0o600))
	return path
}

func TestLoadCameras_HappyPath(t *testing.T) {
	path := writeConfig(t, `{"cameras":{"front":{"source":"v4l2","device":"/dev/video0"},"dbg":{"source":"debug"}}}`)
	sources, err := loadCameras(path)
	require.NoError(t, err)
	assert.Len(t, sources, 2)
	assert.Contains(t, sources, "front")
	assert.Contains(t, sources, "dbg")
}

func TestLoadCameras_Empty(t *testing.T) {
	path := writeConfig(t, `{"cameras":{}}`)
	_, err := loadCameras(path)
	assert.Error(t, err)
}

func TestLoadCameras_RejectsUnknownField(t *testing.T) {
	// A typo'd key must fail fast rather than be silently ignored.
	path := writeConfig(t, `{"cameras":{"front":{"source":"v4l2","devise":"/dev/video0"}}}`)
	_, err := loadCameras(path)
	assert.Error(t, err)
}

func TestLoadCameras_WarmupFrames(t *testing.T) {
	path := writeConfig(t, `{"cameras":{"front":{"source":"v4l2","device":"/dev/video0","warmupFrames":8}}}`)
	sources, err := loadCameras(path)
	require.NoError(t, err)
	assert.Contains(t, sources, "front")
}

func TestNewSource_UnknownSource(t *testing.T) {
	_, err := newSource(cameraConfig{Source: "bogus", Device: "/dev/video0"})
	assert.Error(t, err)
}

func TestNewSource_NegativeWarmupFrames(t *testing.T) {
	_, err := newSource(cameraConfig{Source: sourceV4L2, Device: "/dev/video0", WarmupFrames: -1})
	assert.Error(t, err)
}

func TestNewSource_MissingDevice(t *testing.T) {
	_, err := newSource(cameraConfig{Source: sourceV4L2})
	assert.Error(t, err)
}

func TestNewSource_WhitespaceDevice(t *testing.T) {
	// A whitespace-only device must fail at boot, not silently pass and then
	// break every capture.
	_, err := newSource(cameraConfig{Source: sourceGStreamer, Device: "   "})
	assert.Error(t, err)
}

func TestNewSource_DebugNeedsNoDevice(t *testing.T) {
	src, err := newSource(cameraConfig{Source: sourceDebug})
	require.NoError(t, err)
	assert.NotNil(t, src)
}
