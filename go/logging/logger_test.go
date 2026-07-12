// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package logging

import (
	"bytes"
	"testing"

	"github.com/rs/zerolog"
	"github.com/stretchr/testify/assert"
)

func TestConfigure_WritesStructuredJSONAtLevel(t *testing.T) {
	var buf bytes.Buffer
	configure(&buf, zerolog.InfoLevel)

	Logger.Debug().Msg("d")
	Logger.Info().Msg("i")
	Logger.Error().Msg("e")

	out := buf.String()
	assert.NotContains(t, out, `"msg":"d"`) // below the floor, dropped
	assert.Contains(t, out, `"msg":"i"`)
	assert.Contains(t, out, `"msg":"e"`)
	assert.Contains(t, out, `"level":"info"`) // structured, not plain text
}

func TestParseLevel(t *testing.T) {
	t.Run("valid name is parsed case-insensitively", func(t *testing.T) {
		lvl, err := ParseLevel("WARN")
		assert.NoError(t, err)
		assert.Equal(t, zerolog.WarnLevel, lvl)
	})

	t.Run("empty errors (strict primitive)", func(t *testing.T) {
		_, err := ParseLevel("")
		assert.Error(t, err)
	})

	t.Run("unknown name errors", func(t *testing.T) {
		_, err := ParseLevel("bogus")
		assert.Error(t, err)
	})
}

func TestConfigure(t *testing.T) {
	t.Run("valid level is applied", func(t *testing.T) {
		Configure(Config{Level: "warn"})
		assert.Equal(t, zerolog.WarnLevel, Logger.GetLevel())
	})

	t.Run("unset level defaults to debug without warning", func(t *testing.T) {
		// Point the current logger at a buffer so any pre-reconfigure warn lands there.
		var buf bytes.Buffer
		configure(&buf, zerolog.InfoLevel)

		Configure(Config{}) // LOG_LEVEL unset — normal, must not warn

		assert.NotContains(t, buf.String(), "invalid log level")
		assert.Equal(t, defaultConsoleLevel, Logger.GetLevel())
	})

	t.Run("invalid level warns and falls back to debug", func(t *testing.T) {
		var buf bytes.Buffer
		configure(&buf, zerolog.DebugLevel)

		Configure(Config{Level: "bogus"})

		assert.Contains(t, buf.String(), "invalid log level")
		assert.Equal(t, defaultConsoleLevel, Logger.GetLevel())
	})
}
