// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build linux

package driver

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestLinuxPWM_ConfigureRejectsSecondClaim(t *testing.T) {
	// Two PWM channels on one (chip, channel) both Configure at Setup. Overwriting
	// the period would silently apply the second's frequency; Configure errors on
	// the second instead. The reject path returns before any sysfs write.
	d := &linuxPWM{channels: map[int]*pwmChannel{2: {periodNs: 1000}}}

	err := d.Configure(2, 1000)

	require.Error(t, err)
	assert.Contains(t, err.Error(), "already configured")
}
