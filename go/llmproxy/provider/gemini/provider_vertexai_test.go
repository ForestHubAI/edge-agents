//go:build vertextest

package gemini

import (
	"context"
	"testing"

	"github.com/ForestHubAI/fh-core/go/llmproxy"
	"github.com/ForestHubAI/fh-core/go/llmproxy/test"

	"github.com/stretchr/testify/assert"
)

var (
	vp, _    = NewVertexAIProvider(Config{VertexAI: VertexAIConfig{Project: "fh-backend-474712", Location: "europe-west1"}})
	vtxModel = llmproxy.ModelID("gemini-2.5-flash")
)

func TestVertexAISupportsModel(t *testing.T) {
	test.SupportsModel(t, vp, vtxModel)
}

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

func TestVertexAIEmbedding(t *testing.T) {
	req := &llmproxy.EmbeddingRequest{
		Model:  GeminiEmbedding001,
		Inputs: []string{"Hello, world!"},
	}
	resp, err := vp.Embed(context.Background(), req)
	assert.NoError(t, err)
	assert.Len(t, resp.Embeddings, 1)
	assert.Len(t, resp.Embeddings[0], 3072)
}
