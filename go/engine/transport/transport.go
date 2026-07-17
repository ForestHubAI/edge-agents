// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package transport is the protocol-level abstraction for network resources
// the engine talks to. Mirrors driver/: both open once at engine boot, drivers
// from the device manifest and transports from the external resources.
package transport

// Transport is the base contract for protocol handles.
type Transport interface {
	Close() error // Close releases the connection and any associated resources.
}

// MQTTMessage is one message delivered by an MQTT subscription.
type MQTTMessage struct {
	Topic   string
	Payload []byte
}

// MQTTTransport multiplexes one TCP connection across many topics.
type MQTTTransport interface {
	Transport
	// Publish sends payload to topic.
	Publish(topic string, payload []byte, qos byte, retain bool) error
	// Subscribe installs onMessage as the permanent callback for filter,
	// replacing any prior callback for that same filter; onMessage must be
	// non-blocking. One filter therefore carries one callback — fan-out to
	// several listeners belongs above this layer.
	Subscribe(filter string, qos byte, onMessage func(MQTTMessage)) error
}
