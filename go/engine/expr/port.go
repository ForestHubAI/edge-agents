// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package expr

import "github.com/ForestHubAI/edge-agents/go/api/workflow"

// VarResolver looks up a variable value by reference. Any type that holds
// variables (engine.Scope or a test double) can satisfy it.
type VarResolver interface {
	Resolve(ref workflow.Reference) (Value, error)
}
