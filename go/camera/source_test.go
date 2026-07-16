// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package camera

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBuildSources_BuildsOnePerCamera(t *testing.T) {
	sources, err := BuildSources(Config{Cameras: map[string]Camera{
		"front": {Kind: KindV4L2, Device: "/dev/video0"},
		"dbg":   {Kind: KindDebug},
	}})
	require.NoError(t, err)
	assert.Len(t, sources, 2)
	assert.Contains(t, sources, "front")
	assert.Contains(t, sources, "dbg")
}

func TestBuildSources_InvalidCameraFails(t *testing.T) {
	// BuildSources names the offending camera when a source is invalid.
	_, err := BuildSources(Config{Cameras: map[string]Camera{
		"front": {Kind: "bogus", Device: "/dev/video0"},
	}})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "front")
}

func TestNewSource_UnknownKind(t *testing.T) {
	_, err := newSource(Camera{Kind: "bogus", Device: "/dev/video0"})
	assert.Error(t, err)
}

func TestNewSource_NegativeWarmupFrames(t *testing.T) {
	_, err := newSource(Camera{Kind: KindV4L2, Device: "/dev/video0", WarmupFrames: -1})
	assert.Error(t, err)
}

func TestNewSource_V4L2MissingDevice(t *testing.T) {
	_, err := newSource(Camera{Kind: KindV4L2})
	assert.Error(t, err)
}

func TestNewSource_WhitespaceDeviceRejected(t *testing.T) {
	// A whitespace-only device must fail at boot, not silently pass and then
	// break every capture.
	_, err := newSource(Camera{Kind: KindV4L2, Device: "   "})
	assert.Error(t, err)
}

func TestNewSource_NetworkKindsNeedURL(t *testing.T) {
	for _, k := range []Kind{KindRTSP, KindHTTP} {
		_, err := newSource(Camera{Kind: k})
		assert.Error(t, err, "kind %q with no url", k)
	}
}

func TestNewSource_RawNeedsPipeline(t *testing.T) {
	_, err := newSource(Camera{Kind: KindRaw})
	assert.Error(t, err)
}

func TestNewSource_LibcameraNeedsNothing(t *testing.T) {
	// cameraName is optional — omitted selects the platform's default sensor.
	src, err := newSource(Camera{Kind: KindLibcamera})
	require.NoError(t, err)
	assert.NotNil(t, src)
}

func TestNewSource_DebugNeedsNoDevice(t *testing.T) {
	src, err := newSource(Camera{Kind: KindDebug})
	require.NoError(t, err)
	assert.NotNil(t, src)
}
