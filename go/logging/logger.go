// Package logging configures a structured zerolog logger shared by any
// component (engine, ranger, …). Configure wires the sinks declared by a
// Config — stdout always, plus an opt-in rotating file and an opt-in HTTP
// shipper — and returns an io.Closer that drains them at shutdown.
package logging

import (
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

// Logger is the package-level logger any component
// shares. Call Configure once at boot to wire the writer graph; read it
// from anywhere thereafter.
var Logger = zerolog.Nop()

// sink pairs a writer with the minimum level it accepts. Configure (config.go)
// builds one per enabled sink and hands them to wire.
type sink struct {
	level  zerolog.Level
	writer io.Writer
}

// wire fans the sinks into the package Logger. Each sink is wrapped in a
// zerolog.FilteredLevelWriter at its own level, so one log line fans to every
// sink and each drops what falls below its floor. The Logger's own level is the
// most permissive floor across the sinks — events below it reach no sink, so
// zerolog discards them before any writer runs. An empty list discards. The
// returned io.Closer aggregates Close() over every writer that implements
// io.Closer. Configure (config.go) is the public entry.
func wire(sinks ...sink) io.Closer {
	zerolog.MessageFieldName = "msg"
	zerolog.TimeFieldFormat = time.RFC3339Nano

	if len(sinks) == 0 {
		Logger = zerolog.New(io.Discard).Level(zerolog.Disabled).With().Timestamp().Logger()
		return nopCloser{}
	}

	floor := zerolog.Disabled
	writers := make([]io.Writer, len(sinks))
	for i, s := range sinks {
		if s.level < floor {
			floor = s.level
		}
		writers[i] = &zerolog.FilteredLevelWriter{Writer: levelWriter(s.writer), Level: s.level}
	}

	var writer io.Writer
	if len(writers) == 1 {
		writer = writers[0]
	} else {
		writer = zerolog.MultiLevelWriter(writers...)
	}
	Logger = zerolog.New(writer).Level(floor).With().Timestamp().Logger()

	var closers multiCloser
	for _, s := range sinks {
		if c, ok := s.writer.(io.Closer); ok {
			closers = append(closers, c)
		}
	}
	if len(closers) == 0 {
		return nopCloser{}
	}
	return closers
}

// levelWriter adapts a plain io.Writer to zerolog.LevelWriter so a
// FilteredLevelWriter can gate it. A writer that already carries WriteLevel
// (e.g. HTTPWriter, whose Fatal path is synchronous) is used as-is, preserving
// that behavior through the filter.
func levelWriter(w io.Writer) zerolog.LevelWriter {
	if lw, ok := w.(zerolog.LevelWriter); ok {
		return lw
	}
	return zerolog.LevelWriterAdapter{Writer: w}
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

// resolveLevel parses a per-sink level name, falling back to def on empty input
// and reporting an error — while still returning def — on an unknown name, so a
// bad sink level degrades to its default rather than failing the boot.
func resolveLevel(s string, def zerolog.Level) (zerolog.Level, error) {
	s = strings.TrimSpace(strings.ToLower(s))
	if s == "" {
		return def, nil
	}
	lvl, err := zerolog.ParseLevel(s)
	if err != nil || lvl == zerolog.NoLevel {
		return def, fmt.Errorf("unknown log level %q", s)
	}
	return lvl, nil
}

// nopCloser is a no-op io.Closer returned when no writer carries a Close.
type nopCloser struct{}

func (nopCloser) Close() error { return nil }

// multiCloser aggregates Close over every io.Closer-capable writer passed
// to Configure. Errors are joined so callers see every Close failure.
type multiCloser []io.Closer

func (mc multiCloser) Close() error {
	var errs []error
	for _, c := range mc {
		if err := c.Close(); err != nil {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
