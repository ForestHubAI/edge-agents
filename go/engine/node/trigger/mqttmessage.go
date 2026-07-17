// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package trigger

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
	"github.com/ForestHubAI/edge-agents/go/engine/transport"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

const onMqttMessageOutID = "output"

// OnMqttMessage fires whenever a message matching the configured topic
// filter arrives on the bound MQTT channel. The payload is parsed as bare
// JSON into a value of the declared dataType; mismatches are logged and
// dropped so a single bad message can't crash the trigger goroutine.
type OnMqttMessage struct {
	engine.TriggerNode
	dataType workflowapi.DataType
	binding  workflowapi.OutputBinding
	incoming <-chan transport.MQTTMessage
}

// NewOnMqttMessage creates a new OnMqttMessage trigger listening on the
// channel's topic. The channel subscribes to the transport in Setup, once all
// its triggers have registered.
func NewOnMqttMessage(id string, ch *channel.MQTT, dataType workflowapi.DataType, binding workflowapi.OutputBinding) *OnMqttMessage {
	return &OnMqttMessage{
		TriggerNode: engine.NewTriggerNode(id),
		dataType:    dataType,
		binding:     binding,
		incoming:    ch.Subscribe(),
	}
}

func (t *OnMqttMessage) Outputs() map[string]workflowapi.DataType {
	return engine.FilterEmitted(
		map[string]workflowapi.DataType{onMqttMessageOutID: t.dataType},
		map[string]workflowapi.OutputBinding{onMqttMessageOutID: t.binding},
	)
}

func (t *OnMqttMessage) Wait(ctx context.Context) (engine.Event, error) {
	for {
		select {
		case <-ctx.Done():
			return engine.Event{}, ctx.Err()
		case msg := <-t.incoming:
			val, err := decodePayload(msg.Payload, t.dataType)
			if err != nil {
				logging.Logger.Warn().
					Str("trigger", t.ID()).
					Str("topic", msg.Topic).
					Err(err).
					Msg("onMqttMessage: dropping unparseable payload")
				continue
			}
			binding := t.binding
			return t.Emit(func(s *engine.Scope) error {
				return engine.ApplyOutput(s, t.ID(), onMqttMessageOutID, binding, val)
			}), nil
		}
	}
}

func (*OnMqttMessage) Close() error { return nil }

// decodePayload parses bare JSON into a Value of the declared type.
// String type accepts either a JSON string or a raw byte sequence (for
// non-JSON payloads); other types require valid JSON of the matching shape.
func decodePayload(payload []byte, dt workflowapi.DataType) (expr.Value, error) {
	if dt == workflowapi.String {
		// Try JSON-string first; fall back to raw bytes-as-string for
		// non-JSON payloads (common when peers publish plain text).
		var s string
		if err := json.Unmarshal(payload, &s); err == nil {
			return expr.StringVal(s), nil
		}
		return expr.StringVal(string(payload)), nil
	}
	var raw any
	if err := json.Unmarshal(payload, &raw); err != nil {
		return expr.Value{}, fmt.Errorf("invalid JSON: %w", err)
	}
	return expr.Coerce(dt, raw)
}
