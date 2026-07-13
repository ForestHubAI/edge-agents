// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/ForestHubAI/edge-agents/go/logging"
	"github.com/caarlos0/env/v9"
)

// Config holds the component's boot configuration. All values come from env vars.
type Config struct {
	// Addr is the listen address for the HTTP server. Defaults to the contracted
	// component port (component.CameraPort) when CAMERA_ADDR is unset.
	Addr string `env:"CAMERA_ADDR"`
	// Log configures the shared logger's stdout level via LOG_LEVEL.
	Log logging.Config
}

// LoadConfig parses Config from the process environment.
func LoadConfig() (Config, error) {
	var cfg Config
	if err := env.Parse(&cfg); err != nil {
		return cfg, fmt.Errorf("parsing environment: %w", err)
	}
	if cfg.Addr == "" {
		cfg.Addr = fmt.Sprintf(":%d", component.CameraPort)
	}
	return cfg, nil
}
