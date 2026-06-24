package logging

import (
	"io"
	"os"
	"strings"

	lumberjack "gopkg.in/natefinch/lumberjack.v2"
)

const (
	defaultLogMaxSizeMB  = 10
	defaultLogMaxBackups = 5
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
	// Level is the zerolog level name (debug/info/warn/error). Empty or unknown
	// falls back to info.
	Level string `env:"FH_LOG_LEVEL"`
	// File is the rotating-file sink. Its rotation knobs apply only when File.Path
	// is set; the whole sink is off otherwise.
	File FileSink
	// HTTP is the log-shipping sink. Off unless HTTP.URL is set.
	HTTP HTTPSink
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
// a zero Config yields stdout at info level — the safe bootstrap before real
// config loads. An invalid level is reported on the configured logger and falls
// back to info rather than failing the boot.
func Configure(cfg Config) io.Closer {
	level, levelErr := ParseLevel(cfg.Level)

	writers := []io.Writer{os.Stdout}
	if cfg.File.enabled() {
		writers = append(writers, cfg.File.writer())
	}
	if cfg.HTTP.enabled() {
		writers = append(writers, cfg.HTTP.writer())
	}

	closer := wire(level, writers...)
	if cfg.Component != "" {
		Logger = Logger.With().Str("component", cfg.Component).Logger()
	}
	if levelErr != nil {
		Logger.Warn().Err(levelErr).Str("input", cfg.Level).Msg("invalid log level; falling back to info")
	}
	return closer
}

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
