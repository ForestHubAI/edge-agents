package build

import (
	"fmt"

	"github.com/ForestHubAI/fh-core/go/api/workflow"
	"github.com/ForestHubAI/fh-core/go/engine"

	"github.com/ForestHubAI/fh-core/go/engine/channel"
	"github.com/ForestHubAI/fh-core/go/engine/driver"
	"github.com/ForestHubAI/fh-core/go/engine/transport"
)

// channels is the per-build typed registry of channel instances. One
// instance per declared workflow.Channel, keyed by its id. Nodes look up their
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
}

// buildChannels pre-builds a channel for every declaration in the workflow.
// The workflow itself is binding-free; the channel→driver and channel→network
// bindings come from the deploy mapping dm. Hardware channels resolve through
// dm.Drivers + drvs (driver instance ID → driver from the device manifest).
// MQTT channels resolve through dm.Networks + nm + transports (network ID →
// MQTT config + open transport from the deploy network manifest). Hard-fails
// when a channel has no binding in the mapping, or an MQTT channel references a
// network the deploy doesn't carry — silent degradation hides config bugs.
func buildChannels(apiChannels []workflow.Channel, dm *engine.DeploymentMapping, drvs *driver.Registry, transports *transport.Registry, nm *engine.NetworkManifest) (*channels, error) {
	ch := &channels{
		gpioInputs:  make(map[string]*channel.GPIOInput),
		gpioOutputs: make(map[string]*channel.GPIOOutput),
		adcs:        make(map[string]*channel.ADC),
		dacs:        make(map[string]*channel.DAC),
		pwms:        make(map[string]*channel.PWM),
		uarts:       make(map[string]*channel.UART),
		mqtts:       make(map[string]*channel.MQTT),
	}
	for _, c := range apiChannels {
		val, err := c.ValueByDiscriminator()
		if err != nil {
			return nil, fmt.Errorf("channel: %w", err)
		}
		switch x := val.(type) {
		case workflow.GPIOINChannel:
			driverID, err := driverFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.GPIO(driverID)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", driverID, x.Id, err)
			}
			ch.gpioInputs[x.Id] = &channel.GPIOInput{
				Driver:     d,
				Line:       x.Line,
				Bias:       driver.Bias(x.Bias),
				DebounceMs: x.DebounceMs,
			}
		case workflow.GPIOOUTChannel:
			driverID, err := driverFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.GPIO(driverID)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", driverID, x.Id, err)
			}
			ch.gpioOutputs[x.Id] = &channel.GPIOOutput{
				Driver: d,
				Line:   x.Line,
			}
		case workflow.ADCChannel:
			driverID, err := driverFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.ADC(driverID)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", driverID, x.Id, err)
			}
			ch.adcs[x.Id] = &channel.ADC{
				Driver:  d,
				Channel: x.Channel,
			}
		case workflow.DACChannel:
			driverID, err := driverFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.DAC(driverID)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", driverID, x.Id, err)
			}
			ch.dacs[x.Id] = &channel.DAC{
				Driver:  d,
				Channel: x.Channel,
			}
		case workflow.PWMChannel:
			driverID, err := driverFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.PWM(driverID)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", driverID, x.Id, err)
			}
			ch.pwms[x.Id] = &channel.PWM{
				Driver:    d,
				Channel:   x.Channel,
				Frequency: x.Frequency,
			}
		case workflow.UARTChannel:
			driverID, err := driverFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			d, err := drvs.Serial(driverID)
			if err != nil {
				return nil, fmt.Errorf("error getting driver with ID %s for channel %s: %w", driverID, x.Id, err)
			}
			ch.uarts[x.Id] = &channel.UART{Driver: d}
		case workflow.MQTTChannel:
			networkID, err := networkFor(dm, x.Id)
			if err != nil {
				return nil, err
			}
			if nm == nil {
				return nil, fmt.Errorf("channel %s: workflow references MQTT but no NetworkManifest provided", x.Id)
			}
			cfg, ok := nm.MQTTs[networkID]
			if !ok {
				return nil, fmt.Errorf("channel %s: network %q not in deploy NetworkManifest", x.Id, networkID)
			}
			if transports == nil {
				return nil, fmt.Errorf("channel %s: no transport registry", x.Id)
			}
			t, err := transports.MQTT(networkID)
			if err != nil {
				return nil, fmt.Errorf("channel %s: %w", x.Id, err)
			}
			ch.mqtts[x.Id] = &channel.MQTT{
				Transport:       t,
				PublishPrefix:   cfg.PublishPrefix,
				SubscribePrefix: cfg.SubscribePrefix,
			}
		default:
			return nil, fmt.Errorf("channel: unsupported type %T", val)
		}
	}
	return ch, nil
}

// driverFor resolves a hardware channel's driver instance id from the deploy
// mapping. The workflow no longer carries the binding, so a missing entry is a
// deploy misconfiguration, not silent degradation.
func driverFor(dm *engine.DeploymentMapping, channelID string) (string, error) {
	if dm == nil {
		return "", fmt.Errorf("channel %s: no deployment mapping provided", channelID)
	}
	id, ok := dm.Drivers[channelID]
	if !ok || id == "" {
		return "", fmt.Errorf("channel %s: no driver binding in deployment mapping", channelID)
	}
	return id, nil
}

// networkFor resolves an MQTT channel's network id from the deploy mapping.
func networkFor(dm *engine.DeploymentMapping, channelID string) (string, error) {
	if dm == nil {
		return "", fmt.Errorf("channel %s: no deployment mapping provided", channelID)
	}
	id, ok := dm.Networks[channelID]
	if !ok || id == "" {
		return "", fmt.Errorf("channel %s: no network binding in deployment mapping", channelID)
	}
	return id, nil
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

func (ch *channels) mqtt(id string) (*channel.MQTT, error) {
	v, ok := ch.mqtts[id]
	if !ok {
		return nil, fmt.Errorf("no MQTT channel %q", id)
	}
	return v, nil
}
