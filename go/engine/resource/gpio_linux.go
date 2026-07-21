// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build linux

package resource

import (
	"fmt"
	"sync"
	"time"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
	"github.com/warthog618/go-gpiocdev"
)

// Compile-time assertion: linuxGPIO implements GPIODriver.
var _ GPIODriver = (*linuxGPIO)(nil)

// linuxGPIO is a cdev-backed GPIODriver using warthog618/go-gpiocdev.
// One instance owns one chip handle; per-line state is just the live
// request — there is no subscriber bookkeeping here, the channel
// layer holds the subscribers and pushes via the WatchEdge callback.
type linuxGPIO struct {
	log      zerolog.Logger
	chipName string
	chip     *gpiocdev.Chip

	mu    sync.Mutex
	lines map[int]*gpiocdev.Line
}

// OpenGPIO acquires the chip handle for the named chip and returns a live
// cdev-backed GPIODriver. gpiocdev.NewChip accepts either a short name
// ("gpiochip0") or a full path ("/dev/gpiochip0").
func OpenGPIO(chipName string) (GPIODriver, error) {
	if chipName == "" {
		return nil, fmt.Errorf("gpio: chip is required")
	}
	chip, err := gpiocdev.NewChip(chipName, gpiocdev.WithConsumer("fh-engine"))
	if err != nil {
		return nil, fmt.Errorf("open gpio chip %s: %w", chipName, err)
	}
	d := &linuxGPIO{
		chipName: chipName,
		log:      logging.Logger.With().Str("driver", "gpio").Str("chip", chipName).Logger(),
		chip:     chip,
		lines:    make(map[int]*gpiocdev.Line),
	}
	d.log.Info().Msg("opened chip")
	return d, nil
}

// Close releases every line request and the chip. line.Close blocks
// until any in-flight cdev event handler returns, so callers' onEvent
// callbacks have completed by the time Close finishes.
func (d *linuxGPIO) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	for offset, line := range d.lines {
		if err := line.Close(); err != nil {
			d.log.Warn().Err(err).Int("line", offset).Msg("closing line")
		}
	}
	d.lines = nil
	if d.chip != nil {
		if err := d.chip.Close(); err != nil {
			return fmt.Errorf("close gpio chip %s: %w", d.chipName, err)
		}
		d.chip = nil
	}
	d.log.Info().Msg("closed chip")
	return nil
}

func (d *linuxGPIO) ConfigureInput(offset int, bias Bias, debounceMs int, onEvent func(rising bool)) error {
	biasOpt, err := biasOption(bias)
	if err != nil {
		return err
	}
	opts := []gpiocdev.LineReqOption{gpiocdev.AsInput, biasOpt}
	if debounceMs > 0 {
		opts = append(opts, gpiocdev.WithDebounce(time.Duration(debounceMs)*time.Millisecond))
	}
	if onEvent != nil {
		opts = append(opts,
			gpiocdev.WithBothEdges,
			gpiocdev.WithEventHandler(func(evt gpiocdev.LineEvent) {
				onEvent(evt.Type == gpiocdev.LineEventRisingEdge)
			}),
		)
	}
	return d.claimLine(offset, opts)
}

// ConfigureOutput requests the line as output (initial value 0).
func (d *linuxGPIO) ConfigureOutput(offset int) error {
	return d.claimLine(offset, []gpiocdev.LineReqOption{gpiocdev.AsOutput(0)})
}

// claimLine requests offset as a driver-owned line. A line takes one owner: if it
// is already configured, claimLine errors rather than tearing down the prior
// request (which would silently break the first channel's I/O, input vs output
// included). Two channels on one (chip, line) are the same requirement declared
// twice — a conflict the deploy resolver rejects; this is the engine's backstop
// for a mapping it did not author. Build-time path — runtime callers must not
// reconfigure pins on the fly.
func (d *linuxGPIO) claimLine(offset int, opts []gpiocdev.LineReqOption) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	if d.chip == nil {
		return fmt.Errorf("gpio chip %s: not open", d.chipName)
	}
	if _, ok := d.lines[offset]; ok {
		return fmt.Errorf("gpio chip %s: line %d already configured; one channel per line", d.chipName, offset)
	}
	line, err := d.chip.RequestLine(offset, opts...)
	if err != nil {
		return fmt.Errorf("request gpio line %d: %w", offset, err)
	}
	d.lines[offset] = line
	d.log.Info().Int("line", offset).Msg("configured line")
	return nil
}

func (d *linuxGPIO) ReadDigital(offset int) (bool, error) {
	line, err := d.lookup(offset)
	if err != nil {
		return false, err
	}
	v, err := line.Value()
	if err != nil {
		return false, fmt.Errorf("read gpio line %d: %w", offset, err)
	}
	return v != 0, nil
}

func (d *linuxGPIO) WriteDigital(offset int, value bool) error {
	line, err := d.lookup(offset)
	if err != nil {
		return err
	}
	raw := 0
	if value {
		raw = 1
	}
	if err := line.SetValue(raw); err != nil {
		return fmt.Errorf("write gpio line %d: %w", offset, err)
	}
	return nil
}

func (d *linuxGPIO) lookup(offset int) (*gpiocdev.Line, error) {
	d.mu.Lock()
	defer d.mu.Unlock()
	line, ok := d.lines[offset]
	if !ok {
		return nil, fmt.Errorf("gpio line %d: not configured", offset)
	}
	return line, nil
}

func biasOption(bias Bias) (gpiocdev.LineReqOption, error) {
	switch bias {
	case BiasNone:
		return gpiocdev.WithBiasDisabled, nil
	case BiasPullup:
		return gpiocdev.WithPullUp, nil
	case BiasPulldown:
		return gpiocdev.WithPullDown, nil
	default:
		return nil, fmt.Errorf("unsupported gpio bias %q (want none, pullup, pulldown)", bias)
	}
}
