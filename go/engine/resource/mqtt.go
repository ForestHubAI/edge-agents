// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package resource

import (
	"fmt"
	"sync"
	"time"

	"github.com/ForestHubAI/edge-agents/go/engine"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// mqttOpTimeout caps every paho operation (connect/publish/subscribe) so a
// half-open connection cannot wedge the engine.
const mqttOpTimeout = 10 * time.Second

// MQTTConnection multiplexes one TCP connection across many topics. A network
// resource, opened from the external resources.
type MQTTConnection interface {
	Resource
	// Publish sends payload to topic.
	Publish(topic string, payload []byte, qos byte, retain bool) error
	// Subscribe installs onMessage as the permanent callback for filter,
	// replacing any prior callback for that same filter; onMessage must be
	// non-blocking. One filter therefore carries one callback — fan-out to
	// several listeners belongs above this layer.
	Subscribe(filter string, qos byte, onMessage func(MQTTMessage)) error
}

// MQTTMessage is one message delivered by an MQTT subscription.
type MQTTMessage struct {
	Topic   string
	Payload []byte
}

// pahoTransport is the paho.mqtt.golang-backed MQTTTransport. One instance
// owns one TCP connection; concurrent Publish/Subscribe are safe per paho.
type pahoTransport struct {
	client mqtt.Client

	mu      sync.Mutex
	claimed map[string]bool // subscribed filters, to reject a second claim on one filter
}

// OpenMQTT establishes a connection to the broker and returns an
// MQTTConnection. Connect blocks up to mqttOpTimeout; on failure no resources
// are leaked.
func OpenMQTT(brokerURL, clientID, username, password string, will *engine.MQTTWill) (MQTTConnection, error) {
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
	return &pahoTransport{client: client, claimed: make(map[string]bool)}, nil
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

// Subscribe installs onMessage as the single callback for filter. A filter takes
// one owner: paho keys its route table by filter and overwrites a match, so a
// second subscription on one filter would silently unhook the first — instead this
// errors. The claim is reserved before the network call and
// rolled back if it fails.
func (t *pahoTransport) Subscribe(filter string, qos byte, onMessage func(MQTTMessage)) error {
	t.mu.Lock()
	if t.claimed[filter] {
		t.mu.Unlock()
		return fmt.Errorf("mqtt subscribe %q: filter already subscribed; one channel per topic", filter)
	}
	t.claimed[filter] = true
	t.mu.Unlock()

	handler := func(_ mqtt.Client, m mqtt.Message) {
		onMessage(MQTTMessage{Topic: m.Topic(), Payload: m.Payload()})
	}
	tok := t.client.Subscribe(filter, qos, handler)
	if !tok.WaitTimeout(mqttOpTimeout) {
		t.unclaim(filter)
		return fmt.Errorf("mqtt subscribe %q: timed out", filter)
	}
	if err := tok.Error(); err != nil {
		t.unclaim(filter)
		return fmt.Errorf("mqtt subscribe %q: %w", filter, err)
	}
	return nil
}

func (t *pahoTransport) unclaim(filter string) {
	t.mu.Lock()
	delete(t.claimed, filter)
	t.mu.Unlock()
}
