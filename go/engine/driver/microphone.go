package driver

import "fmt"

// MicrophoneSource names the capture implementation selected per microphone in
// the device manifest.
type MicrophoneSource string

const (
	MicrophoneSourceALSA MicrophoneSource = "alsa"
)

// OpenMicrophone opens the microphone at device using the named source. The
// concrete source is Linux-only (ALSA capture via arecord); off Linux it
// resolves to an in-memory debug driver, so a microphone workflow builds and
// boots on any host. An unknown source is a manifest error.
func OpenMicrophone(source MicrophoneSource, device string) (MicrophoneDriver, error) {
	switch source {
	case MicrophoneSourceALSA:
		return openALSA(device)
	default:
		return nil, fmt.Errorf("microphone: unknown source %q", source)
	}
}
