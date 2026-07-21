// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build !linux

package resource

import (
	"fmt"
	"sync"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Compile-time assertion: debugGPIO implements GPIODriver.
var _ GPIODriver = (*debugGPIO)(nil)

// debugGPIO is an in-memory GPIODriver for non-Linux dev hosts (or opt-in
// local testing). It keeps per-line state in memory and logs every op;
// WatchEdge stores the callback but never invokes it — events on a
// debug build are not simulated.
type debugGPIO struct {
	log    zerolog.Logger
	chip   string
	mu     sync.Mutex
	state  map[int]bool
	closed bool
}

// OpenGPIO builds an in-memory debug GPIODriver for the named chip.
// Non-linux only; linux builds get the cdev-backed version in gpio_linux.go.
func OpenGPIO(chipName string) (GPIODriver, error) {
	if chipName == "" {
		return nil, fmt.Errorf("gpio: chip is required")
	}
	d := &debugGPIO{
		chip:  chipName,
		log:   logging.Logger.With().Str("driver", "gpio-debug").Str("chip", chipName).Logger(),
		state: make(map[int]bool),
	}
	d.log.Info().Msg("opened chip")
	return d, nil
}

func (d *debugGPIO) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.closed = true
	d.log.Info().Msg("closing chip")
	return nil
}

func (d *debugGPIO) ConfigureInput(line int, bias Bias, debounceMs int, onEvent func(rising bool)) error {
	d.log.Info().
		Int("line", line).
		Str("bias", string(bias)).
		Int("debounce_ms", debounceMs).
		Bool("watching", onEvent != nil).
		Msg("configure input (debug: events never fire)")
	return nil
}

func (d *debugGPIO) ConfigureOutput(line int) error {
	d.log.Info().Int("line", line).Msg("configure output")
	return nil
}

func (d *debugGPIO) ReadDigital(line int) (bool, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	v := d.state[line]
	d.log.Debug().Int("line", line).Bool("value", v).Msg("read digital")
	return v, nil
}

func (d *debugGPIO) WriteDigital(line int, value bool) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	d.state[line] = value
	d.log.Debug().Int("line", line).Bool("value", value).Msg("write digital")
	return nil
}
