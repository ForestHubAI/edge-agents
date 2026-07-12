// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package camera is the fh-camera component's domain: the cameras.json config
// model, per-source capture pipelines, setup-script runner, and the HTTP server
// implementing the generated cameraapi.ServerInterface. cmd/camera wires it to
// the process (env config, signals, http.Server); everything with behavior
// lives here so it can be tested without a running binary.
package camera

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// Capture source kinds. v4l2 and gstreamer both capture through GStreamer and
// differ only in how the device becomes the pipeline source; debug needs no
// hardware and returns a fixed frame.
const (
	sourceV4L2      = "v4l2"
	sourceGStreamer = "gstreamer"
	sourceDebug     = "debug"
)

// cameraConfig is one entry in cameras.json. device is a /dev path for v4l2 or a
// GStreamer source fragment for gstreamer; it is unused for debug. warmupFrames
// discards that many leading frames so auto-exposure can settle (default 0).
// setup lists shell commands run at every container start, before serving.
type cameraConfig struct {
	Source       string   `json:"source"`
	Device       string   `json:"device"`
	WarmupFrames int      `json:"warmupFrames,omitempty"`
	Setup        []string `json:"setup,omitempty"`
}

// File is the on-disk cameras.json shape: named devices keyed by name. It is
// constructed only by ReadConfig; cmd/camera threads it from there into
// BuildSources and RunSetup.
type File struct {
	Cameras map[string]cameraConfig `json:"cameras"`
}

// source captures a single encoded frame. Each capture is stateless.
type source interface {
	capture(ctx context.Context, width, height int) ([]byte, error)
}

// Sources is the set of runnable capture sources keyed by device name. The
// element type is unexported, so callers hold and pass the set without being
// able to fabricate a source of their own.
type Sources map[string]source

// ReadConfig reads and parses cameras.json. It fails fast on an empty or
// unparseable config.
func ReadConfig(path string) (File, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return File{}, fmt.Errorf("reading config file: %w", err)
	}
	var file File
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&file); err != nil {
		return File{}, fmt.Errorf("parsing config file: %w", err)
	}
	if len(file.Cameras) == 0 {
		return File{}, fmt.Errorf("no cameras configured")
	}
	return file, nil
}

// BuildSources validates the config and returns a runnable source per camera.
func BuildSources(file File) (Sources, error) {
	sources := make(Sources, len(file.Cameras))
	for name, cc := range file.Cameras {
		src, err := newSource(cc)
		if err != nil {
			return nil, fmt.Errorf("camera %q: %w", name, err)
		}
		sources[name] = src
	}
	return sources, nil
}

// newSource turns one camera config entry into a runnable source, validating it.
func newSource(cc cameraConfig) (source, error) {
	switch cc.Source {
	case sourceV4L2, sourceGStreamer:
		if strings.TrimSpace(cc.Device) == "" {
			return nil, fmt.Errorf("device is required for source %q", cc.Source)
		}
		if cc.WarmupFrames < 0 {
			return nil, fmt.Errorf("warmupFrames must not be negative")
		}
		return newGStreamerSource(cc), nil
	case sourceDebug:
		if len(cc.Setup) > 0 {
			return nil, fmt.Errorf("setup commands are not supported for source %q", cc.Source)
		}
		return debugSource{}, nil
	default:
		return nil, fmt.Errorf("unknown source %q", cc.Source)
	}
}

// RequiresGStreamer reports whether any configured camera needs gst-launch-1.0,
// so cmd/camera can fail fast at boot when the toolchain is missing.
func (s Sources) RequiresGStreamer() bool {
	for _, src := range s {
		if _, ok := src.(*gstreamerSource); ok {
			return true
		}
	}
	return false
}
