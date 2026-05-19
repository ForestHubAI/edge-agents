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
