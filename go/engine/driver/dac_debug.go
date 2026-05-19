//go:build !linux

package driver

import (
	"fmt"

	"github.com/ForestHubAI/fh-core/go/engine/logging"

	"github.com/rs/zerolog"
)

// Compile-time assertion: debugDAC implements DACDriver.
var _ DACDriver = (*debugDAC)(nil)

// debugDAC is a no-op DACDriver for non-Linux dev hosts. Every write is
// logged and discarded — it exists so the engine builds and runs on
// Windows/macOS with DAC bindings wired, not to drive real silicon.
type debugDAC struct {
	log        zerolog.Logger
	devicePath string
}

// OpenDAC builds an in-memory debug DACDriver for the named device.
// Non-linux only; linux builds get the IIO-backed version in dac_linux.go.
func OpenDAC(devicePath string) (DACDriver, error) {
	if devicePath == "" {
		return nil, fmt.Errorf("dac: device path is required")
	}
	d := &debugDAC{
		devicePath: devicePath,
		log:        logging.Logger.With().Str("driver", "dac-debug").Str("device", devicePath).Logger(),
	}
	d.log.Info().Msg("opened device")
	return d, nil
}

func (d *debugDAC) Close() error {
	d.log.Info().Msg("closing device")
	return nil
}

func (d *debugDAC) WriteAnalog(channel int, mV float64) error {
	d.log.Debug().Int("channel", channel).Float64("mV", mV).Msg("write analog (debug: discarded)")
	return nil
}
