//go:build linux

package driver

import (
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"

	"github.com/ForestHubAI/fh-core/go/logging"

	"github.com/rs/zerolog"
)

// Compile-time assertion: linuxDAC implements DACDriver.
var _ DACDriver = (*linuxDAC)(nil)

// linuxDAC is a sysfs-backed DACDriver using the kernel's IIO subsystem.
// One instance owns one IIO device directory (e.g. /sys/bus/iio/devices/
// iio:device1). Channels are written on demand — same model as
// linuxADC, just outbound instead of inbound.
type linuxDAC struct {
	log       zerolog.Logger
	deviceDir string
}

// OpenDAC opens the IIO device at devicePath (a sysfs directory). The path
// must exist and be a directory; the device's name file is read for
// logging but not required.
func OpenDAC(devicePath string) (DACDriver, error) {
	if devicePath == "" {
		return nil, fmt.Errorf("dac: device path is required")
	}
	info, err := os.Stat(devicePath)
	if err != nil {
		return nil, fmt.Errorf("open dac %s: %w", devicePath, err)
	}
	if !info.IsDir() {
		return nil, fmt.Errorf("open dac %s: not a directory", devicePath)
	}
	name := readSysfsString(filepath.Join(devicePath, "name"))
	d := &linuxDAC{
		deviceDir: devicePath,
		log: logging.Logger.With().
			Str("driver", "dac").
			Str("device", devicePath).
			Str("name", name).
			Logger(),
	}
	d.log.Info().Msg("opened device")
	return d, nil
}

// Close is a no-op: sysfs has no file handles to release.
func (d *linuxDAC) Close() error {
	d.log.Info().Msg("closed device")
	return nil
}

// WriteAnalog writes the given millivolt value to the channel using the
// IIO ABI convention: raw = (mV / scale) - offset. Missing scale/offset
// files fall back to 1.0 and 0.0 — chips without per-channel calibration
// then take raw counts directly.
func (d *linuxDAC) WriteAnalog(channel int, mV float64) error {
	scale, err := readSysfsFloat(filepath.Join(d.deviceDir, fmt.Sprintf("out_voltage%d_scale", channel)))
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("read dac channel %d scale: %w", channel, err)
		}
		scale = 1
	}
	offset, err := readSysfsFloat(filepath.Join(d.deviceDir, fmt.Sprintf("out_voltage%d_offset", channel)))
	if err != nil {
		if !errors.Is(err, fs.ErrNotExist) {
			return fmt.Errorf("read dac channel %d offset: %w", channel, err)
		}
		offset = 0
	}
	if scale == 0 {
		return fmt.Errorf("dac channel %d: scale is zero", channel)
	}
	raw := int64(mV/scale - offset)
	path := filepath.Join(d.deviceDir, fmt.Sprintf("out_voltage%d_raw", channel))
	if err := os.WriteFile(path, []byte(strconv.FormatInt(raw, 10)), 0644); err != nil {
		return fmt.Errorf("write dac channel %d raw: %w", channel, err)
	}
	return nil
}
