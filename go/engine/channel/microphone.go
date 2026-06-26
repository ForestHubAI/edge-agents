package channel

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/engine/driver"
)

// Microphone is an audio-capture channel wrapping a MicrophoneDriver. SampleRate
// and DurationMs are the capture settings from the channel declaration; a zero
// SampleRate requests the source's native rate.
type Microphone struct {
	Driver     driver.MicrophoneDriver
	SampleRate int
	DurationMs int
}

// Setup is a no-op: the driver is opened by the registry at boot and the
// microphone needs no per-channel wiring.
func (m *Microphone) Setup() error { return nil }

// Capture records one clip at the channel's configured settings.
func (m *Microphone) Capture(ctx context.Context) ([]byte, error) {
	return m.Driver.Capture(ctx, m.SampleRate, m.DurationMs)
}
