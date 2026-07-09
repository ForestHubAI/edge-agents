// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package channel

import (
	"github.com/rs/zerolog"

	"github.com/ForestHubAI/edge-agents/go/logging"
)

// Log routes node-written messages into the engine's structured logger, so
// workflow output ships back through the same sinks (stdout/file/HTTP) as
// engine diagnostics. Unlike hardware/MQTT channels it binds to no external
// resource — it writes to the ambient logging.Logger configured at boot.
type Log struct {
	Level zerolog.Level
	Tag   string // optional category; empty stamps nothing
}

// Setup is a no-op: the logger is wired once at engine boot, not per channel.
func (l *Log) Setup() error { return nil }

// Write emits msg through the package logger at the channel's level, tagged
// source=workflow so the backend can separate workflow output from engine
// diagnostics, plus the optional category tag.
func (l *Log) Write(msg string) error {
	ev := logging.Logger.WithLevel(l.Level).Str("source", "workflow")
	if l.Tag != "" {
		ev = ev.Str("tag", l.Tag)
	}
	ev.Msg(msg)
	return nil
}
