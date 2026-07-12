// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package camera

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildSources_BuildsOnePerCamera(t *testing.T) {
	sources, err := BuildSources(cameraapi.CameraConfig{Cameras: map[string]cameraapi.CameraSource{
		"front": {Source: sourceV4L2, Device: "/dev/video0"},
		"dbg":   {Source: sourceDebug},
	}})
	require.NoError(t, err)
	assert.Len(t, sources, 2)
	assert.Contains(t, sources, "front")
	assert.Contains(t, sources, "dbg")
}

func TestBuildSources_InvalidCameraFails(t *testing.T) {
	// BuildSources names the offending camera when a source is invalid.
	_, err := BuildSources(cameraapi.CameraConfig{Cameras: map[string]cameraapi.CameraSource{
		"front": {Source: "bogus", Device: "/dev/video0"},
	}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "front")
}

func TestNewSource_UnknownSource(t *testing.T) {
	_, err := newSource(cameraapi.CameraSource{Source: "bogus", Device: "/dev/video0"})
	assert.Error(t, err)
}

func TestNewSource_NegativeWarmupFrames(t *testing.T) {
	_, err := newSource(cameraapi.CameraSource{Source: sourceV4L2, Device: "/dev/video0", WarmupFrames: -1})
	assert.Error(t, err)
}

func TestNewSource_MissingDevice(t *testing.T) {
	_, err := newSource(cameraapi.CameraSource{Source: sourceV4L2})
	assert.Error(t, err)
}

func TestNewSource_WhitespaceDevice(t *testing.T) {
	// A whitespace-only device must fail at boot, not silently pass and then
	// break every capture.
	_, err := newSource(cameraapi.CameraSource{Source: sourceGStreamer, Device: "   "})
	assert.Error(t, err)
}

func TestNewSource_DebugNeedsNoDevice(t *testing.T) {
	src, err := newSource(cameraapi.CameraSource{Source: sourceDebug})
	require.NoError(t, err)
	assert.NotNil(t, src)
}

func TestNewSource_DebugRejectsSetup(t *testing.T) {
	// debug has no hardware; setup commands there are a config mistake.
	_, err := newSource(cameraapi.CameraSource{Source: sourceDebug, Setup: []string{"true"}})
	assert.Error(t, err)
}
