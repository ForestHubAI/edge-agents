// Package provider contains common constants for LLM providers
package provider

import "errors"

var (
	// ErrIncompleteResponse indicates that the response from the LLM is incomplete
	ErrIncompleteResponse = errors.New("response is incomplete")

	// ErrNotSupported is used to indicate non-supported features
	ErrNotSupported = errors.New("not supported")
)
