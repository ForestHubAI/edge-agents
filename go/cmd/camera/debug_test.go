// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDebugSource_JPEGMagic(t *testing.T) {
	data, err := debugSource{}.capture(context.Background(), 0, 0)
	require.NoError(t, err)
	require.GreaterOrEqual(t, len(data), 2)
	assert.Equal(t, []byte{0xFF, 0xD8}, data[:2])
}
