// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package channel

import (
	"context"
)

// cameraDriver is the capture side of driver.CameraDriver. Declared here rather
// than imported so the size hints stay the only thing this channel adds.
type cameraDriver interface {
	Capture(ctx context.Context, width, height int) ([]byte, error)
}

// Camera is a still-capture channel bound to one camera. Width and Height are
// the workflow's capture hints and are per-channel, not per-camera: one camera
// may back several channels that each want their own size, so they travel with
// every call rather than being configured into the driver. Zero means "no hint".
type Camera struct {
	Driver cameraDriver
	Width  int
	Height int
}

func (*Camera) Setup() error { return nil }

// Capture reads one frame. Satisfies engine.CaptureClient, which CameraCapture
// nodes hold.
func (v *Camera) Capture(ctx context.Context) ([]byte, error) {
	return v.Driver.Capture(ctx, v.Width, v.Height)
}
