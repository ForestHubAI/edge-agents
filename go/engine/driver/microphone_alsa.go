//go:build linux

package driver

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strconv"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Compile-time assertion: alsaMicrophone implements MicrophoneDriver.
var _ MicrophoneDriver = (*alsaMicrophone)(nil)

func openALSA(device string) (MicrophoneDriver, error) {
	if device == "" {
		return nil, fmt.Errorf("microphone: device is required")
	}
	return &alsaMicrophone{
		device: device,
		log: logging.Logger.With().
			Str("driver", "microphone-alsa").
			Str("device", device).
			Logger(),
	}, nil
}

// alsaMicrophone records clips by running a one-shot `arecord` per capture and
// reading the encoded WAV off its stdout. Capture is stateless — every clip
// spawns and tears down its own process, which fits push-to-talk recording.
// Format is fixed to 16-bit mono (S16_LE), a sane default for speech.
type alsaMicrophone struct {
	log    zerolog.Logger
	device string
}

func (m *alsaMicrophone) Capture(ctx context.Context, sampleRate, durationMs int) ([]byte, error) {
	// arecord's -d is whole seconds; round to the nearest second (min 1). A
	// pure-ALSA driver could honor the millisecond duration exactly.
	seconds := (durationMs + 500) / 1000
	if seconds < 1 {
		seconds = 1
	}

	// -q keeps arecord's progress chatter off stderr; with no filename it writes
	// the WAV stream to stdout.
	args := []string{"-q", "-D", m.device, "-f", "S16_LE", "-c", "1", "-t", "wav", "-d", strconv.Itoa(seconds)}
	if sampleRate > 0 {
		args = append(args, "-r", strconv.Itoa(sampleRate))
	}

	cmd := exec.CommandContext(ctx, "arecord", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	m.log.Info().Int("sampleRate", sampleRate).Int("seconds", seconds).Msg("recording clip")
	if err := cmd.Run(); err != nil {
		return nil, fmt.Errorf("arecord: %w (%s)", err, strings.TrimSpace(stderr.String()))
	}
	if stdout.Len() == 0 {
		return nil, fmt.Errorf("arecord produced no data")
	}
	return stdout.Bytes(), nil
}

func (m *alsaMicrophone) Close() error { return nil }
