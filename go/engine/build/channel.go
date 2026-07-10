// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"

	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/driver"
	"github.com/ForestHubAI/edge-agents/go/engine/transport"
	"github.com/ForestHubAI/edge-agents/go/logging"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
)

// channels is the per-build typed registry of channel instances. One
// instance per declared workflowapi.Channel, keyed by its id. Nodes look up their
// linked channel here at build time and hold the pointer; the same
// instance is shared across every node referencing the same id (so
// subscriber lists and driver handle reservations stay consistent).
type channels struct {
	gpioInputs  map[string]*channel.GPIOInput
	gpioOutputs map[string]*channel.GPIOOutput
	adcs        map[string]*channel.ADC
	dacs        map[string]*channel.DAC
	pwms        map[string]*channel.PWM
	uarts       map[string]*channel.UART
	mqtts       map[string]*channel.MQTT
	logs        map[string]*channel.Log
}

// buildChannels pre-builds a channel for every declaration in the workflow.
// The workflow itself is binding-free; every channel's binding comes from the
// flat resource mapping dm (channel id → platform resource id). Hardware channels
// resolve that id through drvs (driver instance in the boot device manifest);
// MQTT channels resolve it through ext + transports (external resource id →
// MQTT config + open transport). Hard-fails when a channel has no binding in the
// mapping, or an MQTT channel references a config externalResources doesn't carry —
// silent degradation hides config bugs.
func buildChannels(apiChannels []workflowapi.Channel, dm engine.ResourceMapping, drvs *driver.Registry, transports *transport.Registry, ext *engine.ExternalResources) (*channels, error) {
	ch := &channels{
		gpioInputs:  make(map[string]*channel.GPIOInput),
		gpioOutputs: make(map[string]*channel.GPIOOutput),
		adcs:        make(map[string]*channel.ADC),
		dacs:        make(map[string]*channel.DAC),
		pwms:        make(map[string]*channel.PWM),
		uarts:       make(map[string]*channel.UART),
		mqtts:       make(map[string]*channel.MQTT),
		logs:        make(map[string]*channel.Log),
	}
	for _, c := range apiChannels {
		val, err := c.ValueByDiscriminator()
		if err != nil {
			return nil, fmt.Errorf("channel: %w", err)
		}
		switch x := val.(type) {
		case workflowapi.GPIOINChannel:
			b, err := bindingFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			line, err := indexFor(b, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.GPIO(b.Ref)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", b.Ref, x.Id, err)
			}
			ch.gpioInputs[x.Id] = &channel.GPIOInput{
				Driver:     d,
				Line:       line,
				Bias:       driver.Bias(x.Bias),
				DebounceMs: x.DebounceMs,
			}
		case workflowapi.GPIOOUTChannel:
			b, err := bindingFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			line, err := indexFor(b, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.GPIO(b.Ref)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", b.Ref, x.Id, err)
			}
			ch.gpioOutputs[x.Id] = &channel.GPIOOutput{
				Driver: d,
				Line:   line,
			}
		case workflowapi.ADCChannel:
			b, err := bindingFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			channelNum, err := indexFor(b, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.ADC(b.Ref)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", b.Ref, x.Id, err)
			}
			ch.adcs[x.Id] = &channel.ADC{
				Driver:  d,
				Channel: channelNum,
			}
		case workflowapi.DACChannel:
			b, err := bindingFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			channelNum, err := indexFor(b, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.DAC(b.Ref)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", b.Ref, x.Id, err)
			}
			ch.dacs[x.Id] = &channel.DAC{
				Driver:  d,
				Channel: channelNum,
			}
		case workflowapi.PWMChannel:
			b, err := bindingFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			channelNum, err := indexFor(b, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.PWM(b.Ref)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", b.Ref, x.Id, err)
			}
			ch.pwms[x.Id] = &channel.PWM{
				Driver:    d,
				Channel:   channelNum,
				Frequency: x.Frequency,
			}
		case workflowapi.UARTChannel:
			b, err := bindingFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.Serial(b.Ref)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", b.Ref, x.Id, err)
			}
			ch.uarts[x.Id] = &channel.UART{Driver: d}
		case workflowapi.MQTTChannel:
			b, err := bindingFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			if ext == nil {
				return nil, fmt.Errorf("channel %s: workflow references MQTT but no external resources provided", x.Id)
			}
			cfg, ok := ext.MQTTs[b.Ref]
			if !ok {
				return nil, fmt.Errorf("channel %s: external resource %q not in externalResources", x.Id, b.Ref)
			}
			if transports == nil {
				return nil, fmt.Errorf("channel %s: no transport registry", x.Id)
			}
			t, err := transports.MQTT(b.Ref)
			if err != nil {
				return nil, fmt.Errorf("channel %s: %w", x.Id, err)
			}
			ch.mqtts[x.Id] = &channel.MQTT{
				Transport:       t,
				Topic:           x.Topic,
				PublishPrefix:   cfg.PublishPrefix,
				SubscribePrefix: cfg.SubscribePrefix,
			}
		case workflowapi.LOGChannel:
			// No bindingFor: a log channel resolves to the ambient engine logger,
			// not a device driver or external resource, so the mapping carries no
			// entry for it. Level is contract-constrained to a known enum; parse
			// defensively and hard-fail rather than silently logging at the wrong
			// severity.
			level, err := logging.ParseLevel(string(x.Level))
			if err != nil {
				return nil, fmt.Errorf("channel %s: %w", x.Id, err)
			}
			ch.logs[x.Id] = &channel.Log{Level: level, Tag: pointer.Val(x.Tag)}
		case workflowapi.CAMERAChannel:
			// A camera resolves to a capture component, not a device driver or
			// transport, so there is nothing to build here. Its endpoint is
			// resolved in buildDeployCapture and the CameraCapture node binds to
			// that CaptureClient directly.
		default:
			return nil, fmt.Errorf("channel: unsupported type %T", val)
		}
	}
	return ch, nil
}

// bindingFor resolves a channel's binding from the resource mapping. The workflow
// no longer carries the binding, so a missing entry is a config
// misconfiguration, not silent degradation. The ref resolves against the device
// driver registry (hardware) or external resources (MQTT) at the call site, by
// channel type.
func bindingFor(dm engine.ResourceMapping, channelID string) (engine.ResourceBinding, error) {
	if dm == nil {
		return engine.ResourceBinding{}, fmt.Errorf("channel %s: no resource mapping provided", channelID)
	}
	b, ok := dm[channelID]
	if !ok || b.Ref == "" {
		return engine.ResourceBinding{}, fmt.Errorf("channel %s: no binding in resource mapping", channelID)
	}
	return b, nil
}

// indexFor returns the binding's physical sub-address (GPIO line / ADC-PWM-DAC
// channel). Addressable channels require it; a nil index is a config
// misconfiguration.
func indexFor(b engine.ResourceBinding, channelID string) (int, error) {
	if b.Index == nil {
		return 0, fmt.Errorf("channel %s: binding has no index (line/channel)", channelID)
	}
	return *b.Index, nil
}

// SetupAll runs Setup on every channel. Must run after all graph nodes are built.
func (ch *channels) SetupAll() error {
	for id, v := range ch.gpioInputs {
		if err := v.Setup(); err != nil {
			return fmt.Errorf("gpioin %q: %w", id, err)
		}
	}
	for id, v := range ch.gpioOutputs {
		if err := v.Setup(); err != nil {
			return fmt.Errorf("gpioout %q: %w", id, err)
		}
	}
	for id, v := range ch.adcs {
		if err := v.Setup(); err != nil {
			return fmt.Errorf("adc %q: %w", id, err)
		}
	}
	for id, v := range ch.dacs {
		if err := v.Setup(); err != nil {
			return fmt.Errorf("dac %q: %w", id, err)
		}
	}
	for id, v := range ch.pwms {
		if err := v.Setup(); err != nil {
			return fmt.Errorf("pwm %q: %w", id, err)
		}
	}
	for id, v := range ch.uarts {
		if err := v.Setup(); err != nil {
			return fmt.Errorf("uart %q: %w", id, err)
		}
	}
	for id, v := range ch.mqtts {
		if err := v.Setup(); err != nil {
			return fmt.Errorf("mqtt %q: %w", id, err)
		}
	}
	for id, v := range ch.logs {
		if err := v.Setup(); err != nil {
			return fmt.Errorf("log %q: %w", id, err)
		}
	}
	return nil
}

func (ch *channels) gpioInput(id string) (*channel.GPIOInput, error) {
	v, ok := ch.gpioInputs[id]
	if !ok {
		return nil, fmt.Errorf("no GPIOIN channel %q", id)
	}
	return v, nil
}

func (ch *channels) gpioOutput(id string) (*channel.GPIOOutput, error) {
	v, ok := ch.gpioOutputs[id]
	if !ok {
		return nil, fmt.Errorf("no GPIOOUT channel %q", id)
	}
	return v, nil
}

func (ch *channels) adc(id string) (*channel.ADC, error) {
	v, ok := ch.adcs[id]
	if !ok {
		return nil, fmt.Errorf("no ADC channel %q", id)
	}
	return v, nil
}

func (ch *channels) dac(id string) (*channel.DAC, error) {
	v, ok := ch.dacs[id]
	if !ok {
		return nil, fmt.Errorf("no DAC channel %q", id)
	}
	return v, nil
}

func (ch *channels) pwm(id string) (*channel.PWM, error) {
	v, ok := ch.pwms[id]
	if !ok {
		return nil, fmt.Errorf("no PWM channel %q", id)
	}
	return v, nil
}

func (ch *channels) uart(id string) (*channel.UART, error) {
	v, ok := ch.uarts[id]
	if !ok {
		return nil, fmt.Errorf("no UART channel %q", id)
	}
	return v, nil
}

// textWriter resolves a channel a text-writing node can target: a UART (serial
// bytes) or a Log (logger line). It checks both pools so SerialWrite accepts
// either kind from one reference.
func (ch *channels) textWriter(id string) (channel.TextWriter, error) {
	if v, ok := ch.uarts[id]; ok {
		return v, nil
	}
	if v, ok := ch.logs[id]; ok {
		return v, nil
	}
	return nil, fmt.Errorf("no UART or LOG channel %q", id)
}

func (ch *channels) mqtt(id string) (*channel.MQTT, error) {
	v, ok := ch.mqtts[id]
	if !ok {
		return nil, fmt.Errorf("no MQTT channel %q", id)
	}
	return v, nil
}
