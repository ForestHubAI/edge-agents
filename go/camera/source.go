// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package camera is the fh-camera component's domain: per-kind capture
// pipelines, setup-script runner, and the HTTP server implementing the generated
// cameraapi.ServerInterface. cmd/camera wires it to the process (env config,
// signals, http.Server); everything with behavior lives here so it can be tested
// without a running binary.
//
// The component is a driver component: the engine issues it, derives its config
// from the device manifest, and is its only caller. The boot config it reads is a
// contract seam (cameraapi.CameraConfig) — the renderer writes it, this component
// reads it — so its shape is generated, mapped to the domain by ToDomain, and
// never reaches the capture code directly.
package camera

import (
	"context"
	"fmt"
	"strings"
)

// source captures a single encoded frame. Each capture is stateless.
type source interface {
	capture(ctx context.Context, width, height int) ([]byte, error)
}

// Sources is the set of runnable capture sources keyed by device name. The
// element type is unexported, so callers hold and pass the set without being
// able to fabricate a source of their own.
type Sources map[string]source

// BuildSources validates the config and returns a runnable source per camera.
func BuildSources(cfg Config) (Sources, error) {
	sources := make(Sources, len(cfg.Cameras))
	for name, c := range cfg.Cameras {
		src, err := newSource(c)
		if err != nil {
			return nil, fmt.Errorf("camera %q: %w", name, err)
		}
		sources[name] = src
	}
	return sources, nil
}

// newSource turns one camera into a runnable source, validating it. Every kind
// but debug captures through GStreamer and differs only in the element the
// pipeline starts with — choosing that element is this component's job, which is
// why a camera declares a kind rather than a pipeline.
func newSource(c Camera) (source, error) {
	if c.WarmupFrames < 0 {
		return nil, fmt.Errorf("warmupFrames must not be negative")
	}
	switch c.Kind {
	case KindDebug:
		return debugSource{}, nil
	case KindV4L2:
		if strings.TrimSpace(c.Device) == "" {
			return nil, fmt.Errorf("device is required for kind %q", c.Kind)
		}
	case KindRTSP, KindHTTP:
		if strings.TrimSpace(c.URL) == "" {
			return nil, fmt.Errorf("url is required for kind %q", c.Kind)
		}
	case KindRaw:
		if strings.TrimSpace(c.Pipeline) == "" {
			return nil, fmt.Errorf("pipeline is required for kind %q", c.Kind)
		}
	case KindLibcamera:
		// cameraName is optional: omitted means the platform's default sensor.
	default:
		return nil, fmt.Errorf("unknown kind %q", c.Kind)
	}
	return newGStreamerSource(c), nil
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
