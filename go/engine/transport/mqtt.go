// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package transport

import (
	"fmt"
	"time"

	"github.com/ForestHubAI/edge-agents/go/engine"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// mqttOpTimeout caps every paho operation (connect/publish/subscribe) so a
// half-open connection cannot wedge the engine.
const mqttOpTimeout = 10 * time.Second

// pahoTransport is the paho.mqtt.golang-backed MQTTTransport. One instance
// owns one TCP connection; concurrent Publish/Subscribe are safe per paho.
type pahoTransport struct {
	client mqtt.Client
}

// OpenMQTT establishes a connection to the broker and returns an
// MQTTTransport. Connect blocks up to mqttOpTimeout; on failure no resources
// are leaked.
func OpenMQTT(brokerURL, clientID, username, password string, will *engine.MQTTWill) (MQTTTransport, error) {
	opts := mqtt.NewClientOptions().
		AddBroker(brokerURL).
		SetClientID(clientID).
		SetUsername(username).
		SetPassword(password).
		SetAutoReconnect(true).
		SetCleanSession(true).
		SetConnectTimeout(mqttOpTimeout)
	if will != nil {
		opts.SetBinaryWill(will.Topic, []byte(will.Payload), byte(will.Qos), will.Retain)
	}

	client := mqtt.NewClient(opts)
	tok := client.Connect()
	if !tok.WaitTimeout(mqttOpTimeout) {
		return nil, fmt.Errorf("mqtt connect %s: timed out", brokerURL)
	}
	if err := tok.Error(); err != nil {
		return nil, fmt.Errorf("mqtt connect %s: %w", brokerURL, err)
	}
	return &pahoTransport{client: client}, nil
}

// Close disconnects from the broker, allowing 250ms for in-flight messages.
// Callbacks stop firing once paho's receive loop is down; listeners above
// unblock on their own context, not on a closed stream.
func (t *pahoTransport) Close() error {
	t.client.Disconnect(250)
	return nil
}

func (t *pahoTransport) Publish(topic string, payload []byte, qos byte, retain bool) error {
	tok := t.client.Publish(topic, qos, retain, payload)
	if !tok.WaitTimeout(mqttOpTimeout) {
		return fmt.Errorf("mqtt publish %q: timed out", topic)
	}
	if err := tok.Error(); err != nil {
		return fmt.Errorf("mqtt publish %q: %w", topic, err)
	}
	return nil
}

// Subscribe installs onMessage as the permanent callback for filter. paho keys
// its route table by filter and overwrites a matching entry, so a second call
// with the same filter silently unhooks the first — hence the replacing
// contract rather than a per-call subscription.
func (t *pahoTransport) Subscribe(filter string, qos byte, onMessage func(MQTTMessage)) error {
	handler := func(_ mqtt.Client, m mqtt.Message) {
		onMessage(MQTTMessage{Topic: m.Topic(), Payload: m.Payload()})
	}
	tok := t.client.Subscribe(filter, qos, handler)
	if !tok.WaitTimeout(mqttOpTimeout) {
		return fmt.Errorf("mqtt subscribe %q: timed out", filter)
	}
	if err := tok.Error(); err != nil {
		return fmt.Errorf("mqtt subscribe %q: %w", filter, err)
	}
	return nil
}
