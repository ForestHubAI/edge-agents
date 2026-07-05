// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package driver

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/engine"
)

// Registry owns the set of opened drivers for one Engine, keyed by instance
// ID. Typed per family so a miswired manifest (e.g. GPIO id looked up as
// ADC) fails at registration, not at first runtime use.
type Registry struct {
	gpios   map[string]GPIODriver
	adcs    map[string]ADCDriver
	dacs    map[string]DACDriver
	pwms    map[string]PWMDriver
	serials map[string]SerialDriver
}

// NewRegistry opens every driver declared in the manifest. On any failure,
// drivers opened so far are closed before returning, so callers never see a
// partially-initialised Registry.
func NewRegistry(m *engine.DeviceManifest) (*Registry, error) {
	//TODO read from workflow.Manifest
	r := &Registry{
		gpios:   make(map[string]GPIODriver),
		adcs:    make(map[string]ADCDriver),
		dacs:    make(map[string]DACDriver),
		pwms:    make(map[string]PWMDriver),
		serials: make(map[string]SerialDriver),
	}
	for id, cfg := range m.GPIOs {
		d, err := OpenGPIO(cfg.Chip)
		if err != nil {
			r.CloseAll()
			return nil, fmt.Errorf("gpio %q: %w", id, err)
		}
		r.gpios[id] = d
	}
	for id, cfg := range m.ADCs {
		d, err := OpenADC(cfg.Device)
		if err != nil {
			r.CloseAll()
			return nil, fmt.Errorf("adc %q: %w", id, err)
		}
		r.adcs[id] = d
	}
	for id, cfg := range m.DACs {
		d, err := OpenDAC(cfg.Device)
		if err != nil {
			r.CloseAll()
			return nil, fmt.Errorf("dac %q: %w", id, err)
		}
		r.dacs[id] = d
	}
	for id, cfg := range m.Serials {
		d, err := OpenSerial(cfg.Port, cfg.Baud)
		if err != nil {
			r.CloseAll()
			return nil, fmt.Errorf("serial %q: %w", id, err)
		}
		r.serials[id] = d
	}
	for id, cfg := range m.PWMs {
		d, err := OpenPWM(cfg.Chip)
		if err != nil {
			r.CloseAll()
			return nil, fmt.Errorf("pwm %q: %w", id, err)
		}
		r.pwms[id] = d
	}
	return r, nil
}

// Typed accessors for each driver family. Go doesn't allow type-parameterised
// methods, so each one is a thin wrapper over the generic lookup helper.

func (r *Registry) GPIO(id string) (GPIODriver, error)     { return lookup(r.gpios, "gpio", id) }
func (r *Registry) ADC(id string) (ADCDriver, error)       { return lookup(r.adcs, "adc", id) }
func (r *Registry) DAC(id string) (DACDriver, error)       { return lookup(r.dacs, "dac", id) }
func (r *Registry) PWM(id string) (PWMDriver, error)       { return lookup(r.pwms, "pwm", id) }
func (r *Registry) Serial(id string) (SerialDriver, error) { return lookup(r.serials, "serial", id) }

// CloseAll shuts down every driver. Returns the first error encountered;
// keeps going on failures so no handle leaks.
func (r *Registry) CloseAll() error {
	var firstErr error
	closeFamily(r.gpios, "gpio", &firstErr)
	closeFamily(r.adcs, "adc", &firstErr)
	closeFamily(r.dacs, "dac", &firstErr)
	closeFamily(r.pwms, "pwm", &firstErr)
	closeFamily(r.serials, "serial", &firstErr)
	return firstErr
}

// lookup returns the driver registered under id in the given typed map, or
// an error labelled with the family name.
func lookup[T Driver](m map[string]T, family, id string) (T, error) {
	d, ok := m[id]
	if !ok {
		var zero T
		return zero, fmt.Errorf("%s %q: not registered", family, id)
	}
	return d, nil
}

// closeFamily closes every driver in a map, draining it as it goes. Records
// the first Close error via firstErr; subsequent errors are dropped so all
// handles still get a shot at closing.
func closeFamily[T Driver](m map[string]T, family string, firstErr *error) {
	for id, d := range m {
		if err := d.Close(); err != nil && *firstErr == nil {
			*firstErr = fmt.Errorf("%s %q: close: %w", family, id, err)
		}
		delete(m, id)
	}
}
