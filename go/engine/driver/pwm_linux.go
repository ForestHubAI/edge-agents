// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build linux

package driver

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"syscall"
	"time"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Compile-time assertion: linuxPWM implements PWMDriver.
var _ PWMDriver = (*linuxPWM)(nil)

// Time we allow udev to create a pwmN directory after exporting.
const pwmExportTimeout = 500 * time.Millisecond

// linuxPWM is a sysfs-backed PWMDriver using /sys/class/pwm/pwmchipN. One
// instance owns one chip; per-channel state (cached period) lives in
// channels. All channels are unexported on Close.
type linuxPWM struct {
	log      zerolog.Logger
	mu       sync.Mutex
	chipDir  string
	channels map[int]*pwmChannel
}

// pwmChannel caches the period set at Configure so WriteAnalog can convert
// a [0,1] duty into the corresponding nanosecond pulse width without
// re-reading the file.
type pwmChannel struct {
	periodNs int64
}

// OpenPWM opens the PWM chip at chipDir (a sysfs directory). The path must
// exist and be a directory; individual channels are exported lazily in
// Configure.
func OpenPWM(chipDir string) (PWMDriver, error) {
	if chipDir == "" {
		return nil, fmt.Errorf("pwm: chip directory is required")
	}
	info, err := os.Stat(chipDir)
	if err != nil {
		return nil, fmt.Errorf("open pwm %s: %w", chipDir, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("open pwm %s: not a directory", chipDir)
	}
	d := &linuxPWM{
		chipDir:  chipDir,
		channels: make(map[int]*pwmChannel),
		log:      logging.Logger.With().Str("driver", "pwm").Str("chip", chipDir).Logger(),
	}
	d.log.Info().Msg("opened chip")
	return d, nil
}

// Configure claims the channel and enables its output: export (tolerating EBUSY
// from a leftover sysfs export), reset duty to zero, set the period from freqHz,
// enable. Duty is zeroed before the period so the kernel never sees duty > period
// when a stale export is reused. A channel takes one owner — configuring an
// already-claimed channel errors rather than overwriting its period, so two PWM
// channels on one (chip, channel) fail the build instead of last-frequency silently
// winning.
func (d *linuxPWM) Configure(channel int, freqHz int) error {
	if freqHz <= 0 {
		return fmt.Errorf("pwm: frequency must be positive, got %d", freqHz)
	}
	periodNs := int64(1_000_000_000 / freqHz)

	d.mu.Lock()
	defer d.mu.Unlock()

	if _, ok := d.channels[channel]; ok {
		return fmt.Errorf("pwm channel %d already configured; one channel per PWM channel", channel)
	}

	chanDir := filepath.Join(d.chipDir, fmt.Sprintf("pwm%d", channel))
	if err := writeSysfsString(filepath.Join(d.chipDir, "export"), strconv.Itoa(channel)); err != nil {
		if !errors.Is(err, syscall.EBUSY) {
			return fmt.Errorf("export pwm channel %d: %w", channel, err)
		}
	}
	if err := waitForDir(chanDir, pwmExportTimeout); err != nil {
		return fmt.Errorf("pwm channel %d: %w", channel, err)
	}
	if err := writeSysfsString(filepath.Join(chanDir, "duty_cycle"), "0"); err != nil {
		return fmt.Errorf("reset duty on pwm channel %d: %w", channel, err)
	}
	if err := writeSysfsString(filepath.Join(chanDir, "period"), strconv.FormatInt(periodNs, 10)); err != nil {
		return fmt.Errorf("set period on pwm channel %d: %w", channel, err)
	}
	if err := writeSysfsString(filepath.Join(chanDir, "enable"), "1"); err != nil {
		return fmt.Errorf("enable pwm channel %d: %w", channel, err)
	}

	d.channels[channel] = &pwmChannel{periodNs: periodNs}
	d.log.Info().
		Int("channel", channel).
		Int("freq_hz", freqHz).
		Int64("period_ns", periodNs).
		Msg("configured channel")
	return nil
}

// WriteAnalog sets the channel's duty cycle. duty is clamped to [0,1].
// Configure must have been called first.
func (d *linuxPWM) WriteAnalog(channel int, duty float64) error {
	if duty < 0 {
		duty = 0
	}
	if duty > 1 {
		duty = 1
	}
	d.mu.Lock()
	ch, ok := d.channels[channel]
	if !ok {
		d.mu.Unlock()
		return fmt.Errorf("pwm channel %d: not configured", channel)
	}
	dutyNs := int64(duty * float64(ch.periodNs))
	chipDir := d.chipDir
	d.mu.Unlock()

	path := filepath.Join(chipDir, fmt.Sprintf("pwm%d", channel), "duty_cycle")
	if err := writeSysfsString(path, strconv.FormatInt(dutyNs, 10)); err != nil {
		return fmt.Errorf("write pwm channel %d duty: %w", channel, err)
	}
	return nil
}

// Close disables and unexports every exported channel. Errors during
// teardown are logged but don't prevent other channels from being cleaned up.
// Idempotent — the channels map is drained on first call; subsequent calls
// iterate an empty map and are harmless.
func (d *linuxPWM) Close() error {
	d.mu.Lock()
	defer d.mu.Unlock()
	for ch := range d.channels {
		chanDir := filepath.Join(d.chipDir, fmt.Sprintf("pwm%d", ch))
		if err := writeSysfsString(filepath.Join(chanDir, "enable"), "0"); err != nil {
			d.log.Warn().Err(err).Int("channel", ch).Msg("disabling pwm channel")
		}
		if err := writeSysfsString(filepath.Join(d.chipDir, "unexport"), strconv.Itoa(ch)); err != nil {
			d.log.Warn().Err(err).Int("channel", ch).Msg("unexporting pwm channel")
		}
		delete(d.channels, ch)
	}
	d.log.Info().Msg("closed chip")
	return nil
}

func writeSysfsString(path, value string) error {
	return os.WriteFile(path, []byte(value), 0644)
}

// waitForDir polls until the path exists and is a directory, or the timeout
// expires. sysfs populates pwmN/ asynchronously after export via udev.
func waitForDir(path string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		info, err := os.Stat(path)
		if err == nil && info.IsDir() {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("timeout waiting for %s", path)
		}
		time.Sleep(10 * time.Millisecond)
	}
}
