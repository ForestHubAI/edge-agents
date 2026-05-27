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
