package channel

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/engine/driver"
)

// GPIOInput is a digital input pin channel.
type GPIOInput struct {
	Broadcaster[bool]
	Driver     driver.GPIODriver
	Line       int
	Bias       driver.Bias
	DebounceMs int // Debounce time in milliseconds; 0 for no debounce
}

// Setup configures the line in one call. With no subscribers registered
// the event handler is left nil and cdev allocates no event buffer for
// the pin. Otherwise broadcast is wired in as the cdev handler.
func (v *GPIOInput) Setup() error {
	var onEvent func(bool)
	if v.hasSubscribers() {
		onEvent = v.broadcast
	}
	if err := v.Driver.ConfigureInput(v.Line, v.Bias, v.DebounceMs, onEvent); err != nil {
		return fmt.Errorf("gpio input line %d: %w", v.Line, err)
	}
	return nil
}

// Read samples the pin's current digital level synchronously.
func (v *GPIOInput) Read() (bool, error) {
	return v.Driver.ReadDigital(v.Line)
}
