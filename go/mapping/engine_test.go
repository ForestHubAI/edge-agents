// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package mapping

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExternalResourcesToDomain_RoutesArmsAndMergesSecrets(t *testing.T) {
	var mqtt engineapi.ExternalResourceConfig
	require.NoError(t, mqtt.FromMQTTConfig(engineapi.MQTTConfig{
		Type:      engineapi.Mqtt,
		BrokerURL: "tcp://broker:1883",
		ClientID:  pointer.Ptr("client-1"),
	}))
	var selfHosted engineapi.ExternalResourceConfig
	require.NoError(t, selfHosted.FromLLMProviderConfig(engineapi.LLMProviderConfig{
		Type: engineapi.SelfhostedLlm,
		Url:  pointer.Ptr("http://llm:8000"),
	}))
	var local engineapi.ExternalResourceConfig
	require.NoError(t, local.FromLLMProviderConfig(engineapi.LLMProviderConfig{
		Type:     engineapi.LocalLlm,
		Provider: pointer.Ptr("Anthropic"),
	}))
	var ml engineapi.ExternalResourceConfig
	require.NoError(t, ml.FromMLInferenceConfig(engineapi.MLInferenceConfig{
		Type: engineapi.MlInference,
		Url:  "http://onnx:8000",
	}))
	var cam engineapi.ExternalResourceConfig
	require.NoError(t, cam.FromCameraConfig(engineapi.CameraConfig{
		Type: engineapi.Camera,
		Url:  "http://camera:8100",
	}))

	in := engineapi.ExternalResources{"mqtt-1": mqtt, "llm-1": selfHosted, "llm-2": local, "ml-1": ml, "cam-1": cam}
	// Secrets arrive out-of-band, keyed by the same resource id, and are merged in.
	secrets := engine.Secrets{
		"mqtt-1": "brokerpw",
		"llm-1":  "bearer",
		"llm-2":  "sk-ant",
	}
	out := ExternalResourcesToDomain(&in, secrets)

	require.NotNil(t, out)
	require.Len(t, out.MQTTs, 1)
	assert.Equal(t, "tcp://broker:1883", out.MQTTs["mqtt-1"].BrokerURL)
	assert.Equal(t, "client-1", out.MQTTs["mqtt-1"].ClientID)
	assert.Equal(t, "brokerpw", out.MQTTs["mqtt-1"].Password)

	require.Len(t, out.Providers, 2)
	// Self-hosted: url + bearer, no provider adapter.
	assert.Equal(t, engine.LLMSelfHosted, out.Providers["llm-1"].Kind)
	assert.Equal(t, "http://llm:8000", out.Providers["llm-1"].URL)
	assert.Equal(t, "bearer", out.Providers["llm-1"].APIKey)
	// Local: adapter id + key, no url.
	assert.Equal(t, engine.LLMLocal, out.Providers["llm-2"].Kind)
	assert.Equal(t, "Anthropic", out.Providers["llm-2"].Provider)
	assert.Equal(t, "sk-ant", out.Providers["llm-2"].APIKey)

	// Credential-free component arms route by discriminator too.
	require.Len(t, out.MLInference, 1)
	assert.Equal(t, "http://onnx:8000", out.MLInference["ml-1"].URL)
	require.Len(t, out.Cameras, 1)
	assert.Equal(t, "http://camera:8100", out.Cameras["cam-1"].URL)
}

func TestExternalResourcesToDomain_NoSecretLeavesCredentialEmpty(t *testing.T) {
	var mqtt engineapi.ExternalResourceConfig
	require.NoError(t, mqtt.FromMQTTConfig(engineapi.MQTTConfig{
		Type:      engineapi.Mqtt,
		BrokerURL: "tcp://broker:1883",
	}))
	in := engineapi.ExternalResources{"mqtt-1": mqtt}
	out := ExternalResourcesToDomain(&in, nil)
	require.NotNil(t, out)
	assert.Empty(t, out.MQTTs["mqtt-1"].Password)
}

func TestExternalResourcesToDomain_Nil(t *testing.T) {
	assert.Nil(t, ExternalResourcesToDomain(nil, nil))
}
