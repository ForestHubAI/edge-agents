// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import "fmt"

// MissingFieldError signals a required workflow field was absent at build time.
type MissingFieldError struct {
	NodeID string
	Field  string
}

func (e *MissingFieldError) Error() string {
	return fmt.Sprintf("node %s: required field %q is missing", e.NodeID, e.Field)
}
