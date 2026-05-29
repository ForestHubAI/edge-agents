package channel

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/engine/driver"
)

// GPIOOutput is a digital output pin.
type GPIOOutput struct {
	Driver driver.GPIODriver
	Line   int
}

func (v *GPIOOutput) Setup() error {
	if err := v.Driver.ConfigureOutput(v.Line); err != nil {
		return fmt.Errorf("gpio output line %d: %w", v.Line, err)
	}
	return nil
}

func (v *GPIOOutput) Write(value bool) error {
	return v.Driver.WriteDigital(v.Line, value)
}
