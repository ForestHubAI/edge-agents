// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build !linux

package driver

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Compile-time assertion: debugADC implements ADCDriver.
var _ ADCDriver = (*debugADC)(nil)

// debugADC is a no-op ADCDriver for non-Linux dev hosts. Every read returns
// 0.0 — it exists so the engine builds and runs on Windows/macOS with
// analog bindings wired, not to produce realistic data.
type debugADC struct {
	log        zerolog.Logger
	devicePath string
}

// OpenADC builds an in-memory debug ADCDriver for the named device.
// Non-linux only; linux builds get the IIO-backed version in adc_linux.go.
func OpenADC(devicePath string) (ADCDriver, error) {
	if devicePath == "" {
		return nil, fmt.Errorf("adc: device path is required")
	}
	d := &debugADC{
		devicePath: devicePath,
		log:        logging.Logger.With().Str("driver", "adc-debug").Str("device", devicePath).Logger(),
	}
	d.log.Info().Msg("opened device")
	return d, nil
}

func (d *debugADC) Close() error {
	d.log.Info().Msg("closing device")
	return nil
}

func (d *debugADC) ReadAnalog(channel int) (float64, error) {
	d.log.Debug().Int("channel", channel).Msg("read analog (debug: returns 0)")
	return 0, nil
}
