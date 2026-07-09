// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package anthropic

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"

	anthropicsdk "github.com/anthropics/anthropic-sdk-go"
	"github.com/anthropics/anthropic-sdk-go/packages/param"
	"github.com/rs/zerolog/log"
)

// toAnthropicRequest converts a llmproxy.ChatRequest to Anthropic MessageNewParams.
func toAnthropicRequest(req *llmproxy.ChatRequest, cfg Config) (anthropicsdk.MessageNewParams, error) {
	messages, err := toAnthropicMessages(req.Input)
	if err != nil {
		return anthropicsdk.MessageNewParams{}, err
	}

	// MaxTokens is REQUIRED by Anthropic — default to 4096 if not set.
	maxTokens := defaultMaxTokens
	if req.Options != nil && req.Options.MaxTokens != nil {
		maxTokens = int64(*req.Options.MaxTokens)
	}

	params := anthropicsdk.MessageNewParams{
		Model:     anthropicsdk.Model(req.Model),
		MaxTokens: maxTokens,
		Messages:  messages,
	}

	// System prompt
	if req.SystemPrompt != "" {
		params.System = []anthropicsdk.TextBlockParam{
			{Text: req.SystemPrompt},
		}
	}

	// Tools — external pass through, WebSearch marker becomes native if config allows.
	for _, tool := range req.Tools {
		switch t := tool.(type) {
		case llmproxy.ExternalTool:
			params.Tools = append(params.Tools, anthropicsdk.ToolUnionParam{
				OfTool: &anthropicsdk.ToolParam{
					Name:        t.ToolName(),
					Description: param.NewOpt(t.ToolDescription()),
					InputSchema: toToolInputSchema(t.ToolParams()),
				},
			})
		case llmproxy.WebSearch:
			if ws := cfg.InternalTools.WebSearch; ws != nil {
				params.Tools = append(params.Tools, buildNativeWebSearch(ws))
			} else {
				log.Warn().Msg("anthropic: WebSearch marker passed but InternalTools.WebSearch is nil; ignoring")
			}
		default:
			return anthropicsdk.MessageNewParams{}, fmt.Errorf("unsupported tool type: %T", tool)
		}
	}

	// Structured output (native JSON schema output)
	if req.ResponseFormat != nil {
		params.OutputConfig = anthropicsdk.OutputConfigParam{
			Format: anthropicsdk.JSONOutputFormatParam{
				Schema: req.ResponseFormat.Schema,
			},
		}
	}

	// Options
	if req.Options != nil {
		includeOptions(&params, *req.Options)
	}

	return params, nil
}

// toAnthropicMessages converts llmproxy.Input to Anthropic MessageParam slices.
// Handles merging consecutive same-role messages (Anthropic requires alternating roles).
func toAnthropicMessages(input llmproxy.Input) ([]anthropicsdk.MessageParam, error) {
	switch inp := input.(type) {
	case llmproxy.InputString:
		return []anthropicsdk.MessageParam{
			anthropicsdk.NewUserMessage(anthropicsdk.NewTextBlock(string(inp))),
		}, nil
	case llmproxy.InputItems:
		var messages []anthropicsdk.MessageParam
		for _, item := range inp {
			var role anthropicsdk.MessageParamRole
			var blocks []anthropicsdk.ContentBlockParamUnion

			switch it := item.(type) {
			case llmproxy.ToolCallRequest:
				role = anthropicsdk.MessageParamRoleAssistant
				blocks = []anthropicsdk.ContentBlockParamUnion{
					anthropicsdk.NewToolUseBlock(it.CallID, it.Arguments, it.Name),
				}
			case llmproxy.ToolResult:
				role = anthropicsdk.MessageParamRoleUser
				outputJSON, err := json.Marshal(it.Output)
				if err != nil {
					return nil, fmt.Errorf("failed to marshal tool result: %w", err)
				}
				blocks = []anthropicsdk.ContentBlockParamUnion{
					anthropicsdk.NewToolResultBlock(it.CallID, string(outputJSON), false),
				}
			default:
				role = anthropicsdk.MessageParamRoleUser
				blocks = []anthropicsdk.ContentBlockParamUnion{
					anthropicsdk.NewTextBlock(item.String()),
				}
			}

			// Merge consecutive same-role messages
			if n := len(messages); n > 0 && messages[n-1].Role == role {
				messages[n-1].Content = append(messages[n-1].Content, blocks...)
			} else {
				messages = append(messages, anthropicsdk.MessageParam{
					Role:    role,
					Content: blocks,
				})
			}
		}
		return messages, nil
	}
	return nil, fmt.Errorf("unsupported input type: %T", input)
}

// includeOptions maps llmproxy.Options to MessageNewParams fields.
// MaxTokens is handled in toAnthropicRequest; FrequencyPenalty, PresencePenalty, Seed are unsupported.
func includeOptions(params *anthropicsdk.MessageNewParams, opts llmproxy.Options) {
	if opts.Temperature != nil {
		params.Temperature = param.NewOpt(float64(*opts.Temperature))
	}
	if opts.TopP != nil {
		params.TopP = param.NewOpt(float64(*opts.TopP))
	}
	if opts.TopK != nil {
		params.TopK = param.NewOpt(int64(*opts.TopK))
	}
}

// toToolInputSchema converts a JSON Schema map to ToolInputSchemaParam.
func toToolInputSchema(schema map[string]any) anthropicsdk.ToolInputSchemaParam {
	s := anthropicsdk.ToolInputSchemaParam{}

	if props, ok := schema["properties"]; ok {
		s.Properties = props
	}
	if req, ok := schema["required"].([]any); ok {
		for _, r := range req {
			if str, ok := r.(string); ok {
				s.Required = append(s.Required, str)
			}
		}
	}

	// Pass any additional fields (e.g. "additionalProperties", "$defs")
	extra := make(map[string]any)
	for k, v := range schema {
		if k != "type" && k != "properties" && k != "required" {
			extra[k] = v
		}
	}
	if len(extra) > 0 {
		s.ExtraFields = extra
	}

	return s
}

// fromAnthropicResponse converts an Anthropic Message to llmproxy.ChatResponse.
func fromAnthropicResponse(msg *anthropicsdk.Message) (*llmproxy.ChatResponse, error) {
	text, toolCalls, citations := extractContent(msg.Content)

	inputTokens := int(msg.Usage.InputTokens)
	outputTokens := int(msg.Usage.OutputTokens)

	resp := &llmproxy.ChatResponse{
		Text:             text,
		Citations:        citations,
		ToolCallRequests: toolCalls,
		ResponseID:       msg.ID,
		InputTokens:      inputTokens,
		OutputTokens:     outputTokens,
		TokensUsed:       inputTokens + outputTokens,
	}

	// Incomplete response check
	if msg.StopReason == anthropicsdk.StopReasonMaxTokens {
		return resp, fmt.Errorf("%w: max_tokens", provider.ErrIncompleteResponse)
	}

	return resp, nil
}

// extractContent walks the response content blocks and pulls out the assistant
// text, any external tool call requests, and citations attached to text blocks
// (populated when Anthropic's native web_search ran).
func extractContent(content []anthropicsdk.ContentBlockUnion) (string, []llmproxy.ToolCallRequest, []llmproxy.Citation) {
	var sb strings.Builder
	var toolCalls []llmproxy.ToolCallRequest
	var citations []llmproxy.Citation

	for _, block := range content {
		switch b := block.AsAny().(type) {
		case anthropicsdk.TextBlock:
			start := sb.Len()
			sb.WriteString(b.Text)
			end := sb.Len()
			for _, c := range b.Citations {
				if loc, ok := c.AsAny().(anthropicsdk.CitationsWebSearchResultLocation); ok {
					citations = append(citations, llmproxy.Citation{
						URL:      loc.URL,
						Title:    loc.Title,
						Snippet:  loc.CitedText,
						StartIdx: start,
						EndIdx:   end,
					})
				}
			}
		case anthropicsdk.ToolUseBlock:
			toolCalls = append(toolCalls, llmproxy.ToolCallRequest{
				CallID:    b.ID,
				Name:      b.Name,
				Arguments: b.Input,
			})
		}
	}

	return sb.String(), toolCalls, citations
}

// buildNativeWebSearch builds the Anthropic-side native web_search tool param
// from the per-provider config.
func buildNativeWebSearch(ws *WebSearchConfig) anthropicsdk.ToolUnionParam {
	p := &anthropicsdk.WebSearchTool20250305Param{
		AllowedDomains: ws.AllowedDomains,
		BlockedDomains: ws.BlockedDomains,
	}
	if ws.MaxUses > 0 {
		p.MaxUses = param.NewOpt(int64(ws.MaxUses))
	}
	return anthropicsdk.ToolUnionParam{OfWebSearchTool20250305: p}
}
