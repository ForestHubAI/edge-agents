// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package mistral

//go:generate go tool oapi-codegen -old-config-style -generate types,skip-prune -o ./types.gen.go -package mistral ./openapi.yaml

import (
	"encoding/json"
	"errors"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/rs/zerolog/log"
)

// toMistralRequest converts a generic ResponseRequest into a Mistral ChatRequest.
func toMistralRequest(req *llmproxy.ChatRequest) (*ChatCompletionRequest, error) {
	// Build the messages slice
	messages := []ChatCompletionRequest_Messages_Item{}

	// Add system prompt first if provided
	if req.SystemPrompt != "" {
		m := ChatCompletionRequest_Messages_Item{}
		mc := SystemMessage_Content{}
		mc.FromSystemMessageContent0(req.SystemPrompt)
		m.FromSystemMessage(SystemMessage{
			Role:    System,
			Content: mc,
		})
		messages = append(messages, m)
	}

	// Add input/user prompt
	switch input := req.Input.(type) {
	case llmproxy.InputString:
		m := ChatCompletionRequest_Messages_Item{}
		uc := UserMessage_Content{}
		uc.FromUserMessageContent0(input.String())
		m.FromUserMessage(UserMessage{
			Role:    UserMessageRoleUser,
			Content: &uc,
		})
		messages = append(messages, m)
	case llmproxy.InputItems:
		for _, item := range input {
			switch it := item.(type) {
			case llmproxy.ToolCallRequest:
				m := ChatCompletionRequest_Messages_Item{}
				am, err := functionToolCallRequestToAssistantMessage(&it)
				m.FromAssistantMessage(*am)
				if err != nil {
					return nil, err
				}
				messages = append(messages, m)
			case llmproxy.ToolResult:
				m := ChatCompletionRequest_Messages_Item{}
				// Marshal FunctionToolResult to JSON for output
				outputJSON, err := json.Marshal(it.Output)
				if err != nil {
					return nil, err
				}
				mc := ToolMessage_Content{}
				mc.FromToolMessageContent0(string(outputJSON))
				m.FromToolMessage(ToolMessage{
					Role:       ToolMessageRoleTool,
					Content:    &mc,
					Name:       &it.Name,
					ToolCallId: &it.CallID,
				})
				messages = append(messages, m)
			default:
				m := ChatCompletionRequest_Messages_Item{}
				uc := UserMessage_Content{}
				uc.FromUserMessageContent0(item.String())
				m.FromUserMessage(UserMessage{
					Role:    UserMessageRoleUser,
					Content: &uc,
				})
				messages = append(messages, m)
			}
		}
	}

	// TODO: handle PreviousResponseID or conversation ID if needed

	// Build the ChatRequest
	chatReq := &ChatCompletionRequest{
		Model:    string(req.Model),
		Messages: messages,
	}

	// Attach tools if any
	for _, tool := range req.Tools {
		switch t := tool.(type) {
		case llmproxy.ExternalTool:
			chatReq.Tools = append(chatReq.Tools, Tool{
				Type: ToolTypesFunction,
				Function: Function{
					Name:        t.ToolName(),
					Parameters:  t.ToolParams(),
					Description: pointer.Ptr(t.ToolDescription()),
					Strict:      pointer.Ptr(true),
				},
			})
		case llmproxy.WebSearch:
			log.Warn().Msg("mistral has no native web search, ignoring")
		default:
			return nil, fmt.Errorf("unsupported tool type: %T", tool)
		}
	}

	// Handle output validation if specified
	if req.ResponseFormat != nil {
		chatReq.ResponseFormat = &ResponseFormat{
			Type: ResponseFormatsJsonSchema,
			JsonSchema: &JsonSchema{
				Name:        req.ResponseFormat.Name,
				Schema:      req.ResponseFormat.Schema,
				Description: pointer.Ptr(req.ResponseFormat.Description),
				Strict:      pointer.Ptr(true),
			},
		}
	}

	// Include options
	if req.Options != nil {
		includeOptions(chatReq, *req.Options)
	}
	return chatReq, nil
}

// functionToolCallRequestToAssistantMessage converts a FunctionToolCallRequest to an AssistantMessage.
func functionToolCallRequestToAssistantMessage(it *llmproxy.ToolCallRequest) (*AssistantMessage, error) {
	args := FunctionCall_Arguments{}
	args.FromFunctionCallArguments1(string(it.Arguments))

	return &AssistantMessage{
		Role: AssistantMessageRoleAssistant,
		ToolCalls: []ToolCall{
			{
				Id:   &it.CallID,
				Type: ToolTypesFunction,
				Function: FunctionCall{
					Name:      it.Name,
					Arguments: args,
				},
			},
		},
	}, nil
}

// includeOptions maps api.Options to a Mistral ChatRequest
func includeOptions(chatReq *ChatCompletionRequest, opts llmproxy.Options) {
	if opts.MaxTokens != nil {
		v := int(*opts.MaxTokens)
		chatReq.MaxTokens = &v
	}
	if opts.Temperature != nil {
		chatReq.Temperature = pointer.Ptr(float32(*opts.Temperature))
	}
	if opts.TopP != nil {
		chatReq.TopP = pointer.Ptr(float32(*opts.TopP))
	}
	if opts.FrequencyPenalty != nil {
		chatReq.FrequencyPenalty = pointer.Ptr(float32(*opts.FrequencyPenalty))
	}
	if opts.PresencePenalty != nil {
		chatReq.PresencePenalty = pointer.Ptr(float32(*opts.PresencePenalty))
	}
	// ... Add other options as needed
}

// extractAnswer extracts the assistant's answer from the model output.
func extractAnswer(choice *ChatCompletionChoice) (string, error) {
	// TODO: handle message content if it comes as ChunkContent
	answer, err := choice.Message.Content.AsAssistantMessageContent0()
	if err != nil {
		return "", errors.New("message content is not a string")
	}
	return answer, nil
}

// extractToolCalls extracts tool calls from the model output.
func extractToolCalls(choice *ChatCompletionChoice) ([]llmproxy.ToolCallRequest, error) {
	toolCallRequests := []llmproxy.ToolCallRequest{}
	for _, tc := range choice.Message.ToolCalls {
		// Decode arguments which can be either string or map
		var argStr string
		val, err := tc.Function.Arguments.TypeSwitch()
		if err != nil {
			return nil, err
		}
		switch v := val.(type) {
		case string:
			argStr = v
		case map[string]any:
			b, err := json.Marshal(v)
			if err != nil {
				return nil, err
			}
			argStr = string(b)
		}
		toolCallRequests = append(toolCallRequests, llmproxy.ToolCallRequest{
			CallID:    *tc.Id,
			Name:      tc.Function.Name,
			Arguments: json.RawMessage(argStr),
		})
	}
	return toolCallRequests, nil
}

// TypeSwitch tries to decode FunctionCall_Arguments as string or map[string]any.
func (a FunctionCall_Arguments) TypeSwitch() (any, error) {
	var asString string
	if err := json.Unmarshal(a.union, &asString); err == nil {
		return asString, nil
	}
	var asMap map[string]any
	if err := json.Unmarshal(a.union, &asMap); err == nil {
		return asMap, nil
	}
	return nil, errors.New("FunctionCall_Arguments is neither string nor map")
}

// toAPIModel converts a Mistral ModelCard to a generic api.LLMModel.
func toAPIModel(model *ModelList_Data_Item) (*llmproxy.ModelInfo, error) {
	m, err := model.ValueByDiscriminator()
	if err != nil {
		return nil, err
	}
	switch v := m.(type) {
	case BaseModelCard:
		return &llmproxy.ModelInfo{
			ID:           llmproxy.ModelID(v.Id),
			Provider:     ProviderID,
			MaxTokens:    v.MaxContextLength,
			Capabilities: toCoreCapabilities(v.Capabilities),
		}, nil
	case FTModelCard:
		return &llmproxy.ModelInfo{
			ID:           llmproxy.ModelID(v.Id),
			Provider:     ProviderID,
			MaxTokens:    v.MaxContextLength,
			Capabilities: toCoreCapabilities(v.Capabilities),
		}, nil
	default:
		return nil, errors.New("unknown model type")
	}
}

// toCoreCapabilities maps Mistral ModelCapabilities to llmproxy.ModelCapability slice.
func toCoreCapabilities(caps ModelCapabilities) []llmproxy.ModelCapability {
	out := []llmproxy.ModelCapability{}
	if caps.CompletionChat != nil {
		out = append(out, llmproxy.CapabilityChat)
	}
	if caps.FunctionCalling != nil {
		out = append(out, llmproxy.CapabilityFunctionCall)
	}
	if caps.Vision != nil {
		out = append(out, llmproxy.CapabilityVision)
	}
	if caps.FineTuning != nil {
		out = append(out, llmproxy.CapabilityFineTuning)
	}
	if caps.Classification != nil {
		out = append(out, llmproxy.CapabilityClassification)
	}
	return out
}
