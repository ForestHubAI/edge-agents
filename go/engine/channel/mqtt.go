// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package channel

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/engine/resource"
)

// subscribeQoS is the QoS every subscription uses: the workflow declares a QoS
// only for publishing, so there is nothing to carry here.
const subscribeQoS byte = 0

// MQTT is a workflow-level MQTT channel: a topic endpoint on a bound broker,
// plus the fanout list of OnMqttMessage subscribers.
type MQTT struct {
	Broadcaster[resource.MQTTMessage]
	Transport       resource.MQTTConnection
	Topic           string // the channel's topic (publish target / subscribe filter)
	PublishPrefix   string // prepended on every Publish; "" = pass-through
	SubscribePrefix string // prepended on every Subscribe; "" = pass-through
}

// Setup wires broadcast as the transport's permanent callback for the channel's
// topic when at least one subscriber is registered. The transport carries one
// callback per filter, so the channel subscribes once and fans out itself.
func (m *MQTT) Setup() error {
	if m.Topic == "" {
		return fmt.Errorf("mqtt channel: topic is required")
	}
	if !m.hasSubscribers() {
		return nil
	}
	return m.Transport.Subscribe(m.SubscribePrefix+m.Topic, subscribeQoS, m.broadcast)
}

// Publish sends payload to the channel's topic under the configured
// PublishPrefix.
func (m *MQTT) Publish(payload []byte, qos byte, retain bool) error {
	return m.Transport.Publish(m.PublishPrefix+m.Topic, payload, qos, retain)
}
