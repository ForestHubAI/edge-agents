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
	require.NoError(t, mqtt.FromMQTTConnection(engineapi.MQTTConnection{
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
		Type:  engineapi.MlInference,
		Url:   "http://onnx:8000",
		Model: "yolov8n",
	}))
	var cam engineapi.ExternalResourceConfig
	require.NoError(t, cam.FromCameraConfig(engineapi.CameraConfig{
		Type: engineapi.Camera,
		Url:  "http://fh-camera:8100",
	}))
	var store engineapi.ExternalResourceConfig
	require.NoError(t, store.FromVectorStoreConfig(engineapi.VectorStoreConfig{
		Type:  engineapi.VectorStore,
		Url:   "http://llama-embed:8080",
		Store: "manuals",
	}))

	in := engineapi.ExternalResources{
		"mqtt-1": mqtt, "llm-1": selfHosted, "llm-2": local,
		"ml-1": ml, "cam-1": cam, "vdb-1": store,
	}
	// Secrets arrive out-of-band, keyed by the same resource id, and are merged in.
	secrets := engine.Secrets{
		"mqtt-1": "brokerpw",
		"llm-1":  "bearer",
		"llm-2":  "sk-ant",
		"vdb-1":  "embed-bearer",
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

	// Credential-free sidecar arms route by discriminator too.
	require.Len(t, out.MLInference, 1)
	assert.Equal(t, "http://onnx:8000", out.MLInference["ml-1"].URL)
	assert.Equal(t, "yolov8n", out.MLInference["ml-1"].Model)
	require.Len(t, out.Cameras, 1)
	assert.Equal(t, "http://fh-camera:8100", out.Cameras["cam-1"].URL)

	// A vector store carries its artifact name and may carry a bearer.
	require.Len(t, out.VectorStores, 1)
	assert.Equal(t, "http://llama-embed:8080", out.VectorStores["vdb-1"].URL)
	assert.Equal(t, "manuals", out.VectorStores["vdb-1"].Store)
	assert.Equal(t, "embed-bearer", out.VectorStores["vdb-1"].APIKey)
}

func TestExternalResourcesToDomain_NoSecretLeavesCredentialEmpty(t *testing.T) {
	var mqtt engineapi.ExternalResourceConfig
	require.NoError(t, mqtt.FromMQTTConnection(engineapi.MQTTConnection{
		Type:      engineapi.Mqtt,
		BrokerURL: "tcp://broker:1883",
	}))
	var store engineapi.ExternalResourceConfig
	require.NoError(t, store.FromVectorStoreConfig(engineapi.VectorStoreConfig{
		Type:  engineapi.VectorStore,
		Url:   "http://llama-embed:8080",
		Store: "manuals",
	}))

	in := engineapi.ExternalResources{"mqtt-1": mqtt, "vdb-1": store}
	out := ExternalResourcesToDomain(&in, nil)
	require.NotNil(t, out)
	assert.Empty(t, out.MQTTs["mqtt-1"].Password)
	assert.Empty(t, out.VectorStores["vdb-1"].APIKey)
	assert.Equal(t, "manuals", out.VectorStores["vdb-1"].Store)
}

func TestExternalResourcesToDomain_Nil(t *testing.T) {
	assert.Nil(t, ExternalResourcesToDomain(nil, nil))
}
