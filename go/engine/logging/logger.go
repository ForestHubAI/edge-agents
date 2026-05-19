// Package logging configures the engine's structured logger (zerolog) and
// supplies the HTTP writer that ships log lines to the backend's
// /agents/logs endpoint.
package logging

import (
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

const httpCloseTimeout = 3 * time.Second

// Logger is the engine's package-level logger. Call Configure once
// at boot to wire the writer graph; read it from anywhere in
// the engine layer
var Logger = zerolog.Nop()

// Configure wires the engine's logger. Call once from main before any
// engine code emits. Console (NDJSON to stderr) is always enabled; when
// backendURL is non-empty an httpWriter is fanned in alongside it. The
// returned io.Closer drains in-flight HTTP sends with a bounded timeout
// so Fatal events have a chance to land before os.Exit fires.
func Configure(level zerolog.Level, backendURL, agentKey string) io.Closer {
	zerolog.MessageFieldName = "msg"
	zerolog.TimeFieldFormat = time.RFC3339Nano

	var writer io.Writer = os.Stderr
	var closer io.Closer = nopCloser{} // Default no-op closer for console-only config.
	if backendURL != "" {
		hw := newHTTPWriter(backendURL, agentKey)
		writer = zerolog.MultiLevelWriter(hw, os.Stderr)
		closer = hw
	}

	Logger = zerolog.New(writer).Level(level).With().Timestamp().Logger()
	return closer
}

// ParseLevel parses a case-insensitive level name. Empty input yields
// InfoLevel with no error so the default boot path stays clean.
func ParseLevel(s string) (zerolog.Level, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return zerolog.InfoLevel, nil
	}
	lvl, err := zerolog.ParseLevel(s)
	if err != nil || lvl == zerolog.NoLevel {
		return zerolog.InfoLevel, fmt.Errorf("unknown log level %q", s)
	}
	return lvl, nil
}

// Activity tags an event with the action/summary fields the backend's
// agent_activity ledger keys on. Use as e.Func(logging.Activity(...)).
func Activity(action, summary string) func(*zerolog.Event) {
	return func(e *zerolog.Event) {
		e.Str("action", action).Str("summary", summary)
	}
}

// nopCLoser is a no-op io.Closer for console-only logging configurations.
type nopCloser struct{}

func (nopCloser) Close() error { return nil }
