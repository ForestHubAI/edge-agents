// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package driver

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGenericSerial_WatchReadRejectsSecondCallback(t *testing.T) {
	// Two UART channels on one port both install a line callback at Setup.
	// Replacing the first would silently mute its subscribers; WatchRead errors
	// on the second instead. The reject path touches no hardware.
	d := &genericSerial{port: "/dev/ttyX", onLine: func(string) {}}

	err := d.WatchRead(func(string) {})

	require.Error(t, err)
	assert.Contains(t, err.Error(), "already installed")
}
