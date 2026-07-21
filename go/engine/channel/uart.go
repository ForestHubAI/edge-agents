// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package channel

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/engine/resource"
)

// UART is a serial port channel wrapping a SerialDriver and the
// fanout list of OnSerialReceive subscribers.
type UART struct {
	Broadcaster[string]
	Driver resource.SerialDriver
}

// Setup wires broadcast as the driver's permanent line callback when at
// least one subscriber is registered.
func (v *UART) Setup() error {
	if !v.hasSubscribers() {
		return nil
	}
	return v.Driver.WatchRead(v.broadcast)
}

// Read blocks until one line arrives.
func (v *UART) Read(ctx context.Context) (string, error) {
	return v.Driver.Read(ctx)
}

// Write sends raw bytes; the caller is responsible for terminators.
func (v *UART) Write(data string) error {
	return v.Driver.Write(data)
}

// Flush discards buffered input.
func (v *UART) Flush() error {
	return v.Driver.Flush()
}
