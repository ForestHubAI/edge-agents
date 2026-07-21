// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package channel

import (
	"github.com/ForestHubAI/edge-agents/go/engine/resource"
)

// ADC is an analog input channel.
type ADC struct {
	Driver  resource.ADCDriver
	Channel int
}

func (*ADC) Setup() error { return nil }

func (v *ADC) Read() (float64, error) {
	return v.Driver.ReadAnalog(v.Channel)
}
