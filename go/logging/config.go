// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package logging

import (
	"os"

	"github.com/rs/zerolog"
)

// defaultLevel is the stdout floor when Config.Level is unset. Info, not debug:
// stdout is the collected/shipped stream in production, so it stays quiet by
// default; a developer opts into verbosity with LOG_LEVEL=debug.
const defaultLevel = zerolog.InfoLevel

// Config declares how the process logs. Logs always go to stdout as structured
// JSON; the container runtime (Docker) captures that stream for collection.
type Config struct {
	// Level is the minimum zerolog level written to stdout. Empty or unknown
	// falls back to defaultLevel (info).
	Level string `env:"LOG_LEVEL"`
}

// Configure points the package Logger at stdout at cfg.Level. Call once at boot;
// a zero Config keeps the stdout@info default the package inits with.
func Configure(cfg Config) {
	lvl := defaultLevel
	parsed, err := ParseLevel(cfg.Level)
	if err == nil {
		lvl = parsed
	}
	// Warn only on a non-empty bad value; an unset level defaulting is normal.
	if err != nil && cfg.Level != "" {
		Logger.Warn().Err(err).Msg("invalid log level; falling back to info")
	}
	configure(os.Stdout, lvl)
}
