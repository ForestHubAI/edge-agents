package trigger

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseHHMM(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		wantH   int
		wantM   int
		wantErr bool
	}{
		{"valid morning", "06:30", 6, 30, false},
		{"midnight", "00:00", 0, 0, false},
		{"end of day", "23:59", 23, 59, false},
		{"missing colon", "0630", 0, 0, true},
		{"non-numeric hour", "ab:30", 0, 0, true},
		{"non-numeric minute", "06:cd", 0, 0, true},
		{"hour too large", "24:00", 0, 0, true},
		{"negative", "-1:00", 0, 0, true},
		{"minute too large", "06:60", 0, 0, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, m, err := parseHHMM(tt.in)
			if tt.wantErr {
				require.Error(t, err)
				return
			}
			require.NoError(t, err)
			assert.Equal(t, tt.wantH, h)
			assert.Equal(t, tt.wantM, m)
		})
	}
}

func TestParseDays(t *testing.T) {
	t.Run("empty list returns nil (every day)", func(t *testing.T) {
		out, err := parseDays(nil)
		require.NoError(t, err)
		assert.Nil(t, out)
	})

	t.Run("recognises all weekday abbreviations regardless of case", func(t *testing.T) {
		out, err := parseDays([]string{"Mon", "TUE", "wed", "thu", "fri", "sat", "sun"})
		require.NoError(t, err)
		assert.Equal(t,
			[]time.Weekday{time.Monday, time.Tuesday, time.Wednesday, time.Thursday, time.Friday, time.Saturday, time.Sunday},
			out,
		)
	})

	t.Run("rejects unknown day", func(t *testing.T) {
		_, err := parseDays([]string{"funday"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "funday")
	})
}

func TestNewAlarm(t *testing.T) {
	t.Run("constructs valid alarm", func(t *testing.T) {
		a, err := NewAlarm("a1", "07:30", []string{"mon", "fri"})
		require.NoError(t, err)
		assert.Equal(t, 7, a.Hour)
		assert.Equal(t, 30, a.Minute)
		assert.Equal(t, []time.Weekday{time.Monday, time.Friday}, a.Days)
	})

	t.Run("invalid time string is reported with alarm id", func(t *testing.T) {
		_, err := NewAlarm("a1", "bogus", nil)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "alarm a1")
	})

	t.Run("invalid days list is reported with alarm id", func(t *testing.T) {
		_, err := NewAlarm("a1", "06:00", []string{"funday"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "alarm a1")
	})
}

func TestAlarm_NextDelay(t *testing.T) {
	// Anchor "now" to a specific weekday/time so cases are deterministic.
	loc := time.UTC
	monday12 := time.Date(2026, time.January, 5, 12, 0, 0, 0, loc) // Monday

	t.Run("daily alarm in the future fires today", func(t *testing.T) {
		a, err := NewAlarm("a", "13:30", nil)
		require.NoError(t, err)
		got := a.nextDelay(monday12)
		assert.Equal(t, 90*time.Minute, got)
	})

	t.Run("daily alarm at past time rolls to tomorrow", func(t *testing.T) {
		a, err := NewAlarm("a", "10:00", nil)
		require.NoError(t, err)
		got := a.nextDelay(monday12)
		// Tomorrow 10:00 = +22h from 12:00 today
		assert.Equal(t, 22*time.Hour, got)
	})

	t.Run("alarm at exactly now rolls to tomorrow (uses After, not Equal)", func(t *testing.T) {
		a, err := NewAlarm("a", "12:00", nil)
		require.NoError(t, err)
		got := a.nextDelay(monday12)
		assert.Equal(t, 24*time.Hour, got)
	})

	t.Run("weekday-restricted alarm skips non-matching days", func(t *testing.T) {
		// Only Friday → from Monday 12:00, next Friday 09:00 is +3 days +21h.
		a, err := NewAlarm("a", "09:00", []string{"fri"})
		require.NoError(t, err)
		got := a.nextDelay(monday12)
		want := time.Date(2026, time.January, 9, 9, 0, 0, 0, loc).Sub(monday12)
		assert.Equal(t, want, got)
	})

	t.Run("weekday match later today fires today", func(t *testing.T) {
		// Mondays at 13:30, called Monday 12:00 → +90m (today).
		a, err := NewAlarm("a", "13:30", []string{"mon"})
		require.NoError(t, err)
		got := a.nextDelay(monday12)
		assert.Equal(t, 90*time.Minute, got)
	})

	t.Run("weekday match earlier today rolls a full week", func(t *testing.T) {
		// Mondays at 09:00, called Monday 12:00 → next Monday at 09:00.
		a, err := NewAlarm("a", "09:00", []string{"mon"})
		require.NoError(t, err)
		got := a.nextDelay(monday12)
		want := time.Date(2026, time.January, 12, 9, 0, 0, 0, loc).Sub(monday12)
		assert.Equal(t, want, got)
	})
}
