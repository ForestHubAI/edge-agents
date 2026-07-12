// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package component

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// contractConstants mirrors contract/component-constants.json — the language-neutral
// source of truth these Go constants must equal. Every language keeps its own native
// constants; this test (and its TS/Python twins) is the drift guard that keeps them
// aligned to the one JSON.
type contractConstants struct {
	Paths struct {
		ConfigFile  string `json:"configFile"`
		SecretsFile string `json:"secretsFile"`
		Workspace   string `json:"workspace"`
	} `json:"paths"`
	ExitCodes struct {
		BadConfig int `json:"badConfig"`
	} `json:"exitCodes"`
	Components struct {
		Engine      string `json:"engine"`
		Llama       string `json:"llama"`
		Camera      string `json:"camera"`
		MLInference string `json:"mlInference"`
	} `json:"components"`
}

// TestConstantsMatchContract fails when these Go constants drift from the
// cross-language contract. Editing one side without the other turns this red.
func TestConstantsMatchContract(t *testing.T) {
	path := filepath.Join("..", "..", "contract", "component-constants.json")
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading %s: %v", path, err)
	}
	var c contractConstants
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("parsing %s: %v", path, err)
	}

	cases := []struct {
		name      string
		got, want any
	}{
		{"ConfigFile", ConfigFile, c.Paths.ConfigFile},
		{"SecretsFile", SecretsFile, c.Paths.SecretsFile},
		{"Workspace", Workspace, c.Paths.Workspace},
		{"ExitConfigError", ExitConfigError, c.ExitCodes.BadConfig},
		{"Engine", Engine, c.Components.Engine},
		{"Llama", Llama, c.Components.Llama},
		{"Camera", Camera, c.Components.Camera},
		{"MLInference", MLInference, c.Components.MLInference},
	}
	for _, tc := range cases {
		if tc.got != tc.want {
			t.Errorf("%s drift: Go has %v, contract has %v", tc.name, tc.got, tc.want)
		}
	}
}
