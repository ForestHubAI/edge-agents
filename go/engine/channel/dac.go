package channel

import (
	"github.com/ForestHubAI/fh-core/go/engine/driver"
)

// DAC is a true analog output channel — sets a real voltage, in contrast
// with PWM which produces a switched square wave. Channels do not need
// per-channel acquisition, so Setup is a no-op.
type DAC struct {
	Driver  driver.DACDriver
	Channel int
}

func (*DAC) Setup() error { return nil }

// Write writes the given voltage (millivolts) to the channel.
func (v *DAC) Write(mV float64) error {
	return v.Driver.WriteAnalog(v.Channel, mV)
}
