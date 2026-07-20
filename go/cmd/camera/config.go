// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/logging"
	"github.com/caarlos0/env/v9"
)

// EnvConfig holds the component's env vars.
// The listen address is deliberately absent: the engine is this driver component's
// sole caller and dials it at a constant address, so the port is contracted
// (component.CameraPort), not configurable.
type EnvConfig struct {
	// Log configures the shared logger's stdout level via LOG_LEVEL.
	Log logging.Config
}

// LoadEnvConfig parses EnvConfig from the process environment.
func LoadEnvConfig() (EnvConfig, error) {
	var cfg EnvConfig
	if err := env.Parse(&cfg); err != nil {
		return cfg, fmt.Errorf("parsing environment: %w", err)
	}
	return cfg, nil
}
