package engine

import (
	"testing"
	"time"

	"fh-backend/pkg/api"

	"github.com/stretchr/testify/assert"
)

func TestTickerInterval(t *testing.T) {
	tests := []struct {
		name  string
		value int
		unit  api.TickerNodeArgumentsIntervalUnit
		want  time.Duration
	}{
		{"seconds", 5, api.Seconds, 5 * time.Second},
		{"minutes", 2, api.Minutes, 2 * time.Minute},
		{"hours", 1, api.Hours, time.Hour},
		{"milliseconds (explicit)", 500, api.Milliseconds, 500 * time.Millisecond},
		{"unknown unit defaults to milliseconds", 250, "fortnights", 250 * time.Millisecond},
		{"zero value", 0, api.Seconds, 0},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, TickerInterval(tt.value, tt.unit))
		})
	}
}

func TestJSONTypeFor(t *testing.T) {
	tests := []struct {
		dt   api.DataType
		want string
	}{
		{api.Int, "integer"},
		{api.Float, "number"},
		{api.Bool, "boolean"},
		{api.String, "string"},
		{api.DataType("unknown"), "string"}, // default fallback
	}
	for _, tt := range tests {
		t.Run(string(tt.dt), func(t *testing.T) {
			assert.Equal(t, tt.want, JSONTypeFor(tt.dt))
		})
	}
}
