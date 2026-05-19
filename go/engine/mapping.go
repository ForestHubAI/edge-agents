package engine

import (
	"github.com/ForestHubAI/fh-core/go/api/workflow"
	"time"
)

func TickerInterval(value int, unit workflow.TickerNodeArgumentsIntervalUnit) time.Duration {
	switch unit {
	case workflow.Seconds:
		return time.Duration(value) * time.Second
	case workflow.Minutes:
		return time.Duration(value) * time.Minute
	case workflow.Hours:
		return time.Duration(value) * time.Hour
	default:
		return time.Duration(value) * time.Millisecond
	}
}

// jsonTypeFor maps an engine data type to its JSON Schema type name.
// Shared by nodes that build runtime schemas (Agent response format,
// FunctionCall tool parameters).
func JSONTypeFor(dt workflow.DataType) string {
	switch dt {
	case workflow.Int:
		return "integer"
	case workflow.Float:
		return "number"
	case workflow.Bool:
		return "boolean"
	default:
		return "string"
	}
}
