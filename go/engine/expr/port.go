package expr

import "github.com/ForestHubAI/fh-core/go/api/workflow"

// VarResolver looks up a variable value by reference. Any type that holds
// variables (engine.Scope or a test double) can satisfy it.
type VarResolver interface {
	Resolve(ref workflow.Reference) (Value, error)
}
