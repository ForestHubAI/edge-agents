// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package transport is the protocol-level abstraction for network resources
// the engine talks to. Mirrors driver/, but
// at a different lifecycle scope: drivers come from the device manifest at
// engine boot, transports come from deploy config per deploy.
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
	// Subscribe returns a buffered channel of messages matching filter. Each
	// call creates a separate subscription with its own channel; sends are
	// non-blocking and drop on full so a slow subscriber can never stall the
	// paho receive loop.
	Subscribe(filter string, qos byte) (<-chan MQTTMessage, error)
}
