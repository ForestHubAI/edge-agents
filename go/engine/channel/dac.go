// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package channel

import (
	"github.com/ForestHubAI/edge-agents/go/engine/resource"
)

// DAC is a true analog output channel — sets a real voltage, in contrast
// with PWM which produces a switched square wave. Channels do not need
// per-channel acquisition, so Setup is a no-op.
type DAC struct {
	Driver  resource.DACDriver
	Channel int
}

func (*DAC) Setup() error { return nil }

// Write writes the given voltage (millivolts) to the channel.
func (v *DAC) Write(mV float64) error {
	return v.Driver.WriteAnalog(v.Channel, mV)
}
