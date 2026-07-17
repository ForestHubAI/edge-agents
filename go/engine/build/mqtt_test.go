// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func mqttChannel(t *testing.T, id, topic string) workflowapi.Channel {
	t.Helper()
	var c workflowapi.Channel
	require.NoError(t, c.FromMQTTChannel(workflowapi.MQTTChannel{
		Type:  workflowapi.MQTT,
		Id:    id,
		Label: id,
		Topic: topic,
	}))
	return c
}

func TestBuildChannels_DuplicateRefTopicFails(t *testing.T) {
	// Two channels on one broker and topic are one requirement declared twice:
	// they would race for the transport's single callback per filter, and the
	// loser's triggers would go quiet with no error. The resolver owns this
	// check; the engine refuses the mapping regardless.
	rm := engine.ResourceMapping{
		"a": {Ref: "site-broker"},
		"b": {Ref: "site-broker"},
	}
	_, err := buildChannels([]workflowapi.Channel{
		mqttChannel(t, "a", "alarm"),
		mqttChannel(t, "b", "alarm"),
	}, rm, nil, nil, nil)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "both bind topic")
}

func TestBuildChannels_SameTopicOnDifferentRefsIsAllowed(t *testing.T) {
	// Uniqueness is over (ref, topic), not topic: the same topic name on two
	// brokers is two distinct endpoints. Fails past the uniqueness check on the
	// missing external config, which is the next gate.
	rm := engine.ResourceMapping{
		"a": {Ref: "broker-1"},
		"b": {Ref: "broker-2"},
	}
	_, err := buildChannels([]workflowapi.Channel{
		mqttChannel(t, "a", "alarm"),
		mqttChannel(t, "b", "alarm"),
	}, rm, nil, nil, nil)

	require.Error(t, err)
	assert.NotContains(t, err.Error(), "both bind topic")
}

func TestBuildChannels_DifferentTopicsOnOneRefIsAllowed(t *testing.T) {
	// The discriminator is what makes N:1 onto one broker safe.
	rm := engine.ResourceMapping{
		"a": {Ref: "site-broker"},
		"b": {Ref: "site-broker"},
	}
	_, err := buildChannels([]workflowapi.Channel{
		mqttChannel(t, "a", "alarm"),
		mqttChannel(t, "b", "telemetry"),
	}, rm, nil, nil, nil)

	require.Error(t, err)
	assert.NotContains(t, err.Error(), "both bind topic")
}
