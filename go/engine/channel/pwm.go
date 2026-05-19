package channel

import (
	"fmt"

	"github.com/ForestHubAI/fh-core/go/engine/driver"
)

// PWM is a PWM output channel.
type PWM struct {
	Driver    driver.PWMDriver
	Channel   int
	Frequency int // Pulse cycles per second (Hz) for this channel
}

func (v *PWM) Setup() error {
	if err := v.Driver.Configure(v.Channel, v.Frequency); err != nil {
		return fmt.Errorf("pwm channel %d: %w", v.Channel, err)
	}
	return nil
}

func (v *PWM) Write(duty float64) error {
	return v.Driver.WriteAnalog(v.Channel, duty)
}
