// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/resource"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func cameraChannel(t *testing.T, id string) workflowapi.Channel {
	t.Helper()
	var c workflowapi.Channel
	require.NoError(t, c.FromCAMERAChannel(workflowapi.CAMERAChannel{
		Type:  workflowapi.CAMERA,
		Id:    id,
		Label: id,
	}))
	return c
}

// cameraDrivers is a registry holding a driver per named manifest camera. Opening
// one makes no network call, so this needs no server.
func cameraDrivers(t *testing.T, names ...string) *resource.Registry {
	t.Helper()
	res := engine.Resources{Cameras: map[string]engine.CameraSource{}}
	for _, n := range names {
		res.Cameras[n] = engine.CameraSource{Kind: engine.CameraV4L2}
	}
	drvs, err := resource.NewRegistry(&res)
	require.NoError(t, err)
	return drvs
}

func TestBuildChannels_CameraResolvesThroughManifest(t *testing.T) {
	rm := engine.ResourceMapping{"front": {Ref: "cam0"}}
	chs, err := buildChannels(
		[]workflowapi.Channel{cameraChannel(t, "front")},
		cameraDrivers(t, "cam0"), rm, nil,
	)
	require.NoError(t, err)

	c, err := chs.camera("front")
	require.NoError(t, err)
	// The channel is the binding and nothing else: no sub-address, no config.
	// Capture size is a CameraCapture argument.
	assert.NotNil(t, c.Driver)
}

func TestBuildChannels_CameraUnboundFails(t *testing.T) {
	_, err := buildChannels([]workflowapi.Channel{cameraChannel(t, "front")}, cameraDrivers(t, "cam0"), nil, nil)
	require.Error(t, err)
}

func TestBuildChannels_CameraRefNotInManifestFails(t *testing.T) {
	// Bound to a camera the device doesn't have: the same failure shape as a
	// miswired gpiochip, caught at boot rather than at first capture.
	rm := engine.ResourceMapping{"front": {Ref: "missing"}}
	_, err := buildChannels([]workflowapi.Channel{cameraChannel(t, "front")}, cameraDrivers(t, "cam0"), rm, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "not registered")
}

func TestBuildChannels_CamerasOnOneRefShareTheDriver(t *testing.T) {
	// A camera takes no discriminator, so two channels on one ref are the same
	// requirement declared twice — a Stage-0 conflict the engine does not re-check.
	// When it is handed one anyway, the driver is shared rather than opened twice.
	rm := engine.ResourceMapping{"a": {Ref: "cam0"}, "b": {Ref: "cam0"}}
	chs, err := buildChannels([]workflowapi.Channel{
		cameraChannel(t, "a"),
		cameraChannel(t, "b"),
	}, cameraDrivers(t, "cam0"), rm, nil)
	require.NoError(t, err)

	a, err := chs.camera("a")
	require.NoError(t, err)
	b, err := chs.camera("b")
	require.NoError(t, err)
	assert.Same(t, a.Driver, b.Driver)
}
