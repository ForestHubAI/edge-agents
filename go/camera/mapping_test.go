// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package camera

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// wireConfig builds the boot config from already-tagged source arms.
func wireConfig(t *testing.T, cameras map[string]cameraapi.CameraSource) cameraapi.CameraConfig {
	t.Helper()
	return cameraapi.CameraConfig{Cameras: cameras}
}

func v4l2Arm(t *testing.T, v cameraapi.V4L2Source) cameraapi.CameraSource {
	t.Helper()
	var s cameraapi.CameraSource
	require.NoError(t, s.FromV4L2Source(v))
	return s
}

func rtspArm(t *testing.T, v cameraapi.RtspSource) cameraapi.CameraSource {
	t.Helper()
	var s cameraapi.CameraSource
	require.NoError(t, s.FromRtspSource(v))
	return s
}

func TestToDomain_RoutesEachKind(t *testing.T) {
	var lib cameraapi.CameraSource
	require.NoError(t, lib.FromLibcameraSource(cameraapi.LibcameraSource{Kind: "libcamera", CameraName: "imx477"}))
	var raw cameraapi.CameraSource
	require.NoError(t, raw.FromRawSource(cameraapi.RawSource{Kind: "raw", Pipeline: "weirdsrc"}))
	var dbg cameraapi.CameraSource
	require.NoError(t, dbg.FromDebugSource(cameraapi.DebugSource{Kind: "debug"}))

	cfg, err := ToDomain(wireConfig(t, map[string]cameraapi.CameraSource{
		"usb": v4l2Arm(t, cameraapi.V4L2Source{Kind: "v4l2", Device: "/dev/video0", WarmupFrames: 3}),
		"pi":  lib,
		"odd": raw,
		"dbg": dbg,
	}), nil)
	require.NoError(t, err)

	assert.Equal(t, Camera{Kind: KindV4L2, Device: "/dev/video0", WarmupFrames: 3}, cfg.Cameras["usb"])
	assert.Equal(t, Camera{Kind: KindLibcamera, CameraName: "imx477"}, cfg.Cameras["pi"])
	assert.Equal(t, Camera{Kind: KindRaw, Pipeline: "weirdsrc"}, cfg.Cameras["odd"])
	assert.Equal(t, Camera{Kind: KindDebug}, cfg.Cameras["dbg"])
}

func TestToDomain_MergesSecretByCameraKey(t *testing.T) {
	// The credential is keyed by the camera's own manifest key — there is no
	// secretRef to resolve — and never appears in the config blob.
	cfg, err := ToDomain(wireConfig(t, map[string]cameraapi.CameraSource{
		"gate": rtspArm(t, cameraapi.RtspSource{Kind: "rtsp", Url: "rtsp://cam/s1", User: "admin"}),
	}), component.Secrets{"gate": "hunter2"})
	require.NoError(t, err)
	assert.Equal(t, Camera{Kind: KindRTSP, URL: "rtsp://cam/s1", User: "admin", Password: "hunter2"}, cfg.Cameras["gate"])
}

func TestToDomain_MissingSecretIsNotAnError(t *testing.T) {
	// An anonymous stream is valid, so an absent secret leaves the password empty
	// rather than failing the boot.
	cfg, err := ToDomain(wireConfig(t, map[string]cameraapi.CameraSource{
		"gate": rtspArm(t, cameraapi.RtspSource{Kind: "rtsp", Url: "rtsp://cam/s1"}),
	}), nil)
	require.NoError(t, err)
	assert.Empty(t, cfg.Cameras["gate"].Password)
}

func TestToDomain_SecretForOtherCameraIsNotApplied(t *testing.T) {
	cfg, err := ToDomain(wireConfig(t, map[string]cameraapi.CameraSource{
		"gate": rtspArm(t, cameraapi.RtspSource{Kind: "rtsp", Url: "rtsp://cam/s1"}),
	}), component.Secrets{"other": "hunter2"})
	require.NoError(t, err)
	assert.Empty(t, cfg.Cameras["gate"].Password)
}

func TestToDomain_UnknownKindFails(t *testing.T) {
	var bogus cameraapi.CameraSource
	require.NoError(t, bogus.UnmarshalJSON([]byte(`{"kind":"telepathy"}`)))
	_, err := ToDomain(wireConfig(t, map[string]cameraapi.CameraSource{"x": bogus}), nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "x")
}
