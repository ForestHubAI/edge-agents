package expr

import "fh-backend/pkg/api"

// VarResolver looks up a variable value by reference. Any type that holds
// variables (engine.Scope or a test double) can satisfy it.
type VarResolver interface {
	Resolve(ref api.Reference) (Value, error)
}
