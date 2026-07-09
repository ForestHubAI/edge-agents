// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"bytes"
	"context"
	"image"
	"image/jpeg"
)

// debugSource returns a fixed 1x1 JPEG without touching hardware — the hostless
// dev/CI path. width/height are ignored.
type debugSource struct{}

// debugJPEG is a valid 1x1 JPEG, encoded once at startup.
var debugJPEG = func() []byte {
	var buf bytes.Buffer
	_ = jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, 1, 1)), nil)
	return buf.Bytes()
}()

func (debugSource) capture(ctx context.Context, width, height int) ([]byte, error) {
	return debugJPEG, nil
}
