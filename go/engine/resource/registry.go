// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package resource

import (
	"errors"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/engine"
)

// errTransient marks a resource open-failure that may resolve on its own — a
// network resource whose peer is not up yet (an MQTT broker still starting in
// the same deployment). Hardware opens are never transient: a missing device is
// a permanent config error. Boot policy branches on this, not on the family, so
// a new family classifies its own failures and main never changes.
var errTransient = errors.New("resource temporarily unavailable")

// transient tags err as a retryable open-failure. IsTransient reports the tag.
func transient(err error) error { return fmt.Errorf("%w: %w", errTransient, err) }

// IsTransient reports whether a NewRegistry error is a retryable open-failure
// (peer not up yet) rather than a permanent config error.
func IsTransient(err error) bool { return errors.Is(err, errTransient) }

// Registry owns every opened resource for one Engine, keyed by instance ID.
// Typed per family so a miswired binding (e.g. a GPIO id looked up as an ADC)
// fails at registration, not at first runtime use. Device-owned families come
// from the manifest; network families (MQTT) from the external resources — one
// registry, since both share the Resource lifecycle: open at boot, Close at
// shutdown.
type Registry struct {
	gpios   map[string]GPIODriver
	adcs    map[string]ADCDriver
	dacs    map[string]DACDriver
	pwms    map[string]PWMDriver
	serials map[string]SerialDriver
	cameras map[string]CameraDriver
	mqtts   map[string]MQTTConnection
}

// NewRegistry opens every resource the engine owns: device families from the
// manifest, network families from ext (nil = none). On any failure, resources
// opened so far are closed before returning, so callers never see a
// partially-initialised Registry.
func NewRegistry(m *engine.DeviceManifest, ext *engine.ExternalResources) (*Registry, error) {
	r := &Registry{
		gpios:   make(map[string]GPIODriver),
		adcs:    make(map[string]ADCDriver),
		dacs:    make(map[string]DACDriver),
		pwms:    make(map[string]PWMDriver),
		serials: make(map[string]SerialDriver),
		cameras: make(map[string]CameraDriver),
		mqtts:   make(map[string]MQTTConnection),
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
	for id := range m.Cameras {
		// The manifest key is the name the component selects on, so the driver
		// needs nothing else from cfg — the component owns the capture details.
		d, err := OpenCamera(cameraComponentURL(), id)
		if err != nil {
			r.CloseAll()
			return nil, fmt.Errorf("camera %q: %w", id, err)
		}
		r.cameras[id] = d
	}
	if ext != nil {
		for id, cfg := range ext.MQTTs {
			t, err := OpenMQTT(cfg.BrokerURL, cfg.ClientID, cfg.Username, cfg.Password, cfg.Will)
			if err != nil {
				r.CloseAll()
				// A broker unreachable at boot may come back (often co-deployed and
				// still starting); mark retryable so main lets the orchestrator retry.
				return nil, transient(fmt.Errorf("mqtt %q: %w", id, err))
			}
			r.mqtts[id] = t
		}
	}
	return r, nil
}

// Typed accessors for each resource family. Go doesn't allow type-parameterised
// methods, so each one is a thin wrapper over the generic lookup helper.

func (r *Registry) GPIO(id string) (GPIODriver, error)     { return lookup(r.gpios, "gpio", id) }
func (r *Registry) ADC(id string) (ADCDriver, error)       { return lookup(r.adcs, "adc", id) }
func (r *Registry) DAC(id string) (DACDriver, error)       { return lookup(r.dacs, "dac", id) }
func (r *Registry) PWM(id string) (PWMDriver, error)       { return lookup(r.pwms, "pwm", id) }
func (r *Registry) Serial(id string) (SerialDriver, error) { return lookup(r.serials, "serial", id) }
func (r *Registry) Camera(id string) (CameraDriver, error) { return lookup(r.cameras, "camera", id) }
func (r *Registry) MQTT(id string) (MQTTConnection, error) { return lookup(r.mqtts, "mqtt", id) }

// CloseAll shuts down every resource. Returns the first error encountered;
// keeps going on failures so no handle leaks.
func (r *Registry) CloseAll() error {
	var firstErr error
	closeFamily(r.gpios, "gpio", &firstErr)
	closeFamily(r.adcs, "adc", &firstErr)
	closeFamily(r.dacs, "dac", &firstErr)
	closeFamily(r.pwms, "pwm", &firstErr)
	closeFamily(r.serials, "serial", &firstErr)
	closeFamily(r.cameras, "camera", &firstErr)
	closeFamily(r.mqtts, "mqtt", &firstErr)
	return firstErr
}

// lookup returns the driver registered under id in the given typed map, or
// an error labelled with the family name.
func lookup[T Resource](m map[string]T, family, id string) (T, error) {
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
func closeFamily[T Resource](m map[string]T, family string, firstErr *error) {
	for id, d := range m {
		if err := d.Close(); err != nil && *firstErr == nil {
			*firstErr = fmt.Errorf("%s %q: close: %w", family, id, err)
		}
		delete(m, id)
	}
}
