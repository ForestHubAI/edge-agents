// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package llmproxy

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestAsInputItems(t *testing.T) {
	t.Run("input string", func(t *testing.T) {
		got := AsInputItems(InputString("hello"))
		assert.Equal(t, InputItems{InputString("hello")}, got)
	})

	t.Run("input items", func(t *testing.T) {
		items := InputItems{InputString("a"), InputString("b")}
		got := AsInputItems(items)
		assert.Equal(t, items, got)
	})

	t.Run("nil", func(t *testing.T) {
		got := AsInputItems(nil)
		assert.Nil(t, got)
	})
}

func TestLastUserInput(t *testing.T) {
	t.Run("input string", func(t *testing.T) {
		got := LastUserInput(InputString("hello"))
		assert.Equal(t, "hello", got)
	})

	t.Run("last item is text", func(t *testing.T) {
		items := InputItems{InputString("first"), InputString("last")}
		got := LastUserInput(items)
		assert.Equal(t, "last", got)
	})

	t.Run("last item is tool call", func(t *testing.T) {
		items := InputItems{
			InputString("user prompt"),
			ToolCallRequest{CallID: "1", Name: "fn", Arguments: json.RawMessage(`{}`)},
		}
		got := LastUserInput(items)
		assert.Equal(t, "user prompt", got)
	})

	t.Run("only tool calls", func(t *testing.T) {
		items := InputItems{
			ToolCallRequest{CallID: "1", Name: "fn", Arguments: json.RawMessage(`{}`)},
		}
		got := LastUserInput(items)
		assert.Equal(t, "", got)
	})

	t.Run("nil", func(t *testing.T) {
		got := LastUserInput(nil)
		assert.Equal(t, "", got)
	})
}
