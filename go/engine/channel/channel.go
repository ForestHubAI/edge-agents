// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package channel defines the engine's workflow-level handles to external
// resources — hardware drivers (GPIO, ADC, UART, ...) and network protocols
// (MQTT, future HTTP). A channel mediates between nodes that read/write it
// and the underlying driver or transport. Nodes register against the channel
// during build; Setup configures the driver accordingly.
package channel

// Channel is the contract that all channel types must satisfy.
type Channel interface {
	Setup() error // Setup configures the underlying driver according to the registered nodes. Called once during engine setup, after all nodes have registered.
}

// TextWriter is the write side shared by channels that take a string payload:
// UART (raw serial bytes) and Log (a logger line). Nodes that write text target
// this instead of a concrete channel so one node serves every such channel.
type TextWriter interface {
	Write(data string) error
}

// SubBufSize is the buffer size used in subscription channels. Events are dropped when this buffer size is exceeded.
const SubBufSize = 64

// Broadcaster allows multiple trigger nodes to receive events from a single channel.
// broadcast pushes non-blockingly and drops on full so a
// slow subscriber can never stall the producing driver thread.
type Broadcaster[T any] struct {
	subscribers []chan T
}

// Subscribe appends a buffered channel to the fanout list and returns it;
// call during build, before the driver starts producing. The channel stays open
// for the process lifetime: a subscriber ends on its own context, never on a
// closed stream.
func (b *Broadcaster[T]) Subscribe() <-chan T {
	ch := make(chan T, SubBufSize)
	b.subscribers = append(b.subscribers, ch)
	return ch
}

// broadcast pushes ev non-blockingly onto every subscriber, dropping on full.
func (b *Broadcaster[T]) broadcast(ev T) {
	for _, ch := range b.subscribers {
		select {
		case ch <- ev:
		default:
		}
	}
}

// hasSubscribers reports whether any subscriber is registered; channels
// use it to skip wiring the driver callback when nobody is listening.
func (b *Broadcaster[T]) hasSubscribers() bool {
	return len(b.subscribers) > 0
}
