// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package llmproxy

import (
	"io"

	"github.com/ForestHubAI/edge-agents/go/llmproxy/schemautil"
)

// ContentType represents the MIME type of a file.
type ContentType string

// revive:disable
const (
	ContentTypePlainText ContentType = "text/plain"
	ContentTypeCSV       ContentType = "text/csv"
	ContentTypePNG       ContentType = "image/png"
	ContentTypeJPEG      ContentType = "image/jpeg"
	ContentTypePDF       ContentType = "application/pdf"
	ContentTypeJSON      ContentType = "application/json"
	ContentTypeZIP       ContentType = "application/zip"
)

// revive:enable

// FileID represents the ID of an uploaded file.
type FileID string

// ChatRequest represents a request to generate a response from an LLM.
type ChatRequest struct {
	// Model is the model name.
	Model ModelID `json:"model"`

	// Input is the runtime input to the model. Can be a simple prompt in form of an InputString or a list of InputItem.
	Input Input `json:"input"`

	// SystemPrompt overrides the model's default system message/prompt.
	// Needs to be re-supplied for each request, even if PreviousResponseID is used.
	SystemPrompt string `json:"systemPrompt,omitempty"`

	// PreviousResponseID is the ID of a previous response that will be passed as context
	// to the next response, allowing for multi-turn conversations.
	// This does not store full conversation history.
	PreviousResponseID string `json:"previousResponseID,omitempty"`

	// ResponseFormat specifies a structured JSON response format.
	// If provided, the model is forced to respond in the specified format if supported by the model.
	ResponseFormat *ResponseFormat `json:"responseFormat,omitempty"`

	// Tools is an optional list of tools to be made available to the model/agent
	Tools []Tool `json:"tools,omitempty"`

	// FileIDs is an optional list of uploaded file IDs accompanying this
	// request, for models that can use files as context.
	FileIDs []FileID `json:"fileIDs,omitempty"`

	// ImageIDs is an optional list of image file IDs accompanying this
	// request, for multimodal models.
	ImageIDs []FileID `json:"imageIDs,omitempty"`

	// ImageURLs is an optional list of image URLs accompanying this
	// request, for multimodal models that can fetch images from URLs.
	ImageURLs []string `json:"imageURLs,omitempty"`

	// Options lists model-specific options. For example, temperature can be
	// set through this field, if the model supports it.
	Options *Options `json:"options,omitempty"`
}

// NewChatRequest creates a new GenerateRequest with the given arguments.
func NewChatRequest(model ModelID, input Input, opts ...Option) *ChatRequest {
	req := &ChatRequest{
		Model: model,
		Input: input,
	}
	// Apply functional options
	if len(opts) > 0 {
		req.Options = &Options{}
		for _, opt := range opts {
			opt(req.Options)
		}
	}
	return req
}

// ResponseFormat defines a structured JSON response format for LLM outputs.
type ResponseFormat struct {
	Name        string         `json:"name"`
	Schema      map[string]any `json:"schema"`
	Description string         `json:"description,omitempty"`
}

// NewResponseFormat creates a new ResponseFormat based on the provided type T.
// T can not have fields marked as 'omitempty' to ensure required fields in the schema.
func NewResponseFormat[T any](name string, description string) (*ResponseFormat, error) {
	schema, err := schemautil.ToStrictJSONSchema[T]()
	if err != nil {
		return nil, err
	}

	return &ResponseFormat{
		Name:        name,
		Schema:      schema,
		Description: description,
	}, nil
}

// Citation is a source reference attached to a span of assistant-generated text.
// Populated when the model grounds its output (e.g. native web search). Populated
// best-effort: providers that don't emit structured citations leave this empty.
type Citation struct {
	// URL is the cited source.
	URL string `json:"url"`

	// Title is the source's title (optional).
	Title string `json:"title,omitempty"`

	// Snippet is the cited text excerpt from the source (optional).
	Snippet string `json:"snippet,omitempty"`

	// StartIdx is the start offset into the assistant message text (optional).
	StartIdx int `json:"startIdx,omitempty"`

	// EndIdx is the end offset into the assistant message text (optional).
	EndIdx int `json:"endIdx,omitempty"`
}

// ChatResponse represents a response from the LLM
type ChatResponse struct {
	// Text is the generated response text.
	Text string `json:"text,omitempty"`

	// Citations are source references attached to spans of the assistant text.
	// Populated when the model grounds its output; empty otherwise.
	Citations []Citation `json:"citations,omitempty"`

	// ToolCallRequests are requests made by the model to call function tools as next action.
	ToolCallRequests []ToolCallRequest `json:"toolCallRequests,omitempty"`

	// ResponseID is the unique ID of this response.
	ResponseID string

	// InputTokens is the number of input/prompt tokens consumed.
	InputTokens int

	// OutputTokens is the number of output/completion tokens consumed.
	OutputTokens int

	// TokensUsed indicates the total number of tokens used in this response. This may be more than the sum of
	// InputTokens and OutputTokens for some providers.
	TokensUsed int
}

// FileUploadRequest represents a file upload
type FileUploadRequest struct {
	// File is the file content as an io.ReadCloser.
	File io.ReadCloser `json:"file"`

	// FileName is the name of the file, including its extension.
	FileName string `json:"fileName"`

	// FileType is the MIME type of the file (e.g., "application/pdf", "image/png", "text/plain").
	FileType ContentType `json:"fileType"`

	// Purpose is an optional description of the file's intended use.
	Purpose string `json:"purpose,omitempty"`

	// ProviderID specifies the target LLM provider for the file upload.
	ProviderID ProviderID `json:"providerID"`
}

// FileDeleteRequest represents a file deletion request
type FileDeleteRequest struct {
	// FileID is the unique identifier of the file to be deleted.
	FileID FileID `json:"fileID"`

	// ProviderID specifies the target LLM provider from which to delete the file.
	ProviderID ProviderID `json:"providerID"`
}

// FileUploadResponse represents an uploaded file result
type FileUploadResponse struct {
	FileID   FileID
	FileName string
}

// EmbeddingRequest represents a request to generate embeddings from text inputs.
type EmbeddingRequest struct {
	// Model is the embedding model to use.
	Model ModelID

	// Inputs is the list of text strings to embed.
	Inputs []string
}

// EmbeddingResponse represents the result of an embedding request.
type EmbeddingResponse struct {
	// Embeddings contains the embedding vectors, one per input.
	Embeddings [][]float32

	// Model is the model that was used to generate the embeddings.
	Model string

	// TokensUsed is the total number of tokens consumed.
	TokensUsed int

	// InputTokens is the number of input/prompt tokens consumed.
	InputTokens int

	// OutputTokens is the number of output/completion tokens consumed.
	OutputTokens int
}
