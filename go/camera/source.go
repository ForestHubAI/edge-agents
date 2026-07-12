// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package camera is the fh-camera component's domain: per-source capture
// pipelines, setup-script runner, and the HTTP server implementing the generated
// cameraapi.ServerInterface. cmd/camera wires it to the process (env config,
// signals, http.Server); everything with behavior lives here so it can be tested
// without a running binary. The cameras.json config it reads is a contract seam
// (cameraapi.CameraComponentConfig) — the renderer writes it, this component
// reads it — so its shape is generated, not hand-written here.
package camera

import (
	"context"
	"fmt"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
)

// Capture source kinds. v4l2 and gstreamer both capture through GStreamer and
// differ only in how the device becomes the pipeline source; debug needs no
// hardware and returns a fixed frame.
const (
	sourceV4L2      = "v4l2"
	sourceGStreamer = "gstreamer"
	sourceDebug     = "debug"
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
func BuildSources(cfg cameraapi.CameraConfig) (Sources, error) {
	sources := make(Sources, len(cfg.Cameras))
	for name, cc := range cfg.Cameras {
		src, err := newSource(cc)
		if err != nil {
			return nil, fmt.Errorf("camera %q: %w", name, err)
		}
		sources[name] = src
	}
	return sources, nil
}

// newSource turns one camera config entry into a runnable source, validating it.
func newSource(cc cameraapi.CameraSource) (source, error) {
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
