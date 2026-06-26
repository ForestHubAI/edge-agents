//go:build !linux

package driver

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Off Linux there is no ALSA, so the capture source falls back to the in-memory
// debug driver — a microphone workflow still builds and boots, it just never
// records a real clip.
func openALSA(device string) (MicrophoneDriver, error) { return openDebugMicrophone(device) }

// Compile-time assertion: debugMicrophone implements MicrophoneDriver.
var _ MicrophoneDriver = (*debugMicrophone)(nil)

// debugMicrophone is an in-memory MicrophoneDriver standing in for ALSA. Capture
// logs and returns no clip — a debug build never produces audio data.
type debugMicrophone struct {
	log    zerolog.Logger
	device string
}

func openDebugMicrophone(device string) (MicrophoneDriver, error) {
	if device == "" {
		return nil, fmt.Errorf("microphone: device is required")
	}
	d := &debugMicrophone{
		device: device,
		log: logging.Logger.With().
			Str("driver", "microphone-debug").
			Str("device", device).
			Logger(),
	}
	d.log.Info().Msg("opened microphone")
	return d, nil
}

func (d *debugMicrophone) Capture(ctx context.Context, sampleRate, durationMs int) ([]byte, error) {
	d.log.Info().Int("sampleRate", sampleRate).Int("durationMs", durationMs).Msg("capture (debug: returns no clip)")
	return nil, nil
}

func (d *debugMicrophone) Close() error {
	d.log.Info().Msg("closing microphone")
	return nil
}
