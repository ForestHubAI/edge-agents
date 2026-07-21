// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package channel

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ForestHubAI/edge-agents/go/engine/resource"
)

// fakeMQTT records the installed callback per filter, mirroring paho's
// route table: a second install on one filter replaces the first.
type fakeMQTT struct {
	callbacks map[string]func(resource.MQTTMessage)
	installs  int
	published []string
}

func newFakeMQTT() *fakeMQTT {
	return &fakeMQTT{callbacks: map[string]func(resource.MQTTMessage){}}
}

func (f *fakeMQTT) Close() error { return nil }

func (f *fakeMQTT) Publish(topic string, _ []byte, _ byte, _ bool) error {
	f.published = append(f.published, topic)
	return nil
}

func (f *fakeMQTT) Subscribe(filter string, _ byte, onMessage func(resource.MQTTMessage)) error {
	f.callbacks[filter] = onMessage
	f.installs++
	return nil
}

func (f *fakeMQTT) deliver(filter string, payload string) {
	f.callbacks[filter](resource.MQTTMessage{Topic: filter, Payload: []byte(payload)})
}

var _ resource.MQTTConnection = (*fakeMQTT)(nil)

func TestMQTTSetup_FansOutOneSubscriptionToEverySubscriber(t *testing.T) {
	// The transport holds one callback per filter, so N triggers on one channel
	// must share a single subscription — installing per trigger would leave all
	// but the last silently unhooked.
	f := newFakeMQTT()
	m := &MQTT{Transport: f, Topic: "alarm", SubscribePrefix: "site/"}

	a := m.Subscribe()
	b := m.Subscribe()
	require.NoError(t, m.Setup())

	assert.Equal(t, 1, f.installs)
	require.Contains(t, f.callbacks, "site/alarm")

	f.deliver("site/alarm", "fire")
	assert.Equal(t, []byte("fire"), (<-a).Payload)
	assert.Equal(t, []byte("fire"), (<-b).Payload)
}

func TestMQTTSetup_NoSubscribersSkipsTheSubscription(t *testing.T) {
	// A publish-only channel must not claim the filter's callback slot.
	f := newFakeMQTT()
	m := &MQTT{Transport: f, Topic: "alarm"}

	require.NoError(t, m.Setup())
	assert.Zero(t, f.installs)
}

func TestMQTTSetup_EmptyTopicFails(t *testing.T) {
	// The topic serves both directions, so the check gates the whole channel —
	// a publish-only channel reaches Setup and nothing else.
	t.Run("with a subscriber", func(t *testing.T) {
		m := &MQTT{Transport: newFakeMQTT()}
		m.Subscribe()
		require.Error(t, m.Setup())
	})

	t.Run("publish-only", func(t *testing.T) {
		m := &MQTT{Transport: newFakeMQTT()}
		require.Error(t, m.Setup())
	})
}

func TestMQTTPublish_TargetsTheChannelTopicUnderThePublishPrefix(t *testing.T) {
	// The topic is the channel's, not the caller's: a publish target is an
	// endpoint the channel already names.
	f := newFakeMQTT()
	m := &MQTT{Transport: f, Topic: "alarm", PublishPrefix: "site/"}

	require.NoError(t, m.Publish([]byte("x"), 0, false))
	assert.Equal(t, []string{"site/alarm"}, f.published)
}

func TestMQTTBroadcast_DropsWhenSubscriberIsFull(t *testing.T) {
	// broadcast runs on the transport's receive goroutine: a stalled trigger
	// must lose messages rather than stall every other subscription.
	f := newFakeMQTT()
	m := &MQTT{Transport: f, Topic: "alarm"}
	sub := m.Subscribe()
	require.NoError(t, m.Setup())

	for range SubBufSize + 10 {
		f.deliver("alarm", "x")
	}
	assert.Len(t, sub, SubBufSize)
}
