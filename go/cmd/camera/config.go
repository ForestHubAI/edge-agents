// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"fmt"

	"github.com/caarlos0/env/v9"
)

// Config holds the component's boot configuration. All values come from env vars.
type Config struct {
	// ConfigFile is the path to the cameras.json describing the configured devices.
	ConfigFile string `env:"CAMERA_CONFIG_FILE" envDefault:"/etc/foresthub/cameras.json"`
	// Addr is the listen address for the HTTP server.
	Addr string `env:"CAMERA_ADDR" envDefault:":8100"`
}

// LoadConfig parses Config from the process environment.
func LoadConfig() (Config, error) {
	cfg := Config{}
	if err := env.Parse(&cfg); err != nil {
		return Config{}, fmt.Errorf("parsing environment: %w", err)
	}
	return cfg, nil
}
