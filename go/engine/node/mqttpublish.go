// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*MqttPublish)(nil)

// MqttPublish evaluates a value expression, encodes it as bare JSON
// according to the declared dataType, and publishes to the bound MQTT
// channel. Topic prefixing ({networkID}/{agentID}/) is the channel's job.
type MqttPublish struct {
	engine.LinearNode
	channel  *channel.MQTT
	topic    string
	dataType workflowapi.DataType
	value    workflowapi.Expression
	qos      byte
	retain   bool
}

// NewMqttPublish builds an MqttPublish bound to the given MQTT channel.
func NewMqttPublish(id string, ch *channel.MQTT, topic string, dataType workflowapi.DataType, value workflowapi.Expression, qos byte, retain bool) *MqttPublish {
	return &MqttPublish{
		LinearNode: engine.NewLinearNode(id),
		channel:    ch,
		topic:      topic,
		dataType:   dataType,
		value:      value,
		qos:        qos,
		retain:     retain,
	}
}

func (n *MqttPublish) Execute(_ context.Context, scope *engine.Scope) (string, error) {
	v, err := expr.Eval(n.value, scope)
	if err != nil {
		return "", fmt.Errorf("mqttPublish %s: evaluating value: %w", n.ID(), err)
	}
	v = v.Cast(n.dataType)
	payload, err := json.Marshal(v.Raw)
	if err != nil {
		return "", fmt.Errorf("mqttPublish %s: encoding payload: %w", n.ID(), err)
	}
	if err := n.channel.Publish(n.topic, payload, n.qos, n.retain); err != nil {
		return "", fmt.Errorf("mqttPublish %s: %w", n.ID(), err)
	}
	return n.Next(engine.PortCtrl, scope)
}
