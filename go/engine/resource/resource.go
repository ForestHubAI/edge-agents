// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package resource is the abstraction for every I/O resource the engine opens
// at boot and holds for its lifetime, local or remote. A resource owns one
// handle — a kernel handle (GPIO chip, IIO device, PWM chip, serial port), an
// out-of-process driver component reached over HTTP (camera), or a network
// connection (MQTT) — and any thread that produces events from it. Device
// families come from the device manifest, network families from the external
// resources; both share the one Resource lifecycle and the one Registry.
// Implementations are build-tag-selected and created via family-specific constructors.
package resource

import (
	"context"
)

// Resource is the base contract every engine resource satisfies, local or
// remote: a handle opened once at engine boot and released at shutdown. The
// capability interfaces extend it with their specific I/O.
type Resource interface {
	Close() error // Close releases the underlying handle and any associated resources.
}

// Bias is the internal pull-resistor configuration of a GPIO input.
// "none" is a real electrical state (floating), not a sentinel for "unset".
type Bias string

const (
	BiasNone     Bias = "none"
	BiasPullup   Bias = "pullup"
	BiasPulldown Bias = "pulldown"
)

// GPIODriver handles digital I/O lines.
type GPIODriver interface {
	Resource
	// ConfigureInput requests the line as input. Bias and debounceMs are line-wide properties.
	// Pass onEvent for edge reporting (always reports rising and falling); nil keeps the line event-free.
	ConfigureInput(line int, bias Bias, debounceMs int, onEvent func(rising bool)) error
	// ConfigureOutput requests the line as output.
	ConfigureOutput(line int) error
	ReadDigital(line int) (bool, error)
	WriteDigital(line int, value bool) error
}

// ADCDriver handles analog inputs. Channels do not need per-channel acquisition.
type ADCDriver interface {
	Resource
	ReadAnalog(channel int) (float64, error)
}

// DACDriver handles true analog outputs (Digital-to-Analog Converter).
// Distinct from PWMDriver: a DAC sets a real voltage, while PWM produces
// a switched square wave whose average looks analog only after low-pass
// filtering by the connected load. Channels do not need per-channel
// acquisition — same shape as ADC, just inverse direction.
type DACDriver interface {
	Resource
	// WriteAnalog writes the given voltage (millivolts) to the channel.
	WriteAnalog(channel int, mV float64) error
}

// PWMDriver handles analog outputs via pulse-width modulation.
type PWMDriver interface {
	Resource
	// Configure must be called once per channel before channel can be written to
	Configure(channel int, freqHz int) error
	// WriteAnalog takes duty cycle in [0.0, 1.0] (clampes outside the range)
	WriteAnalog(channel int, duty float64) error
}

// SerialDriver handles one serial port. Read and WatchRead share the same
// line stream with stealing semantics — an in-flight Read takes a line
// before the WatchRead callback.
type SerialDriver interface {
	Resource
	// Read blocks until one line arrives (therefore takes context). Errors if another Read is in flight.
	Read(ctx context.Context) (string, error)
	// WatchRead installs onLine as the permanent line callback; onLine must be non-blocking.
	WatchRead(onLine func(line string)) error
	// Flush discards buffered input.
	Flush() error
	Write(data string) error
}
