// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package logging configures the structured zerolog logger a process shares.
// Logs always go to stdout as JSON — the container runtime captures the stream
// and any collector reads it from there, so the package neither ships nor rotates
// logs itself. Configure wires the logger once at boot; read the package Logger
// from anywhere thereafter. It stamps no producer identity: a line is identified
// by the stream it is read from, not a field it carries.
package logging

import (
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/rs/zerolog"
)

// Logger is the package-level logger the process shares. It logs to stdout at
// the default level from package init, so a line written before Configure runs
// (e.g. an early boot failure) is still visible; Configure only adjusts the level.
var Logger = zerolog.Nop()

// init points Logger at stdout before any main runs, so nothing needs a bootstrap
// Configure call to make early failures visible.
func init() { configure(os.Stdout, defaultLevel) }

// FatalExit logs err at the Fatal level and then exits the process with code.
// Unlike Logger.Fatal() — which hardcodes os.Exit(1) — this lets a component pick
// its exit code (e.g. component.ExitConfigError) while still emitting the line to
// stdout first, hence WithLevel + os.Exit rather than the .Fatal() helper.
func FatalExit(code int, err error, msg string) {
	Logger.WithLevel(zerolog.FatalLevel).Err(err).Msg(msg)
	os.Exit(code)
}

// ParseLevel parses a case-insensitive level name, erroring on empty or unknown input.
func ParseLevel(s string) (zerolog.Level, error) {
	lvl, err := zerolog.ParseLevel(strings.TrimSpace(strings.ToLower(s)))
	if err != nil || lvl == zerolog.NoLevel {
		return zerolog.NoLevel, fmt.Errorf("unknown log level %q", s)
	}
	return lvl, nil
}

// configure points Logger at w, emitting timestamped structured JSON at level.
// It only sets the logger; parsing a level name and defaulting is Configure's job.
func configure(w io.Writer, level zerolog.Level) {
	zerolog.MessageFieldName = "msg"
	zerolog.TimeFieldFormat = time.RFC3339Nano
	Logger = zerolog.New(w).Level(level).With().Timestamp().Logger()
}
