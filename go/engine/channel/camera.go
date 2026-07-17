// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package channel

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/engine/driver"
)

// Camera is a still-capture channel bound to one camera. It adds nothing of its
// own: a camera takes no sub-address and no setup config, so the channel is the
// binding and nothing else. Capture size is a node argument — the same camera is
// the same camera at any resolution, so a size names no camera.
type Camera struct {
	Driver driver.CameraDriver
}

// Setup is a no-op: a camera is configured by its manifest entry, not per channel.
func (*Camera) Setup() error { return nil }

// Capture reads one frame at the caller's size. Satisfies engine.CaptureClient,
// which CameraCapture nodes hold.
func (v *Camera) Capture(ctx context.Context, width, height int) ([]byte, error) {
	return v.Driver.Capture(ctx, width, height)
}
