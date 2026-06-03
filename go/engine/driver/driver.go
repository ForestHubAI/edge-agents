// Package driver is the OS-level abstraction for I/O resources. Each
// driver instance owns one opened kernel handle (a GPIO chip, an IIO
// device, a PWM chip, a serial port) and any thread that produces events
// from it.
// Implementations are build-tag-selected and created via family-specific constructors.
package driver

import (
	"context"
)

// Driver is the base contract for interacting with hardware resources
type Driver interface {
	Close() error // Close releases the kernel handle and any associated resources.
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
	Driver
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
	Driver
	ReadAnalog(channel int) (float64, error)
}

// DACDriver handles true analog outputs (Digital-to-Analog Converter).
// Distinct from PWMDriver: a DAC sets a real voltage, while PWM produces
// a switched square wave whose average looks analog only after low-pass
// filtering by the connected load. Channels do not need per-channel
// acquisition — same shape as ADC, just inverse direction.
type DACDriver interface {
	Driver
	// WriteAnalog writes the given voltage (millivolts) to the channel.
	WriteAnalog(channel int, mV float64) error
}

// PWMDriver handles analog outputs via pulse-width modulation.
type PWMDriver interface {
	Driver
	// Configure must be called once per channel before channel can be written to
	Configure(channel int, freqHz int) error
	// WriteAnalog takes duty cycle in [0.0, 1.0] (clampes outside the range)
	WriteAnalog(channel int, duty float64) error
}

// SerialDriver handles one serial port. Read and WatchRead share the same
// line stream with stealing semantics — an in-flight Read takes a line
// before the WatchRead callback.
type SerialDriver interface {
	Driver
	// Read blocks until one line arrives (therefore takes context). Errors if another Read is in flight.
	Read(ctx context.Context) (string, error)
	// WatchRead installs onLine as the permanent line callback; onLine must be non-blocking.
	WatchRead(onLine func(line string)) error
	// Flush discards buffered input.
	Flush() error
	Write(data string) error
}
