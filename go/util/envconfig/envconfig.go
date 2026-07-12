// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package envconfig parses a component's boot config struct from the process
// environment. Each component keeps its own Config type and `env:` struct tags
// and wraps Load in its own LoadConfig; only the env.Parse call lives here.
package envconfig

import (
	"fmt"

	"github.com/caarlos0/env/v9"
)

// Load parses T from the process environment. Fatal-vs-retryable handling is the
// caller's, in main — Load only reports the parse error.
func Load[T any]() (T, error) {
	var cfg T
	if err := env.Parse(&cfg); err != nil {
		return cfg, fmt.Errorf("parsing environment: %w", err)
	}
	return cfg, nil
}
