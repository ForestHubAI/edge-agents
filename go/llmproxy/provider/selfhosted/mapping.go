// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package selfhosted

import (
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/rs/zerolog/log"
)

// toLocalRequest converts a llmproxy.ChatRequest into a local ChatCompletionRequest.
func toLocalRequest(req *llmproxy.ChatRequest) (*ChatCompletionRequest, error) {
	if len(req.FileIDs) > 0 || len(req.ImageIDs) > 0 || len(req.ImageURLs) > 0 {
		return nil, fmt.Errorf("referencing files/images in chat not supported by local provider: %w", provider.ErrNotSupported)
	}

	var messages []Message

	// System prompt
	if req.SystemPrompt != "" {
		messages = append(messages, Message{Role: "system", Content: req.SystemPrompt})
	}

	// Input
	switch input := req.Input.(type) {
	case llmproxy.InputString:
		messages = append(messages, Message{Role: "user", Content: input.String()})
	case llmproxy.InputItems:
		for _, item := range input {
			switch it := item.(type) {
			case llmproxy.ToolCallRequest:
				messages = append(messages, Message{
					Role: "assistant",
					ToolCalls: []ToolCall{
						{
							ID:   it.CallID,
							Type: "function",
							Function: FunctionCall{
								Name:      it.Name,
								Arguments: it.Arguments,
							},
						},
					},
				})
			case llmproxy.ToolResult:
				outputJSON, err := json.Marshal(it.Output)
				if err != nil {
					return nil, fmt.Errorf("failed to marshal tool result: %w", err)
				}
				messages = append(messages, Message{
					Role:       "tool",
					Content:    string(outputJSON),
					ToolCallID: &it.CallID,
				})
			default:
				messages = append(messages, Message{Role: "user", Content: item.String()})
			}
		}
	}

	chatReq := &ChatCompletionRequest{
		Model:    string(req.Model),
		Messages: messages,
	}

	// Tools
	for _, tool := range req.Tools {
		switch t := tool.(type) {
		case llmproxy.ExternalTool:
			chatReq.Tools = append(chatReq.Tools, Tool{
				Type: "function",
				Function: FunctionDef{
					Name:        t.ToolName(),
					Description: pointer.Ptr(t.ToolDescription()),
					Parameters:  t.ToolParams(),
					Strict:      pointer.Ptr(true),
				},
			})
		case llmproxy.WebSearch:
			log.Warn().Msg("selfhosted: WebSearch marker passed; selfhosted has no native web search, ignoring")
		default:
			return nil, fmt.Errorf("unsupported tool type: %T", tool)
		}
	}

	// Response format
	if req.ResponseFormat != nil {
		chatReq.ResponseFormat = &ResponseFormat{
			Type: "json_schema",
			JsonSchema: &JsonSchemaSpec{
				Name:        req.ResponseFormat.Name,
				Schema:      req.ResponseFormat.Schema,
				Description: pointer.Ptr(req.ResponseFormat.Description),
				Strict:      pointer.Ptr(true),
			},
		}
	}

	// Options
	if req.Options != nil {
		includeOptions(chatReq, *req.Options)
	}

	return chatReq, nil
}

// includeOptions maps llmproxy.Options to the local ChatCompletionRequest fields.
func includeOptions(req *ChatCompletionRequest, opts llmproxy.Options) {
	if opts.MaxTokens != nil {
		req.MaxTokens = opts.MaxTokens
	}
	if opts.Temperature != nil {
		req.Temperature = opts.Temperature
	}
	if opts.TopP != nil {
		req.TopP = opts.TopP
	}
	if opts.FrequencyPenalty != nil {
		req.FrequencyPenalty = opts.FrequencyPenalty
	}
	if opts.PresencePenalty != nil {
		req.PresencePenalty = opts.PresencePenalty
	}
}

// extractAnswer extracts the text content from a response choice.
func extractAnswer(choice *Choice) string {
	if choice.Message.Content == nil {
		return ""
	}
	return *choice.Message.Content
}

// extractToolCalls converts response tool calls to llmproxy.ToolCallRequest.
// Arguments may arrive as either a JSON string or a JSON object depending
// on the inference server implementation.
func extractToolCalls(choice *Choice) ([]llmproxy.ToolCallRequest, error) {
	var toolCalls []llmproxy.ToolCallRequest
	for _, tc := range choice.Message.ToolCalls {
		args := tc.Function.Arguments

		// If arguments is a JSON string (e.g. "\"{ ... }\""), unwrap it
		if len(args) > 0 && args[0] == '"' {
			var unwrapped string
			if err := json.Unmarshal(args, &unwrapped); err != nil {
				return nil, fmt.Errorf("failed to unwrap tool call arguments string: %w", err)
			}
			args = json.RawMessage(unwrapped)
		}

		toolCalls = append(toolCalls, llmproxy.ToolCallRequest{
			CallID:    tc.ID,
			Name:      tc.Function.Name,
			Arguments: args,
		})
	}
	return toolCalls, nil
}
