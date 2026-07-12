// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package logging

import (
	"os"

	"github.com/rs/zerolog"
)

// defaultConsoleLevel is the floor for stdout when Config.Level is unset: the
// local console is the verbose sink a developer reads live.
const defaultConsoleLevel = zerolog.DebugLevel

// Config declares how the process logs. Logs always go to stdout as structured
// JSON; the container runtime (Docker) captures that stream for collection.
type Config struct {
	// Level is the minimum zerolog level written to stdout. Empty or unknown
	// falls back to defaultConsoleLevel (debug), the local verbose default.
	Level string `env:"LOG_LEVEL"`
}

// Configure points the package Logger at stdout at cfg.Level. Call once at boot;
// a zero Config keeps the stdout@debug default the package inits with.
func Configure(cfg Config) {
	lvl := defaultConsoleLevel
	parsed, err := ParseLevel(cfg.Level)
	if err == nil {
		lvl = parsed
	}
	// Warn only on a non-empty bad value; an unset level defaulting is normal.
	if err != nil && cfg.Level != "" {
		Logger.Warn().Err(err).Msg("invalid log level; falling back to debug")
	}
	configure(os.Stdout, lvl)
}
