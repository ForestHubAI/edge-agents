package channel

import (
	"bytes"
	"encoding/json"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/ForestHubAI/edge-agents/go/logging"
)

// captureLogger points the package logger at a buffer for the duration of a
// test, restoring the original after.
func captureLogger(t *testing.T, level zerolog.Level) *bytes.Buffer {
	t.Helper()
	var buf bytes.Buffer
	orig := logging.Logger
	logging.Logger = zerolog.New(&buf).Level(level)
	t.Cleanup(func() { logging.Logger = orig })
	return &buf
}

func TestLogWrite_StampsLevelSourceAndTag(t *testing.T) {
	buf := captureLogger(t, zerolog.DebugLevel)

	ch := &Log{Level: zerolog.WarnLevel, Tag: "sensors"}
	require.NoError(t, ch.Write("temp high"))

	var got map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &got))
	assert.Equal(t, "warn", got["level"])
	assert.Equal(t, "workflow", got["source"])
	assert.Equal(t, "sensors", got["tag"])
	assert.Contains(t, buf.String(), "temp high")
}

func TestLogWrite_OmitsEmptyTag(t *testing.T) {
	buf := captureLogger(t, zerolog.DebugLevel)

	ch := &Log{Level: zerolog.InfoLevel}
	require.NoError(t, ch.Write("hello"))

	var got map[string]any
	require.NoError(t, json.Unmarshal(buf.Bytes(), &got))
	_, hasTag := got["tag"]
	assert.False(t, hasTag, "no tag field when Tag is empty")
}

func TestLogWrite_RespectsLoggerLevel(t *testing.T) {
	buf := captureLogger(t, zerolog.WarnLevel)

	ch := &Log{Level: zerolog.InfoLevel} // below the logger's threshold
	require.NoError(t, ch.Write("suppressed"))

	assert.Empty(t, buf.String(), "info write is filtered out by a warn-level logger")
}
