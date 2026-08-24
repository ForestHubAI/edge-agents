// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package node

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/schemautil"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*MqttPublish)(nil)
var _ engine.ToolProvider = (*MqttPublish)(nil)

// MqttPublish evaluates a value expression, encodes it as bare JSON
// according to the declared dataType, and publishes to the bound MQTT
// channel. Topic prefixing ({networkID}/{agentID}/) is the channel's job.
//
// value is nil when the node is wired as a tool: the model supplies the value
// per call instead of the workflow author supplying an expression. The channel,
// dataType, qos and retain stay author-owned either way — the model chooses
// what to publish, never where or how.
type MqttPublish struct {
	engine.LinearNode
	channel         *channel.MQTT
	dataType        workflowapi.DataType
	value           *workflowapi.Expression
	toolDescription string
	qos             byte
	retain          bool
}

// NewMqttPublish builds an MqttPublish bound to the given MQTT channel.
func NewMqttPublish(id string, ch *channel.MQTT, dataType workflowapi.DataType, value *workflowapi.Expression, toolDescription string, qos byte, retain bool) *MqttPublish {
	return &MqttPublish{
		LinearNode:      engine.NewLinearNode(id),
		channel:         ch,
		dataType:        dataType,
		value:           value,
		toolDescription: toolDescription,
		qos:             qos,
		retain:          retain,
	}
}

// mqttPublishArgs is the tool-call payload. Value is `any` because the JSON
// type follows the node's declared dataType — Tools() constrains it in the
// schema and mqttPublish coerces it.
type mqttPublishArgs struct {
	Value any `json:"value"`
}

// Execute evaluates the value expression and publishes it. The cast to the
// declared dataType happens here so the author-supplied expression keeps its
// lenient conversion; mqttPublish's Coerce is then a no-op.
func (n *MqttPublish) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	if n.value == nil {
		return "", fmt.Errorf("mqttPublish %s: no value expression", n.ID())
	}
	v, err := expr.Eval(*n.value, scope)
	if err != nil {
		return "", fmt.Errorf("mqttPublish %s: evaluating value: %w", n.ID(), err)
	}
	if _, err := n.mqttPublish(ctx, mqttPublishArgs{Value: v.Cast(n.dataType).Raw}); err != nil {
		return "", err
	}
	return n.Next(engine.PortCtrl, scope)
}

// Tools exposes this node as `mqtt_publish(value)`. The value's JSON type is
// the node's declared dataType, so the model can only publish what the topic
// is declared to carry.
//
// Built by hand rather than through llmproxy.NewFunctionTool: dataType is a
// runtime argument, so the schema can't come from a Go type.
func (n *MqttPublish) Tools() ([]llmproxy.FunctionTool, error) {
	ft := llmproxy.FunctionTool{
		ExternalToolBase: llmproxy.ExternalToolBase{
			Name:        "mqtt_publish",
			Description: n.toolDescription,
			Parameters: schemautil.StrictObject(map[string]any{
				"value": map[string]any{"type": JSONTypeFor(n.dataType)},
			}),
		},
		ToolCall: func(ctx context.Context, raw json.RawMessage) (any, error) {
			var args mqttPublishArgs
			if err := json.Unmarshal(raw, &args); err != nil {
				return nil, fmt.Errorf("mqttPublish %s: parse args: %w", n.ID(), err)
			}
			return n.mqttPublish(ctx, args)
		},
	}
	return []llmproxy.FunctionTool{ft}, nil
}

// mqttPublish is the actual implementation of the tool call, unwrapped from the
// node execution signature. The value is encoded as bare JSON of the declared
// dataType.
func (n *MqttPublish) mqttPublish(_ context.Context, args mqttPublishArgs) (any, error) {
	v, err := expr.Coerce(n.dataType, args.Value)
	if err != nil {
		return nil, fmt.Errorf("mqttPublish %s: value: %w", n.ID(), err)
	}
	payload, err := json.Marshal(v.Raw)
	if err != nil {
		return nil, fmt.Errorf("mqttPublish %s: encoding payload: %w", n.ID(), err)
	}
	if err := n.channel.Publish(payload, n.qos, n.retain); err != nil {
		return nil, fmt.Errorf("mqttPublish %s: %w", n.ID(), err)
	}
	return "ok", nil
}
