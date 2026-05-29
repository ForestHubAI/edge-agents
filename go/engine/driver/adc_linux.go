//go:build linux

package driver

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/logging"

	"github.com/rs/zerolog"
)

// Compile-time assertion: linuxADC implements ADCDriver.
var _ ADCDriver = (*linuxADC)(nil)

// linuxADC is a sysfs-backed ADCDriver using the kernel's IIO subsystem.
// One instance owns one IIO device directory (e.g. /sys/bus/iio/devices/
// iio:device0). Channels are read on demand — IIO has no per-channel
// acquisition step, just three sysfs files per sample.
type linuxADC struct {
	log       zerolog.Logger
	deviceDir string
}

// OpenADC opens the IIO device at devicePath (a sysfs directory). The path
// must exist and be a directory; the device's name file is read for logging
// but not required.
func OpenADC(devicePath string) (ADCDriver, error) {
	if devicePath == "" {
		return nil, fmt.Errorf("adc: device path is required")
	}
	info, err := os.Stat(devicePath)
	if err != nil {
		return nil, fmt.Errorf("open adc %s: %w", devicePath, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("open adc %s: not a directory", devicePath)
	}
	name := readSysfsString(filepath.Join(devicePath, "name"))
	d := &linuxADC{
		deviceDir: devicePath,
		log: logging.Logger.With().
			Str("driver", "adc").
			Str("device", devicePath).
			Str("name", name).
			Logger(),
	}
	d.log.Info().Msg("opened device")
	return d, nil
}

// Close is a no-op: sysfs has no file handles to release. Kept so linuxADC
// satisfies the Driver interface.
func (d *linuxADC) Close() error {
	d.log.Info().Msg("closed device")
	return nil
}

// ReadAnalog returns the channel reading in millivolts using the IIO ABI
// convention: value_mV = (raw + offset) * scale. Missing scale/offset files
// fall back to 1.0 and 0.0 — chips without per-channel calibration files
// then return raw counts unchanged.
func (d *linuxADC) ReadAnalog(channel int) (float64, error) {
	raw, err := readSysfsFloat(filepath.Join(d.deviceDir, fmt.Sprintf("in_voltage%d_raw", channel)))
	if err != nil {
		return 0, fmt.Errorf("read adc channel %d raw: %w", channel, err)
	}
	scale, err := readSysfsFloat(filepath.Join(d.deviceDir, fmt.Sprintf("in_voltage%d_scale", channel)))
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return 0, fmt.Errorf("read adc channel %d scale: %w", channel, err)
		}
		scale = 1
	}
	offset, err := readSysfsFloat(filepath.Join(d.deviceDir, fmt.Sprintf("in_voltage%d_offset", channel)))
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return 0, fmt.Errorf("read adc channel %d offset: %w", channel, err)
		}
		offset = 0
	}
	return (raw + offset) * scale, nil
}

func readSysfsString(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func readSysfsFloat(path string) (float64, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return 0, err
	}
	return strconv.ParseFloat(strings.TrimSpace(string(b)), 64)
}
