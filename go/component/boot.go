// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package component

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"github.com/ForestHubAI/edge-agents/go/logging"
)

// BootFail ends a PERMANENT boot failure caused by a malformed config, so
// a restart fails identically. It exits ExitConfigError (78) so
// the orchestrator marks the deployment failed instead of retrying.
func BootFail(cause error, msg string) {
	logging.FatalExit(ExitConfigError, cause, msg)
}

// BootRetry ends a TRANSIENT boot failure: the cause may clear on a later start,
// so it exits nonzero (1) and the orchestrator may restart the
// container; the healthcheck/startup backstop catches one that never recovers.
func BootRetry(cause error, msg string) {
	logging.FatalExit(1, cause, msg)
}

// LoadConfig reads and parses a component's boot config into T.
// A missing or malformed file is an error: a component with no config cannot
// serve, and a restart fails identically, so every caller treats it as permanent.
func LoadConfig[T any]() (T, error) {
	var cfg T
	data, err := os.ReadFile(ConfigFile)
	if err != nil {
		return cfg, fmt.Errorf("reading %s: %w", ConfigFile, err)
	}
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cfg, fmt.Errorf("parsing %s: %w", ConfigFile, err)
	}
	return cfg, nil
}

// Secrets is a flat map of secret id -> opaque secret value
type Secrets map[string]string

// ReadSecrets reads and parses a component's secret store from the canonical path.
func ReadSecrets() (Secrets, error) {
	data, err := os.ReadFile(SecretsFile)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var secrets Secrets
	if err := json.Unmarshal(data, &secrets); err != nil {
		return nil, err
	}
	return secrets, nil
}
