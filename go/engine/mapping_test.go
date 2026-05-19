package engine

import (
	"testing"
	"time"

	"github.com/ForestHubAI/fh-core/go/api/workflow"

	"github.com/stretchr/testify/assert"
)

func TestTickerInterval(t *testing.T) {
	tests := []struct {
		name  string
		value int
		unit  workflow.TickerNodeArgumentsIntervalUnit
		want  time.Duration
	}{
		{"seconds", 5, workflow.Seconds, 5 * time.Second},
		{"minutes", 2, workflow.Minutes, 2 * time.Minute},
		{"hours", 1, workflow.Hours, time.Hour},
		{"milliseconds (explicit)", 500, workflow.Milliseconds, 500 * time.Millisecond},
		{"unknown unit defaults to milliseconds", 250, "fortnights", 250 * time.Millisecond},
		{"zero value", 0, workflow.Seconds, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, TickerInterval(tt.value, tt.unit))
		})
	}
}

func TestJSONTypeFor(t *testing.T) {
	tests := []struct {
		dt   workflow.DataType
		want string
	}{
		{workflow.Int, "integer"},
		{workflow.Float, "number"},
		{workflow.Bool, "boolean"},
		{workflow.String, "string"},
		{workflow.DataType("unknown"), "string"}, // default fallback
	}
	for _, tt := range tests {
		t.Run(string(tt.dt), func(t *testing.T) {
			assert.Equal(t, tt.want, JSONTypeFor(tt.dt))
		})
	}
}
