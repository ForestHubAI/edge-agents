package channel

import (
	"github.com/ForestHubAI/edge-agents/go/engine/driver"
)

// ADC is an analog input channel.
type ADC struct {
	Driver  driver.ADCDriver
	Channel int
}

func (*ADC) Setup() error { return nil }

func (v *ADC) Read() (float64, error) {
	return v.Driver.ReadAnalog(v.Channel)
}
