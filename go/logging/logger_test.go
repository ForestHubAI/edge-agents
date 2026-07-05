// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package logging

import (
	"bytes"
	"os"
	"path/filepath"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWire(t *testing.T) {
	t.Run("each sink filters at its own level", func(t *testing.T) {
		var debugBuf, infoBuf bytes.Buffer
		wire(
			sink{level: zerolog.DebugLevel, writer: &debugBuf},
			sink{level: zerolog.InfoLevel, writer: &infoBuf},
		)

		Logger.Debug().Msg("d")
		Logger.Info().Msg("i")
		Logger.Error().Msg("e")

		// The debug sink's floor lets everything through.
		assert.Contains(t, debugBuf.String(), `"msg":"d"`)
		assert.Contains(t, debugBuf.String(), `"msg":"i"`)
		assert.Contains(t, debugBuf.String(), `"msg":"e"`)

		// The info sink drops the debug line but keeps info+ above it.
		assert.NotContains(t, infoBuf.String(), `"msg":"d"`)
		assert.Contains(t, infoBuf.String(), `"msg":"i"`)
		assert.Contains(t, infoBuf.String(), `"msg":"e"`)
	})

	t.Run("logger floor is the most permissive sink", func(t *testing.T) {
		// With one debug and one error sink, a debug line must still reach the
		// debug sink — the logger's own level cannot sit above the lowest floor.
		var debugBuf, errorBuf bytes.Buffer
		wire(
			sink{level: zerolog.ErrorLevel, writer: &errorBuf},
			sink{level: zerolog.DebugLevel, writer: &debugBuf},
		)

		Logger.Debug().Msg("d")

		assert.Contains(t, debugBuf.String(), `"msg":"d"`)
		assert.NotContains(t, errorBuf.String(), `"msg":"d"`)
	})

	t.Run("empty sink list discards", func(t *testing.T) {
		closer := wire()
		require.NotNil(t, closer)
		assert.NoError(t, closer.Close())
		// No panic and nothing to write to is the whole contract.
		Logger.Info().Msg("dropped")
	})

	t.Run("closer aggregates only closable writers", func(t *testing.T) {
		var buf bytes.Buffer // plain writer, no Close
		closer := wire(sink{level: zerolog.InfoLevel, writer: &buf})
		require.NotNil(t, closer)
		assert.NoError(t, closer.Close())
	})
}

func TestResolveLevel(t *testing.T) {
	t.Run("empty falls back to the default", func(t *testing.T) {
		lvl, err := resolveLevel("", zerolog.DebugLevel)
		assert.NoError(t, err)
		assert.Equal(t, zerolog.DebugLevel, lvl)
	})

	t.Run("valid name is parsed case-insensitively", func(t *testing.T) {
		lvl, err := resolveLevel("WARN", zerolog.InfoLevel)
		assert.NoError(t, err)
		assert.Equal(t, zerolog.WarnLevel, lvl)
	})

	t.Run("unknown name errors but returns the default", func(t *testing.T) {
		lvl, err := resolveLevel("bogus", zerolog.InfoLevel)
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "bogus")
		assert.Equal(t, zerolog.InfoLevel, lvl)
	})
}

func TestLevelWriter(t *testing.T) {
	t.Run("plain writer is adapted", func(t *testing.T) {
		var buf bytes.Buffer
		lw := levelWriter(&buf)
		_, ok := lw.(zerolog.LevelWriterAdapter)
		assert.True(t, ok)
	})

	t.Run("level-aware writer passes through unchanged", func(t *testing.T) {
		// HTTPWriter implements LevelWriter; wrapping must not bury its WriteLevel
		// (the synchronous Fatal path) behind an adapter.
		hw := NewHTTPWriter("http://example.invalid", "", "")
		assert.Same(t, hw, levelWriter(hw))
	})
}

func TestConfigure(t *testing.T) {
	t.Run("file sink defaults to info and drops debug", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "app.log")
		closer := Configure(Config{File: FileSink{Path: path}})

		Logger.Debug().Msg("d")
		Logger.Info().Msg("i")
		require.NoError(t, closer.Close())

		data, err := os.ReadFile(path)
		require.NoError(t, err)
		assert.NotContains(t, string(data), `"msg":"d"`)
		assert.Contains(t, string(data), `"msg":"i"`)
	})

	t.Run("file sink level overrides the default", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "app.log")
		closer := Configure(Config{File: FileSink{Path: path, Level: "debug"}})

		Logger.Debug().Msg("d")
		require.NoError(t, closer.Close())

		data, err := os.ReadFile(path)
		require.NoError(t, err)
		assert.Contains(t, string(data), `"msg":"d"`)
	})

	t.Run("component is stamped on every line", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "app.log")
		closer := Configure(Config{Component: "ranger", File: FileSink{Path: path}})

		Logger.Info().Msg("i")
		require.NoError(t, closer.Close())

		data, err := os.ReadFile(path)
		require.NoError(t, err)
		assert.Contains(t, string(data), `"component":"ranger"`)
	})

	t.Run("unknown sink level falls back without failing boot", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), "app.log")
		// Bogus level must not panic or discard; it degrades to the info default.
		closer := Configure(Config{File: FileSink{Path: path, Level: "bogus"}})

		Logger.Info().Msg("i")
		require.NoError(t, closer.Close())

		data, err := os.ReadFile(path)
		require.NoError(t, err)
		assert.Contains(t, string(data), `"msg":"i"`)
	})
}
