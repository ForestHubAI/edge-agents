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

const httpCloseTimeout = 3 * time.Second

// Logger is the package-level logger any component
// shares. Call Configure once at boot to wire the writer graph; read it
// from anywhere thereafter.
var Logger = zerolog.Nop()

// wire fans writers into the package Logger via zerolog.MultiLevelWriter; an
// empty list discards. The returned io.Closer aggregates Close() over every
// writer that implements io.Closer. Configure (config.go) is the public entry.
func wire(level zerolog.Level, writers ...io.Writer) io.Closer {
	var writer io.Writer
	switch len(writers) {
	case 0:
		writer = io.Discard
	case 1:
		writer = writers[0]
	default:
		writer = zerolog.MultiLevelWriter(writers...)
	}

	zerolog.MessageFieldName = "msg"
	zerolog.TimeFieldFormat = time.RFC3339Nano
	Logger = zerolog.New(writer).Level(level).With().Timestamp().Logger()

	var closers multiCloser
	for _, w := range writers {
		if c, ok := w.(io.Closer); ok {
			closers = append(closers, c)
		}
	}
	if len(closers) == 0 {
		return nopCloser{}
	}
	return closers
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
