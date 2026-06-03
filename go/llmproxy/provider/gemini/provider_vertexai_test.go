//go:build vertextest

package gemini

import (
	"context"
	"os"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/test"

	"github.com/stretchr/testify/assert"
)

var (
	vp, _    = NewVertexAIProvider(Config{VertexAI: VertexAIConfig{Project: os.Getenv("GCP_PROJECT"), Location: os.Getenv("GCP_LOCATION")}})
	vtxModel = llmproxy.ModelID("gemini-2.5-flash")
)

// TestVertexAIChat tests basic chat functionality of the Vertex AI provider.
func TestVertexAIChat(t *testing.T) {
	t.Run("text response", func(t *testing.T) {
		test.Chat(t, vp, vtxModel)
	})
	t.Run("structured response", func(t *testing.T) {
		test.StructuredResponse(t, vp, vtxModel)
	})
	t.Run("tool use", func(t *testing.T) {
		test.ChatWithToolUse(t, vp, vtxModel)
	})
}

// TestVertexAIChatWithWebSearch tests chat with Google Search grounding.
func TestVertexAIChatWithWebSearch(t *testing.T) {
	req := &llmproxy.ChatRequest{
		Model: vtxModel,
		Input: llmproxy.InputString("What happened in tech news today?"),
		Tools: []llmproxy.Tool{llmproxy.WebSearch{}},
	}
	resp, err := vp.Chat(context.Background(), req)
	assert.NoError(t, err)
	assert.NotEmpty(t, resp.Text)
	assert.Greater(t, resp.TokensUsed, 0)
}

// TestVertexAIEmbedding tests embedding generation.
func TestVertexAIEmbedding(t *testing.T) {
	req := &llmproxy.EmbeddingRequest{
		Model:  "gemini-embedding-001",
		Inputs: []string{"Hello, world!"},
	}
	resp, err := vp.Embed(context.Background(), req)
	assert.NoError(t, err)
	assert.Len(t, resp.Embeddings, 1)
	assert.Len(t, resp.Embeddings[0], 3072)
}

// TestVertexAIEmbeddingDimension tests the dimension lookup for embedding models.
func TestVertexAIEmbeddingDimension(t *testing.T) {
	dim, err := vp.EmbeddingDimension("gemini-embedding-001")
	assert.NoError(t, err)
	assert.Equal(t, 3072, dim)

	_, err = vp.EmbeddingDimension("unsupported-model")
	assert.Error(t, err)
}

// TestVertexAIFileHandling tests file upload and deletion functionality of the provider.
func TestVertexAIFileHandling(t *testing.T) {
	test.FileHandling(t, vp)
}
