// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package logging

import (
	"fmt"
	"io"
	"os"
	"strings"

	"github.com/rs/zerolog"
	lumberjack "gopkg.in/natefinch/lumberjack.v2"
)

const (
	defaultLogMaxSizeMB  = 10
	defaultLogMaxBackups = 5
)

const (
	// defaultConsoleLevel is the floor for stdout when ConsoleSink.Level is unset:
	// the local console is the verbose sink a developer reads live.
	defaultConsoleLevel = zerolog.DebugLevel
	// defaultSinkLevel is the floor for the file and HTTP sinks when their Level is
	// unset: shipped/persisted logs default to info to keep volume bounded.
	defaultSinkLevel = zerolog.InfoLevel
)

// Config declares the log sinks a component wires at boot. The env tags use a
// component-neutral FH_LOG_ prefix so every component (engine, ranger, …) reads
// the same vars; the app calls env.Parse, so this package never imports the env
// library. Console (stdout) is unconditional; the file and HTTP sinks are opt-in
// — each is its own struct, disabled by its zero value (empty path / URL) — so a
// standalone run logs to stdout only and a deployer turns the others on.
type Config struct {
	// Component is the constant producer name stamped on every line ("engine",
	// "ranger"). It is set in code, not from the environment: it identifies the
	// binary and is the only identity a line carries — the deployment dimension is
	// structural, carried by the on-device log path, never a logger field. Empty
	// stamps nothing.
	Component string `env:"-"`
	// Console is the stdout sink. Always enabled; its only knob is a per-sink
	// level override (e.g. debug locally while the HTTP shipper stays at info).
	Console ConsoleSink
	// File is the rotating-file sink. Its rotation knobs apply only when File.Path
	// is set; the whole sink is off otherwise.
	File FileSink
	// HTTP is the log-shipping sink. Off unless HTTP.URL is set.
	HTTP HTTPSink
}

// ConsoleSink is the unconditional stdout sink. It carries no enable flag — only
// an optional per-sink level.
type ConsoleSink struct {
	// Level is the zerolog level name for stdout. Empty or unknown falls back to
	// defaultConsoleLevel (debug) — the local console is the verbose sink.
	Level string `env:"FH_LOG_CONSOLE_LEVEL"`
}

// FileSink is the rotating-file sink. The zero value (empty Path) disables it, so
// the rotation knobs are meaningful only alongside a Path — grouping them here
// makes that dependency structural rather than a naming convention.
type FileSink struct {
	// Path is the log file. Empty disables the file sink. In a deployment this is
	// the logs mount Ranger repoints per deployment, so the path — not the line —
	// carries the component/deployment partition.
	Path string `env:"FH_LOG_FILE_PATH"`
	// MaxSizeMB is the size a file reaches before it rotates. <=0 →
	// defaultLogMaxSizeMB. With MaxBackups it sets the per-file disk footprint
	// (≈ size × (backups+1)); the cross-deployment disk budget is the shipper's job.
	MaxSizeMB int `env:"FH_LOG_FILE_MAX_SIZE_MB"`
	// MaxBackups is how many rotated files to retain. <=0 → defaultLogMaxBackups;
	// lumberjack's keep-everything (0) is intentionally unreachable so a device
	// stays bounded.
	MaxBackups int `env:"FH_LOG_FILE_MAX_BACKUPS"`
	// Level is the zerolog level name for this sink. Empty or unknown falls back
	// to defaultSinkLevel (info).
	Level string `env:"FH_LOG_FILE_LEVEL"`
}

// enabled reports whether a path was configured.
func (f FileSink) enabled() bool { return f.Path != "" }

// writer builds the rotating writer, defaulting the bounds so a code-built sink
// with only a Path still stays bounded instead of lumberjack's keep-everything.
func (f FileSink) writer() io.Writer {
	maxSize := f.MaxSizeMB
	if maxSize <= 0 {
		maxSize = defaultLogMaxSizeMB
	}
	maxBackups := f.MaxBackups
	if maxBackups <= 0 {
		maxBackups = defaultLogMaxBackups
	}
	return &lumberjack.Logger{
		Filename:   f.Path,
		MaxSize:    maxSize,
		MaxBackups: maxBackups,
		Compress:   true,
	}
}

// HTTPSink ships each line by POST to URL. The zero value (empty URL) disables it.
type HTTPSink struct {
	// URL is the collector endpoint. Backend-agnostic: OSS points it anywhere
	// (Loki, vector, …), the hosted renderer at the device-log endpoint. Empty
	// disables the HTTP sink.
	URL string `env:"FH_LOG_HTTP_URL"`
	// Header is an optional auth header, "Name: Value" (e.g. "Agent-Key: <secret>").
	// Empty sends no header.
	Header string `env:"FH_LOG_HTTP_HEADER"`
	// Level is the zerolog level name for this sink. Empty or unknown falls back
	// to defaultSinkLevel (info).
	Level string `env:"FH_LOG_HTTP_LEVEL"`
}

// enabled reports whether a URL was configured.
func (h HTTPSink) enabled() bool { return h.URL != "" }

// writer builds the HTTP writer, parsing Header into the auth header pair.
func (h HTTPSink) writer() io.Writer {
	name, value := parseHeader(h.Header)
	return NewHTTPWriter(h.URL, name, value)
}

// Configure wires the package Logger from cfg and returns an io.Closer that
// drains the HTTP sink and closes the file sink at shutdown. Call once at boot;
// a zero Config yields stdout at debug level — the safe bootstrap before real
// config loads. Each enabled sink filters at its own level: the console defaults
// to debug (the local verbose sink), the file and HTTP sinks to info, and any
// sink may override via its Level. One line fans to every sink and each drops
// what falls below its floor. An unknown per-sink level is reported on the
// configured logger and falls back to the default rather than failing the boot.
func Configure(cfg Config) io.Closer {
	var sinks []sink
	var sinkErrs []error
	add := func(name, levelName string, def zerolog.Level, w io.Writer) {
		lvl, err := resolveLevel(levelName, def)
		if err != nil {
			sinkErrs = append(sinkErrs, fmt.Errorf("%s sink: %w", name, err))
		}
		sinks = append(sinks, sink{level: lvl, writer: w})
	}

	add("console", cfg.Console.Level, defaultConsoleLevel, nonClosing{os.Stdout})
	if cfg.File.enabled() {
		add("file", cfg.File.Level, defaultSinkLevel, cfg.File.writer())
	}
	if cfg.HTTP.enabled() {
		add("http", cfg.HTTP.Level, defaultSinkLevel, cfg.HTTP.writer())
	}

	closer := wire(sinks...)
	if cfg.Component != "" {
		Logger = Logger.With().Str("component", cfg.Component).Logger()
	}
	for _, err := range sinkErrs {
		Logger.Warn().Err(err).Msg("invalid sink log level; falling back to default")
	}
	return closer
}

// nonClosing wraps a process-owned writer (stdout) so wire's closer aggregation
// skips it: only the file and HTTP sinks own resources Configure's closer should
// drain. Embedding the io.Writer interface — not the concrete *os.File — hides
// any Close the underlying writer carries, so a type assertion to io.Closer fails.
type nonClosing struct{ io.Writer }

// parseHeader splits an "Name: Value" auth-header config into its parts. An
// empty or colon-less input yields empty name+value, which NewHTTPWriter treats
// as "send no header".
func parseHeader(h string) (name, value string) {
	name, value, found := strings.Cut(h, ":")
	if !found {
		return "", ""
	}
	return strings.TrimSpace(name), strings.TrimSpace(value)
}
