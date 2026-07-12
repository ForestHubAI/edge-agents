// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"github.com/ForestHubAI/edge-agents/go/logging"
	"github.com/ForestHubAI/edge-agents/go/util/envconfig"
)

// Config holds the component's boot configuration. All values come from env vars.
type Config struct {
	// Addr is the listen address for the HTTP server.
	Addr string `env:"CAMERA_ADDR" envDefault:":8100"`
	// Log configures the shared logger's stdout level via LOG_LEVEL.
	Log logging.Config
}

// LoadConfig parses Config from the process environment.
func LoadConfig() (Config, error) {
	return envconfig.Load[Config]()
}
