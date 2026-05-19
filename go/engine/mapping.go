package engine

import (
	"fh-backend/pkg/api"
	"time"
)

func TickerInterval(value int, unit api.TickerNodeArgumentsIntervalUnit) time.Duration {
	switch unit {
	case api.Seconds:
		return time.Duration(value) * time.Second
	case api.Minutes:
		return time.Duration(value) * time.Minute
	case api.Hours:
		return time.Duration(value) * time.Hour
	default:
		return time.Duration(value) * time.Millisecond
	}
}

// jsonTypeFor maps an engine data type to its JSON Schema type name.
// Shared by nodes that build runtime schemas (Agent response format,
// FunctionCall tool parameters).
func JSONTypeFor(dt api.DataType) string {
	switch dt {
	case api.Int:
		return "integer"
	case api.Float:
		return "number"
	case api.Bool:
		return "boolean"
	default:
		return "string"
	}
}
