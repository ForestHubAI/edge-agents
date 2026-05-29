package channel

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/engine/transport"
)

// MQTT is a workflow-level MQTT channel: a topic endpoint on a bound broker.
type MQTT struct {
	Transport       transport.MQTTTransport
	Topic           string // the channel's topic (publish target / subscribe filter)
	PublishPrefix   string // prepended on every Publish; "" = pass-through
	SubscribePrefix string // prepended on every Subscribe; "" = pass-through
}

func (*MQTT) Setup() error { return nil }

// Publish prepends the configured PublishPrefix to topic and forwards to
// the transport. Topic must not be empty and must not contain MQTT
// wildcards (+, #).
func (m *MQTT) Publish(topic string, payload []byte, qos byte, retain bool) error {
	if topic == "" {
		return fmt.Errorf("mqtt publish: topic is required")
	}
	return m.Transport.Publish(m.PublishPrefix+topic, payload, qos, retain)
}

// Subscribe prepends the configured SubscribePrefix to filter and forwards
// to the transport.
func (m *MQTT) Subscribe(filter string, qos byte) (<-chan transport.MQTTMessage, error) {
	if filter == "" {
		return nil, fmt.Errorf("mqtt subscribe: filter is required")
	}
	return m.Transport.Subscribe(m.SubscribePrefix+filter, qos)
}
