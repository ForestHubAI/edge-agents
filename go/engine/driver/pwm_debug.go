// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build !linux

package driver

import (
	"fmt"
	"sync"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Compile-time assertion: debugPWM implements PWMDriver.
var _ PWMDriver = (*debugPWM)(nil)

// debugPWM is an in-memory PWMDriver for non-Linux dev hosts. It logs every
// op and remembers the last duty per channel.
type debugPWM struct {
	log     zerolog.Logger
	chipDir string
	mu      sync.Mutex
	duties  map[int]float64
	freqs   map[int]int
}

// OpenPWM builds an in-memory debug PWMDriver for the named chip.
// Non-linux only; linux builds get the sysfs-backed version in pwm_linux.go.
func OpenPWM(chipDir string) (PWMDriver, error) {
	if chipDir == "" {
		return nil, fmt.Errorf("pwm: chip directory is required")
	}
	d := &debugPWM{
		chipDir: chipDir,
		duties:  make(map[int]float64),
		freqs:   make(map[int]int),
		log:     logging.Logger.With().Str("driver", "pwm-debug").Str("chip", chipDir).Logger(),
	}
	d.log.Info().Msg("opened chip")
	return d, nil
}

func (d *debugPWM) Close() error {
	d.log.Info().Msg("closing chip")
	return nil
}

func (d *debugPWM) Configure(channel, freqHz int) error {
	if freqHz <= 0 {
		return fmt.Errorf("pwm: frequency must be positive, got %d", freqHz)
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	d.freqs[channel] = freqHz
	d.log.Info().Int("channel", channel).Int("freq_hz", freqHz).Msg("configure channel")
	return nil
}

func (d *debugPWM) WriteAnalog(channel int, duty float64) error {
	if duty < 0 {
		duty = 0
	}
	if duty > 1 {
		duty = 1
	}
	d.mu.Lock()
	defer d.mu.Unlock()
	if _, ok := d.freqs[channel]; !ok {
		return fmt.Errorf("pwm channel %d: not configured", channel)
	}
	d.duties[channel] = duty
	d.log.Debug().Int("channel", channel).Float64("duty", duty).Msg("write analog")
	return nil
}
