// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestResourcesToDomain_CopiesFamiliesAndMergesSecrets(t *testing.T) {
	in := engineapi.Resources{
		MqttBrokers: &map[string]engineapi.MQTTBroker{
			"mqtt-1": {Type: engineapi.Mqtt, BrokerURL: "tcp://broker:1883", ClientID: pointer.Ptr("client-1")},
		},
		LlmProviders: &map[string]engineapi.LLMProvider{
			"llm-1": {Type: engineapi.SelfhostedLlm, Url: pointer.Ptr("http://llm:8000")},
			"llm-2": {Type: engineapi.DirectLlm, Provider: pointer.Ptr("Anthropic")},
		},
		MlProviders: &map[string]engineapi.MLProvider{
			"ml-1": {Type: engineapi.Ml, Url: "http://onnx:8000"},
		},
		Gpios: &map[string]engineapi.GPIOConfig{
			"chip0": {Type: engineapi.Gpio, Chip: "/dev/gpiochip0"},
		},
	}
	// Secrets arrive out-of-band, keyed by the same resource id, and are merged in.
	secrets := component.Secrets{
		"mqtt-1": "brokerpw",
		"llm-1":  "bearer",
		"llm-2":  "sk-ant",
	}
	out := ResourcesToDomain(&in, secrets)

	require.NotNil(t, out)
	require.Len(t, out.MQTTs, 1)
	assert.Equal(t, "tcp://broker:1883", out.MQTTs["mqtt-1"].BrokerURL)
	assert.Equal(t, "client-1", out.MQTTs["mqtt-1"].ClientID)
	assert.Equal(t, "brokerpw", out.MQTTs["mqtt-1"].Password)

	require.Len(t, out.Providers, 2)
	// Self-hosted: url + bearer, no provider adapter.
	assert.Equal(t, LLMSelfHosted, out.Providers["llm-1"].Kind)
	assert.Equal(t, "http://llm:8000", out.Providers["llm-1"].URL)
	assert.Equal(t, "bearer", out.Providers["llm-1"].APIKey)
	// Direct: adapter id + key, no url.
	assert.Equal(t, LLMDirect, out.Providers["llm-2"].Kind)
	assert.Equal(t, "Anthropic", out.Providers["llm-2"].Provider)
	assert.Equal(t, "sk-ant", out.Providers["llm-2"].APIKey)

	// Credential-free families copy straight through.
	require.Len(t, out.ML, 1)
	assert.Equal(t, "http://onnx:8000", out.ML["ml-1"].URL)
	require.Len(t, out.GPIOs, 1)
	assert.Equal(t, "/dev/gpiochip0", out.GPIOs["chip0"].Chip)
}

func TestResourcesToDomain_NoSecretLeavesCredentialEmpty(t *testing.T) {
	in := engineapi.Resources{
		MqttBrokers: &map[string]engineapi.MQTTBroker{
			"mqtt-1": {Type: engineapi.Mqtt, BrokerURL: "tcp://broker:1883"},
		},
	}
	out := ResourcesToDomain(&in, nil)
	require.NotNil(t, out)
	assert.Empty(t, out.MQTTs["mqtt-1"].Password)
}

func TestResourcesToDomain_Nil(t *testing.T) {
	assert.Nil(t, ResourcesToDomain(nil, nil))
}

func TestResourcesToDomain_CamerasCollapseToKind(t *testing.T) {
	// The engine keeps only the discriminator: it reaches every camera the same
	// way, and the capture details belong to the driver component.
	var v4l2 cameraapi.CameraSource
	require.NoError(t, v4l2.FromV4L2Source(cameraapi.V4L2Source{Kind: "v4l2", Device: "/dev/video0"}))
	var rtsp cameraapi.CameraSource
	require.NoError(t, rtsp.FromRtspSource(cameraapi.RtspSource{Kind: "rtsp", Url: "rtsp://cam/s1"}))

	in := engineapi.Resources{Cameras: &map[string]cameraapi.CameraSource{"cam0": v4l2, "gate": rtsp}}
	out := ResourcesToDomain(&in, nil)

	require.Len(t, out.Cameras, 2)
	assert.Equal(t, CameraSource{Kind: CameraV4L2}, out.Cameras["cam0"])
	assert.Equal(t, CameraSource{Kind: CameraRTSP}, out.Cameras["gate"])
}

func TestResourcesToDomain_NoCameras(t *testing.T) {
	// A device with no cameras is the common case, not an error.
	out := ResourcesToDomain(&engineapi.Resources{}, nil)
	assert.Empty(t, out.Cameras)
}
