// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

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

func loadCameras(t *testing.T, path string) (map[string]source, error) {
	t.Helper()
	file, err := readConfig(path)
	if err != nil {
		return nil, err
	}
	return buildSources(file)
}

func TestLoadCameras_HappyPath(t *testing.T) {
	path := writeConfig(t, `{"cameras":{"front":{"source":"v4l2","device":"/dev/video0"},"dbg":{"source":"debug"}}}`)
	sources, err := loadCameras(t, path)
	require.NoError(t, err)
	assert.Len(t, sources, 2)
	assert.Contains(t, sources, "front")
	assert.Contains(t, sources, "dbg")
}

func TestLoadCameras_Empty(t *testing.T) {
	path := writeConfig(t, `{"cameras":{}}`)
	_, err := loadCameras(t, path)
	assert.Error(t, err)
}

func TestLoadCameras_RejectsUnknownField(t *testing.T) {
	// A typo'd key must fail fast rather than be silently ignored.
	path := writeConfig(t, `{"cameras":{"front":{"source":"v4l2","devise":"/dev/video0"}}}`)
	_, err := loadCameras(t, path)
	assert.Error(t, err)
}

func TestLoadCameras_WarmupFrames(t *testing.T) {
	path := writeConfig(t, `{"cameras":{"front":{"source":"v4l2","device":"/dev/video0","warmupFrames":8}}}`)
	sources, err := loadCameras(t, path)
	require.NoError(t, err)
	assert.Contains(t, sources, "front")
}

func TestLoadCameras_Setup(t *testing.T) {
	path := writeConfig(t, `{"cameras":{"front":{"source":"v4l2","device":"/dev/video0","setup":["media-ctl -d /dev/media2 -r"]}}}`)
	sources, err := loadCameras(t, path)
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

func TestNewSource_DebugRejectsSetup(t *testing.T) {
	// debug has no hardware; setup commands there are a config mistake.
	_, err := newSource(cameraConfig{Source: sourceDebug, Setup: []string{"true"}})
	assert.Error(t, err)
}
