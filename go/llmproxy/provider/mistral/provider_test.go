// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build llmtest

package mistral

import (
	"os"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/test"
)

var (
	p     = NewProvider(Config{APIKey: os.Getenv("MISTRAL_API_KEY")})
	model = llmproxy.ModelID("mistral-large-latest")
)

// TestChat tests basic chat functionality of the provider.
func TestChat(t *testing.T) {
	t.Run("text response", func(t *testing.T) {
		test.Chat(t, p, model)
	})
	t.Run("structured response", func(t *testing.T) {
		test.StructuredResponse(t, p, model)
	})
	t.Run("tool use", func(t *testing.T) {
		test.ChatWithToolUse(t, p, model)
	})
}

// TestFileHandling tests file upload and deletion functionality of the provider.
func TestFileHandling(t *testing.T) {
	test.FileHandling(t, p)
}
