// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package selfhosted implements the SelfHosted LLM provider for routing chat
// requests to operator-run inference servers (llama, vLLM, Ollama, etc.)
// via the OpenAI-compatible Chat Completions API.
package selfhosted

import "encoding/json"

// ChatCompletionRequest represents a chat completion request.
type ChatCompletionRequest struct {
	Model            string          `json:"model"`
	Messages         []Message       `json:"messages"`
	Tools            []Tool          `json:"tools,omitempty"`
	ResponseFormat   *ResponseFormat `json:"response_format,omitempty"`
	Temperature      *float32        `json:"temperature,omitempty"`
	TopP             *float32        `json:"top_p,omitempty"`
	MaxTokens        *int            `json:"max_tokens,omitempty"`
	FrequencyPenalty *float32        `json:"frequency_penalty,omitempty"`
	PresencePenalty  *float32        `json:"presence_penalty,omitempty"`
}

// Message represents a chat message.
type Message struct {
	Role       string     `json:"role"`
	Content    string     `json:"content"`
	Name       *string    `json:"name,omitempty"`
	ToolCalls  []ToolCall `json:"tool_calls,omitempty"`
	ToolCallID *string    `json:"tool_call_id,omitempty"`
}

// Tool represents a tool definition.
type Tool struct {
	Type     string      `json:"type"`
	Function FunctionDef `json:"function"`
}

// FunctionDef defines a function tool's schema.
type FunctionDef struct {
	Name        string         `json:"name"`
	Description *string        `json:"description,omitempty"`
	Parameters  map[string]any `json:"parameters,omitempty"`
	Strict      *bool          `json:"strict,omitempty"`
}

// ResponseFormat specifies the desired output format.
type ResponseFormat struct {
	Type       string          `json:"type"`
	JsonSchema *JsonSchemaSpec `json:"json_schema,omitempty"`
}

// JsonSchemaSpec defines a JSON schema for structured output.
type JsonSchemaSpec struct {
	Name        string         `json:"name"`
	Schema      map[string]any `json:"schema"`
	Description *string        `json:"description,omitempty"`
	Strict      *bool          `json:"strict,omitempty"`
}

// ChatCompletionResponse represents a chat completion response.
type ChatCompletionResponse struct {
	ID      string   `json:"id"`
	Choices []Choice `json:"choices"`
	Usage   Usage    `json:"usage"`
}

// Choice represents a single completion choice.
type Choice struct {
	Index        int             `json:"index"`
	Message      ResponseMessage `json:"message"`
	FinishReason string          `json:"finish_reason"`
}

// ResponseMessage represents the assistant's response message.
type ResponseMessage struct {
	Role      string     `json:"role"`
	Content   *string    `json:"content"`
	ToolCalls []ToolCall `json:"tool_calls,omitempty"`
}

// ToolCall represents a tool call made by the model.
type ToolCall struct {
	ID       string       `json:"id"`
	Type     string       `json:"type"`
	Function FunctionCall `json:"function"`
}

// FunctionCall represents the function invocation within a tool call.
// Arguments is json.RawMessage because llama server may return it as either
// a JSON string (OpenAI-compliant) or a JSON object (llama server bug #20198).
type FunctionCall struct {
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
}

// Usage contains token usage statistics.
type Usage struct {
	PromptTokens     int `json:"prompt_tokens"`
	CompletionTokens int `json:"completion_tokens"`
	TotalTokens      int `json:"total_tokens"`
}

// EmbeddingRequest represents a request to the /v1/embeddings endpoint.
type EmbeddingRequest struct {
	Input []string `json:"input"`
	Model string   `json:"model"`
}

// EmbeddingResponse represents a response from the /v1/embeddings endpoint.
type EmbeddingResponse struct {
	Data  []EmbeddingData `json:"data"`
	Model string          `json:"model"`
	Usage Usage           `json:"usage"`
}

// EmbeddingData represents a single embedding vector in the response.
type EmbeddingData struct {
	Embedding []float32 `json:"embedding"`
	Index     int       `json:"index"`
}

// ModelList represents the response from the /v1/models endpoint.
type ModelList struct {
	Data []ModelInfo `json:"data"`
}

// ModelInfo represents information about a single model.
type ModelInfo struct {
	ID      string `json:"id"`
	OwnedBy string `json:"owned_by,omitempty"`
}
