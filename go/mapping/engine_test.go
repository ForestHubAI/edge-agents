package mapping

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestExternalResourcesToDomain_RoutesArmsByDiscriminator(t *testing.T) {
	var mqtt engineapi.ExternalResourceConfig
	require.NoError(t, mqtt.FromMQTTConnection(engineapi.MQTTConnection{
		Type:      engineapi.Mqtt,
		BrokerURL: "tcp://broker:1883",
		ClientID:  pointer.Ptr("client-1"),
	}))
	var provider engineapi.ExternalResourceConfig
	require.NoError(t, provider.FromLLMProviderConfig(engineapi.LLMProviderConfig{
		Type:   engineapi.Selfhosted,
		Url:    "http://llm:8000",
		ApiKey: pointer.Ptr("secret"),
	}))

	in := engineapi.ExternalResources{"mqtt-1": mqtt, "llm-1": provider}
	out := ExternalResourcesToDomain(&in)

	require.NotNil(t, out)
	require.Len(t, out.MQTTs, 1)
	assert.Equal(t, "tcp://broker:1883", out.MQTTs["mqtt-1"].BrokerURL)
	assert.Equal(t, "client-1", out.MQTTs["mqtt-1"].ClientID)

	require.Len(t, out.Providers, 1)
	assert.Equal(t, "http://llm:8000", out.Providers["llm-1"].URL)
	assert.Equal(t, "secret", out.Providers["llm-1"].APIKey)
}

func TestExternalResourcesToDomain_Nil(t *testing.T) {
	assert.Nil(t, ExternalResourcesToDomain(nil))
}
