//go:build llmtest

package gemini

import (
	"context"
	"os"
	"testing"

	"github.com/ForestHubAI/fh-core/go/llmproxy"
	"github.com/ForestHubAI/fh-core/go/llmproxy/test"

	"github.com/stretchr/testify/assert"
)

var (
	p, _  = NewAPIProvider(Config{APIKey: os.Getenv("GEMINI_API_KEY")})
	model = llmproxy.ModelID("gemini-2.5-flash")
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

// TestChatWithWebSearch tests chat with Google Search grounding.
func TestChatWithWebSearch(t *testing.T) {
	req := &llmproxy.ChatRequest{
		Model: model,
		Input: llmproxy.InputString("What happened in tech news today?"),
		Tools: []llmproxy.Tool{llmproxy.WebSearch{}},
	}
	resp, err := p.Chat(context.Background(), req)
	assert.NoError(t, err)
	assert.NotEmpty(t, resp.Text)
	assert.Greater(t, resp.TokensUsed, 0)
}

// TestEmbedding tests embedding generation.
func TestEmbedding(t *testing.T) {
	req := &llmproxy.EmbeddingRequest{
		Model:  "gemini-embedding-001",
		Inputs: []string{"Hello, world!"},
	}
	resp, err := p.Embed(context.Background(), req)
	assert.NoError(t, err)
	assert.Len(t, resp.Embeddings, 1)
	assert.Len(t, resp.Embeddings[0], 3072)
}

// TestEmbeddingDimension tests the dimension lookup for embedding models.
func TestEmbeddingDimension(t *testing.T) {
	dim, err := p.EmbeddingDimension("gemini-embedding-001")
	assert.NoError(t, err)
	assert.Equal(t, 3072, dim)

	_, err = p.EmbeddingDimension("unsupported-model")
	assert.Error(t, err)
}

// TestFileHandling tests file upload and deletion functionality of the provider.
func TestFileHandling(t *testing.T) {
	test.FileHandling(t, p)
}
