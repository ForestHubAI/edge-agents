// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/driver"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func cameraChannel(t *testing.T, id string, width, height *int) workflowapi.Channel {
	t.Helper()
	var c workflowapi.Channel
	require.NoError(t, c.FromCAMERAChannel(workflowapi.CAMERAChannel{
		Type:   workflowapi.CAMERA,
		Id:     id,
		Label:  id,
		Width:  width,
		Height: height,
	}))
	return c
}

// cameraDrivers is a registry holding a driver per named manifest camera. Opening
// one makes no network call, so this needs no server.
func cameraDrivers(t *testing.T, names ...string) *driver.Registry {
	t.Helper()
	m := engine.DeviceManifest{Cameras: map[string]engine.CameraSource{}}
	for _, n := range names {
		m.Cameras[n] = engine.CameraSource{Kind: engine.CameraV4L2}
	}
	drvs, err := driver.NewRegistry(&m)
	require.NoError(t, err)
	return drvs
}

func TestBuildChannels_CameraResolvesThroughManifest(t *testing.T) {
	rm := engine.ResourceMapping{"front": {Ref: "cam0"}}
	chs, err := buildChannels(
		[]workflowapi.Channel{cameraChannel(t, "front", pointer.Ptr(640), pointer.Ptr(480))},
		rm, cameraDrivers(t, "cam0"), nil, nil,
	)
	require.NoError(t, err)

	c, err := chs.camera("front")
	require.NoError(t, err)
	assert.NotNil(t, c.Driver)
	// The size hints are the workflow's and stay on the channel, not the driver.
	assert.Equal(t, 640, c.Width)
	assert.Equal(t, 480, c.Height)
}

func TestBuildChannels_CameraWithoutSizeHints(t *testing.T) {
	rm := engine.ResourceMapping{"front": {Ref: "cam0"}}
	chs, err := buildChannels([]workflowapi.Channel{cameraChannel(t, "front", nil, nil)}, rm, cameraDrivers(t, "cam0"), nil, nil)
	require.NoError(t, err)

	c, err := chs.camera("front")
	require.NoError(t, err)
	assert.Zero(t, c.Width)
	assert.Zero(t, c.Height)
}

func TestBuildChannels_CameraUnboundFails(t *testing.T) {
	_, err := buildChannels([]workflowapi.Channel{cameraChannel(t, "front", nil, nil)}, nil, cameraDrivers(t, "cam0"), nil, nil)
	require.Error(t, err)
}

func TestBuildChannels_CameraRefNotInManifestFails(t *testing.T) {
	// Bound to a camera the device doesn't have: the same failure shape as a
	// miswired gpiochip, caught at boot rather than at first capture.
	rm := engine.ResourceMapping{"front": {Ref: "missing"}}
	_, err := buildChannels([]workflowapi.Channel{cameraChannel(t, "front", nil, nil)}, rm, cameraDrivers(t, "cam0"), nil, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not registered")
}

func TestBuildChannels_CamerasShareOneDevice(t *testing.T) {
	// One camera may back several channels, each asking for its own size.
	rm := engine.ResourceMapping{"wide": {Ref: "cam0"}, "thumb": {Ref: "cam0"}}
	chs, err := buildChannels([]workflowapi.Channel{
		cameraChannel(t, "wide", pointer.Ptr(1920), pointer.Ptr(1080)),
		cameraChannel(t, "thumb", pointer.Ptr(320), pointer.Ptr(240)),
	}, rm, cameraDrivers(t, "cam0"), nil, nil)
	require.NoError(t, err)

	wide, err := chs.camera("wide")
	require.NoError(t, err)
	thumb, err := chs.camera("thumb")
	require.NoError(t, err)
	assert.Equal(t, 1920, wide.Width)
	assert.Equal(t, 320, thumb.Width)
	// Same underlying camera, shared rather than opened twice.
	assert.Same(t, wide.Driver, thumb.Driver)
}
