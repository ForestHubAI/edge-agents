// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package pointer provides helper functions for working with pointers in Go.
package pointer

// Ptr is a helper function to create a pointer to a value
func Ptr[T any](v T) *T {
	return &v
}

// Val is a helper function to create a value from a pointer
func Val[T any](v *T) T {
	if v != nil {
		return *v
	}
	var zero T
	return zero
}
