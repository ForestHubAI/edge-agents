package transport

import (
	"fmt"
	"sync"
	"time"

	"fh-backend/pkg/api"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

// mqttSubBufSize matches channel.SubBufSize for consistent backpressure
// behavior between hardware-channel fanouts and MQTT subscriptions.
const mqttSubBufSize = 64

// mqttOpTimeout caps every paho operation (connect/publish/subscribe) so a
// half-open connection cannot wedge the engine.
const mqttOpTimeout = 10 * time.Second

// pahoTransport is the paho.mqtt.golang-backed MQTTTransport. One instance
// owns one TCP connection; concurrent Publish/Subscribe are safe per paho.
type pahoTransport struct {
	client mqtt.Client

	mu   sync.Mutex
	subs []chan MQTTMessage // closed by Close to unblock readers
}

// OpenMQTT establishes a connection to the broker and returns an
// MQTTTransport. Connect blocks up to mqttOpTimeout; on failure no resources
// are leaked.
func OpenMQTT(brokerURL, clientID, username, password string, will *api.MQTTWill) (MQTTTransport, error) {
	opts := mqtt.NewClientOptions().
		AddBroker(brokerURL).
		SetClientID(clientID).
		SetUsername(username).
		SetPassword(password).
		SetAutoReconnect(true).
		SetCleanSession(true).
		SetConnectTimeout(mqttOpTimeout)
	if will != nil {
		opts.SetBinaryWill(will.Topic, []byte(will.Payload), will.Qos, will.Retain)
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

// Close disconnects from the broker (250ms grace for in-flight messages) and
// closes every subscriber channel so blocked readers exit.
func (t *pahoTransport) Close() error {
	t.client.Disconnect(250)
	t.mu.Lock()
	for _, ch := range t.subs {
		close(ch)
	}
	t.subs = nil
	t.mu.Unlock()
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

func (t *pahoTransport) Subscribe(filter string, qos byte) (<-chan MQTTMessage, error) {
	ch := make(chan MQTTMessage, mqttSubBufSize)
	handler := func(_ mqtt.Client, m mqtt.Message) {
		// Non-blocking send: drop on full so a slow subscriber cannot stall
		// paho's receive goroutine and thereby every other subscription.
		select {
		case ch <- MQTTMessage{Topic: m.Topic(), Payload: m.Payload()}:
		default:
		}
	}

	tok := t.client.Subscribe(filter, qos, handler)
	if !tok.WaitTimeout(mqttOpTimeout) {
		return nil, fmt.Errorf("mqtt subscribe %q: timed out", filter)
	}
	if err := tok.Error(); err != nil {
		return nil, fmt.Errorf("mqtt subscribe %q: %w", filter, err)
	}

	t.mu.Lock()
	t.subs = append(t.subs, ch)
	t.mu.Unlock()
	return ch, nil
}
