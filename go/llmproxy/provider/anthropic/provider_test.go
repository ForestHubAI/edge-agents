// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build llmtest

package anthropic

import (
	"context"
	"errors"
	"os"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/test"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var (
	p     = NewProvider(Config{APIKey: os.Getenv("ANTHROPIC_API_KEY")})
	model = llmproxy.ModelID("claude-sonnet-4-6")
)

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

func TestChatWithImageURL(t *testing.T) {
	req := &llmproxy.ChatRequest{
		Model:     model,
		Input:     llmproxy.InputString("Describe this image in one sentence."),
		ImageURLs: []string{"https://upload.wikimedia.org/wikipedia/commons/thumb/4/47/PNG_transparency_demonstration_1.png/280px-PNG_transparency_demonstration_1.png"},
	}
	resp, err := p.Chat(context.Background(), req)
	assert.NoError(t, err)
	assert.NotEmpty(t, resp.Text)
	assert.Greater(t, resp.TokensUsed, 0)
}

func TestUploadFileNotSupported(t *testing.T) {
	_, err := p.UploadFile(context.Background(), &llmproxy.FileUploadRequest{})
	require.Error(t, err)
	assert.True(t, errors.Is(err, provider.ErrNotSupported))
}

func TestDeleteFileNotSupported(t *testing.T) {
	deleted, err := p.DeleteFile(context.Background(), "some-file-id")
	require.Error(t, err)
	assert.False(t, deleted)
	assert.True(t, errors.Is(err, provider.ErrNotSupported))
}
