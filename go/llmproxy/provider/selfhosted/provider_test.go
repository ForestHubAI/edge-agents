// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package selfhosted

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// --- Test Helpers ---

// newTestServer creates an httptest server that handles /v1/models and /v1/chat/completions.
// The chatHandler is called for POST /v1/chat/completions. If nil, a default text response is used.
func newTestServer(t *testing.T, chatHandler func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "GET" && r.URL.Path == "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(ModelList{
				Data: []ModelInfo{{ID: "test-model"}},
			})
		case r.Method == "POST" && r.URL.Path == "/v1/chat/completions":
			if chatHandler != nil {
				chatHandler(w, r)
				return
			}
			w.Header().Set("Content-Type", "application/json")
			content := "Hello from local model"
			json.NewEncoder(w).Encode(ChatCompletionResponse{
				ID: "resp-001",
				Choices: []Choice{{
					Index:        0,
					Message:      ResponseMessage{Role: "assistant", Content: &content},
					FinishReason: "stop",
				}},
				Usage: Usage{PromptTokens: 10, CompletionTokens: 5, TotalTokens: 15},
			})
		default:
			http.NotFound(w, r)
		}
	}))
}

// makeEmbedding creates a float32 slice of the given dimension filled with 0.1.
func makeEmbedding(dim int) []float32 {
	v := make([]float32, dim)
	for i := range v {
		v[i] = 0.1
	}
	return v
}

// newEmbeddingTestServer creates an httptest server that handles /v1/models and /v1/embeddings.
// The embeddingHandler is called for POST /v1/embeddings. If nil, a default 768-dim response is used.
func newEmbeddingTestServer(t *testing.T, embeddingHandler func(w http.ResponseWriter, r *http.Request)) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == "GET" && r.URL.Path == "/v1/models":
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(ModelList{
				Data: []ModelInfo{{ID: "embed-model"}},
			})
		case r.Method == "POST" && r.URL.Path == "/v1/embeddings":
			if embeddingHandler != nil {
				embeddingHandler(w, r)
				return
			}
			var req EmbeddingRequest
			json.NewDecoder(r.Body).Decode(&req)
			data := make([]EmbeddingData, len(req.Input))
			for i := range req.Input {
				data[i] = EmbeddingData{Embedding: makeEmbedding(768), Index: i}
			}
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(EmbeddingResponse{
				Data:  data,
				Model: req.Model,
				Usage: Usage{PromptTokens: 8, TotalTokens: 8},
			})
		default:
			http.NotFound(w, r)
		}
	}))
}

// newTestChatProvider creates a Provider with a single chat model pointing to the given server URL.
func newTestChatProvider(modelID string, serverURL string) *Provider {
	return NewProvider(Config{
		Endpoints: []ModelEndpoint{{
			URL:          serverURL,
			ID:           llmproxy.ModelID(modelID),
			Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityChat},
		}},
	})
}

// newTestEmbeddingProvider creates a Provider with a single embedding model pointing to the given server URL.
func newTestEmbeddingProvider(modelID string, serverURL string, dim int) *Provider {
	return NewProvider(Config{
		Endpoints: []ModelEndpoint{{
			URL:          serverURL,
			ID:           llmproxy.ModelID(modelID),
			Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityEmbedding},
			Dimension:    pointer.Ptr(dim),
		}},
	})
}

// --- Health Tests ---

func TestHealth(t *testing.T) {
	t.Run("all endpoints healthy", func(t *testing.T) {
		srv := newTestServer(t, nil)
		defer srv.Close()
		p := newTestChatProvider("test-model", srv.URL)

		err := p.Health(context.Background())
		assert.NoError(t, err)
	})

	t.Run("unreachable endpoint", func(t *testing.T) {
		p := newTestChatProvider("test-model", "http://127.0.0.1:1")

		err := p.Health(context.Background())
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "health check failed")
	})
}

// --- AvailableModels Tests ---

func TestAvailableModels(t *testing.T) {
	srv := newTestServer(t, nil)
	defer srv.Close()
	p := newTestChatProvider("test-model", srv.URL)

	models := p.AvailableModels()
	require.Len(t, models, 1)
	assert.Equal(t, llmproxy.ModelID("test-model"), models[0].ID)
	assert.Equal(t, llmproxy.ProviderID("SelfHosted"), models[0].Provider)
	assert.Contains(t, models[0].Capabilities, llmproxy.CapabilityChat)
}

// --- Chat Tests ---

func TestChat(t *testing.T) {
	t.Run("simple text response", func(t *testing.T) {
		srv := newTestServer(t, nil)
		defer srv.Close()
		p := newTestChatProvider("test-model", srv.URL)

		resp, err := p.Chat(context.Background(), &llmproxy.ChatRequest{
			Model: "test-model",
			Input: llmproxy.InputString("Hello"),
		})
		require.NoError(t, err)
		assert.Equal(t, "Hello from local model", resp.Text)
		assert.Equal(t, "resp-001", resp.ResponseID)
		assert.Equal(t, 15, resp.TokensUsed)
		assert.Equal(t, 10, resp.InputTokens)
		assert.Equal(t, 5, resp.OutputTokens)
	})

	t.Run("unknown model returns error", func(t *testing.T) {
		srv := newTestServer(t, nil)
		defer srv.Close()
		p := newTestChatProvider("test-model", srv.URL)

		_, err := p.Chat(context.Background(), &llmproxy.ChatRequest{
			Model: "unknown-model",
			Input: llmproxy.InputString("Hello"),
		})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "no chat endpoint configured")
	})

	t.Run("verifies request payload", func(t *testing.T) {
		var receivedReq ChatCompletionRequest
		srv := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			json.NewDecoder(r.Body).Decode(&receivedReq)
			w.Header().Set("Content-Type", "application/json")
			content := "ok"
			json.NewEncoder(w).Encode(ChatCompletionResponse{
				ID:      "resp-002",
				Choices: []Choice{{Message: ResponseMessage{Content: &content}, FinishReason: "stop"}},
				Usage:   Usage{},
			})
		})
		defer srv.Close()
		p := newTestChatProvider("test-model", srv.URL)

		_, err := p.Chat(context.Background(), &llmproxy.ChatRequest{
			Model:        "test-model",
			Input:        llmproxy.InputString("What is 2+2?"),
			SystemPrompt: "You are a math tutor.",
		})
		require.NoError(t, err)
		assert.Equal(t, "test-model", receivedReq.Model)
		require.Len(t, receivedReq.Messages, 2)
		assert.Equal(t, "system", receivedReq.Messages[0].Role)
		assert.Equal(t, "You are a math tutor.", receivedReq.Messages[0].Content)
		assert.Equal(t, "user", receivedReq.Messages[1].Role)
		assert.Equal(t, "What is 2+2?", receivedReq.Messages[1].Content)
	})
}

// --- Chat with Tools Tests ---

func TestChatWithTools(t *testing.T) {
	t.Run("tool call response", func(t *testing.T) {
		srv := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(ChatCompletionResponse{
				ID: "resp-tools",
				Choices: []Choice{{
					Message: ResponseMessage{
						Role: "assistant",
						ToolCalls: []ToolCall{{
							ID:   "call-1",
							Type: "function",
							Function: FunctionCall{
								Name:      "get_weather",
								Arguments: json.RawMessage(`{"location":"Berlin"}`),
							},
						}},
					},
					FinishReason: "tool_calls",
				}},
				Usage: Usage{PromptTokens: 20, CompletionTokens: 10, TotalTokens: 30},
			})
		})
		defer srv.Close()
		p := newTestChatProvider("test-model", srv.URL)

		resp, err := p.Chat(context.Background(), &llmproxy.ChatRequest{
			Model: "test-model",
			Input: llmproxy.InputString("What's the weather in Berlin?"),
			Tools: []llmproxy.Tool{
				llmproxy.ExternalToolBase{
					Name:        "get_weather",
					Description: "Get current weather",
					Parameters:  map[string]any{"type": "object", "properties": map[string]any{"location": map[string]any{"type": "string"}}},
				},
			},
		})
		require.NoError(t, err)
		require.Len(t, resp.ToolCallRequests, 1)
		assert.Equal(t, "call-1", resp.ToolCallRequests[0].CallID)
		assert.Equal(t, "get_weather", resp.ToolCallRequests[0].Name)
		assert.JSONEq(t, `{"location":"Berlin"}`, string(resp.ToolCallRequests[0].Arguments))
	})

	t.Run("llama-server arguments as string", func(t *testing.T) {
		srv := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{
				"id": "resp-str",
				"choices": [{
					"message": {
						"role": "assistant",
						"tool_calls": [{
							"id": "call-2",
							"type": "function",
							"function": {
								"name": "get_weather",
								"arguments": "{\"location\":\"Paris\"}"
							}
						}]
					},
					"finish_reason": "tool_calls"
				}],
				"usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8}
			}`))
		})
		defer srv.Close()
		p := newTestChatProvider("test-model", srv.URL)

		resp, err := p.Chat(context.Background(), &llmproxy.ChatRequest{
			Model: "test-model",
			Input: llmproxy.InputString("Weather in Paris?"),
		})
		require.NoError(t, err)
		require.Len(t, resp.ToolCallRequests, 1)
		assert.JSONEq(t, `{"location":"Paris"}`, string(resp.ToolCallRequests[0].Arguments))
	})

	t.Run("llama-server arguments as object", func(t *testing.T) {
		srv := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "application/json")
			w.Write([]byte(`{
				"id": "resp-obj",
				"choices": [{
					"message": {
						"role": "assistant",
						"tool_calls": [{
							"id": "call-3",
							"type": "function",
							"function": {
								"name": "get_weather",
								"arguments": {"location":"Tokyo"}
							}
						}]
					},
					"finish_reason": "tool_calls"
				}],
				"usage": {"prompt_tokens": 5, "completion_tokens": 3, "total_tokens": 8}
			}`))
		})
		defer srv.Close()
		p := newTestChatProvider("test-model", srv.URL)

		resp, err := p.Chat(context.Background(), &llmproxy.ChatRequest{
			Model: "test-model",
			Input: llmproxy.InputString("Weather in Tokyo?"),
		})
		require.NoError(t, err)
		require.Len(t, resp.ToolCallRequests, 1)
		assert.JSONEq(t, `{"location":"Tokyo"}`, string(resp.ToolCallRequests[0].Arguments))
	})
}

// --- Chat with Structured Output Tests ---

func TestChatWithStructuredOutput(t *testing.T) {
	var receivedReq ChatCompletionRequest
	srv := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&receivedReq)
		w.Header().Set("Content-Type", "application/json")
		content := `{"answer": 4}`
		json.NewEncoder(w).Encode(ChatCompletionResponse{
			ID:      "resp-fmt",
			Choices: []Choice{{Message: ResponseMessage{Content: &content}, FinishReason: "stop"}},
			Usage:   Usage{},
		})
	})
	defer srv.Close()
	p := newTestChatProvider("test-model", srv.URL)

	_, err := p.Chat(context.Background(), &llmproxy.ChatRequest{
		Model: "test-model",
		Input: llmproxy.InputString("What is 2+2?"),
		ResponseFormat: &llmproxy.ResponseFormat{
			Name:   "math_result",
			Schema: map[string]any{"type": "object", "properties": map[string]any{"answer": map[string]any{"type": "integer"}}},
		},
	})
	require.NoError(t, err)
	require.NotNil(t, receivedReq.ResponseFormat)
	assert.Equal(t, "json_schema", receivedReq.ResponseFormat.Type)
	assert.Equal(t, "math_result", receivedReq.ResponseFormat.JsonSchema.Name)
}

// --- Chat with Options Tests ---

func TestChatWithOptions(t *testing.T) {
	var receivedReq ChatCompletionRequest
	srv := newTestServer(t, func(w http.ResponseWriter, r *http.Request) {
		json.NewDecoder(r.Body).Decode(&receivedReq)
		w.Header().Set("Content-Type", "application/json")
		content := "ok"
		json.NewEncoder(w).Encode(ChatCompletionResponse{
			ID:      "resp-opts",
			Choices: []Choice{{Message: ResponseMessage{Content: &content}, FinishReason: "stop"}},
			Usage:   Usage{},
		})
	})
	defer srv.Close()
	p := newTestChatProvider("test-model", srv.URL)

	temp := float32(0.7)
	maxTok := 100
	_, err := p.Chat(context.Background(), &llmproxy.ChatRequest{
		Model: "test-model",
		Input: llmproxy.InputString("Hello"),
		Options: &llmproxy.Options{
			Temperature: &temp,
			MaxTokens:   &maxTok,
		},
	})
	require.NoError(t, err)
	require.NotNil(t, receivedReq.Temperature)
	assert.InDelta(t, 0.7, *receivedReq.Temperature, 0.001)
	require.NotNil(t, receivedReq.MaxTokens)
	assert.Equal(t, 100, *receivedReq.MaxTokens)
}

// --- UploadFile / DeleteFile Tests ---

func TestUploadFile(t *testing.T) {
	p := &Provider{}
	_, err := p.UploadFile(context.Background(), nil)
	assert.ErrorIs(t, err, provider.ErrNotSupported)
}

func TestDeleteFile(t *testing.T) {
	p := &Provider{}
	ok, err := p.DeleteFile(context.Background(), "file-123")
	assert.ErrorIs(t, err, provider.ErrNotSupported)
	assert.False(t, ok)
}

// --- Embed Tests ---

func TestEmbed(t *testing.T) {
	t.Run("simple embedding", func(t *testing.T) {
		srv := newEmbeddingTestServer(t, nil)
		defer srv.Close()
		p := newTestEmbeddingProvider("embed-model", srv.URL, 768)

		resp, err := p.Embed(context.Background(), &llmproxy.EmbeddingRequest{
			Model:  "embed-model",
			Inputs: []string{"hello world"},
		})
		require.NoError(t, err)
		require.Len(t, resp.Embeddings, 1)
		assert.Len(t, resp.Embeddings[0], 768)
		assert.Equal(t, 8, resp.TokensUsed)
		assert.Equal(t, 8, resp.InputTokens)
	})

	t.Run("multiple inputs", func(t *testing.T) {
		srv := newEmbeddingTestServer(t, nil)
		defer srv.Close()
		p := newTestEmbeddingProvider("embed-model", srv.URL, 768)

		resp, err := p.Embed(context.Background(), &llmproxy.EmbeddingRequest{
			Model:  "embed-model",
			Inputs: []string{"text one", "text two", "text three"},
		})
		require.NoError(t, err)
		require.Len(t, resp.Embeddings, 3)
		for i, emb := range resp.Embeddings {
			assert.Len(t, emb, 768, "embedding %d should have 768 dimensions", i)
		}
	})

	t.Run("unknown model", func(t *testing.T) {
		srv := newEmbeddingTestServer(t, nil)
		defer srv.Close()
		p := newTestEmbeddingProvider("embed-model", srv.URL, 768)

		_, err := p.Embed(context.Background(), &llmproxy.EmbeddingRequest{
			Model:  "unknown-model",
			Inputs: []string{"hello"},
		})
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "no embedding endpoint configured")
	})

	t.Run("verifies request payload", func(t *testing.T) {
		var receivedReq EmbeddingRequest
		srv := newEmbeddingTestServer(t, func(w http.ResponseWriter, r *http.Request) {
			json.NewDecoder(r.Body).Decode(&receivedReq)
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(EmbeddingResponse{
				Data:  []EmbeddingData{{Embedding: makeEmbedding(768), Index: 0}},
				Model: receivedReq.Model,
				Usage: Usage{PromptTokens: 5, TotalTokens: 5},
			})
		})
		defer srv.Close()
		p := newTestEmbeddingProvider("embed-model", srv.URL, 768)

		_, err := p.Embed(context.Background(), &llmproxy.EmbeddingRequest{
			Model:  "embed-model",
			Inputs: []string{"check payload"},
		})
		require.NoError(t, err)
		assert.Equal(t, "embed-model", receivedReq.Model)
		assert.Equal(t, []string{"check payload"}, receivedReq.Input)
	})
}

// --- EmbeddingDimension Tests ---

func TestEmbeddingDimension(t *testing.T) {
	srv := newEmbeddingTestServer(t, nil)
	defer srv.Close()
	p := newTestEmbeddingProvider("embed-model", srv.URL, 768)

	t.Run("declared dimension", func(t *testing.T) {
		dim, err := p.EmbeddingDimension("embed-model")
		require.NoError(t, err)
		assert.Equal(t, 768, dim)
	})

	t.Run("unknown model", func(t *testing.T) {
		_, err := p.EmbeddingDimension("unknown-model")
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "unsupported embedding model")
	})
}
