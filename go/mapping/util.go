// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package mapping

// Slice maps a slice of type A to a slice of type B, passing pointers to mappingFunc
func Slice[A any, B any](input []A, mappingFunc func(*A) B) []B {
	output := make([]B, len(input))
	for i := range input {
		output[i] = mappingFunc(&input[i])
	}
	return output
}

// SliceErr maps a slice of type A to a slice of type B, allowing for error handling, passing pointers to mappingFunc
func SliceErr[A any, B any](input []A, mappingFunc func(*A) (B, error)) ([]B, error) {
	output := make([]B, len(input))
	for i := range input {
		mapped, err := mappingFunc(&input[i])
		if err != nil {
			return nil, err
		}
		output[i] = mapped
	}
	return output, nil
}
