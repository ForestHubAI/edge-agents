// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package openai

import (
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	openai "github.com/openai/openai-go/v2"
	"github.com/openai/openai-go/v2/packages/param"
	"github.com/openai/openai-go/v2/responses"
	"github.com/rs/zerolog/log"
)

// toOpenAIRequest converts domain.ChatRequest to responses.ResponseNewParams
func toOpenAIRequest(req *llmproxy.ChatRequest, cfg Config) (*responses.ResponseNewParams, error) {
	inputItems, err := toOpenAIInput(req)
	if err != nil {
		return nil, err
	}
	// Build request object
	params := responses.ResponseNewParams{
		Model: string(req.Model),
		Input: responses.ResponseNewParamsInputUnion{
			// Always use item list for input so optional files/images can be attached
			OfInputItemList: inputItems,
		},
		//Conversation: nil, // Not using conversation ID for now (persistent conversations)
	}

	// Add system prompt if provided
	if req.SystemPrompt != "" {
		params.Instructions = openai.String(req.SystemPrompt)
	}

	// Attach tools if any
	for _, tool := range req.Tools {
		switch t := tool.(type) {
		case llmproxy.ExternalTool:
			params.Tools = append(params.Tools, responses.ToolUnionParam{
				OfFunction: &responses.FunctionToolParam{
					Name:        t.ToolName(),
					Parameters:  t.ToolParams(),
					Description: optFromString(t.ToolDescription()),
				},
			})
		case llmproxy.WebSearch:
			if ws := cfg.InternalTools.WebSearch; ws != nil {
				params.Tools = append(params.Tools, buildNativeWebSearch(ws))
			} else {
				log.Warn().Msg("openai: WebSearch marker passed but InternalTools.WebSearch is nil; ignoring")
			}
		default:
			return nil, fmt.Errorf("unsupported tool type: %T", tool)
		}
	}

	// Add output validation if provided
	if req.ResponseFormat != nil {
		params.Text = responses.ResponseTextConfigParam{
			Format: responses.ResponseFormatTextConfigUnionParam{
				OfJSONSchema: &responses.ResponseFormatTextJSONSchemaConfigParam{
					Name:        req.ResponseFormat.Name,
					Schema:      req.ResponseFormat.Schema,
					Strict:      openai.Bool(true),
					Description: optFromString(req.ResponseFormat.Description),
					Type:        "json_schema",
				},
			},
		}
	}

	// Optionally set PreviousResponseID. This does not store full conversation history, see
	// [conversation state](https://platform.openai.com/docs/guides/conversation-state)
	if req.PreviousResponseID != "" {
		params.PreviousResponseID = openai.String(req.PreviousResponseID)
	}
	// Include optional parameters
	if req.Options != nil {
		includeOptions(&params, *req.Options)
	}
	return &params, nil
}

func toOpenAIInput(req *llmproxy.ChatRequest) ([]responses.ResponseInputItemUnionParam, error) {
	messages := []responses.ResponseInputItemUnionParam{}

	// Add input / user prompt
	switch input := req.Input.(type) {
	case llmproxy.InputString:
		messages = append(messages, responses.ResponseInputItemUnionParam{
			OfMessage: &responses.EasyInputMessageParam{
				Role: "user",
				Content: responses.EasyInputMessageContentUnionParam{
					OfString: openai.String(input.String()),
				},
			},
		})
	case llmproxy.InputItems:
		for _, item := range input {
			switch it := item.(type) {
			case llmproxy.ToolCallRequest:
				messages = append(messages, responses.ResponseInputItemUnionParam{
					OfFunctionCall: &responses.ResponseFunctionToolCallParam{
						Arguments: string(it.Arguments),
						CallID:    it.CallID,
						Name:      it.Name,
					},
				})
			case llmproxy.ToolResult:
				// Marshal FunctionToolResult to JSON for output
				outputJSON, err := json.Marshal(it.Output)
				if err != nil {
					return nil, err
				}
				messages = append(messages, responses.ResponseInputItemUnionParam{
					OfFunctionCallOutput: &responses.ResponseInputItemFunctionCallOutputParam{
						CallID: it.CallID,
						Output: string(outputJSON),
					},
				})
			// All other input item types are treated as text messages
			default:
				messages = append(messages, responses.ResponseInputItemUnionParam{
					OfMessage: &responses.EasyInputMessageParam{
						Role: "user",
						Content: responses.EasyInputMessageContentUnionParam{
							OfString: openai.String(item.String()),
						},
					},
				})
			}
		}
	}

	// Attach files if provided
	inputs := []responses.ResponseInputContentUnionParam{}
	for _, fileID := range req.FileIDs {
		inputs = append(inputs, responses.ResponseInputContentUnionParam{
			OfInputFile: &responses.ResponseInputFileParam{
				FileID: openai.String(string(fileID)),
				Type:   "input_file",
			},
		})
	}
	// Attach all uploaded images that should be used as context
	for _, imageID := range req.ImageIDs {
		inputs = append(inputs, responses.ResponseInputContentUnionParam{
			OfInputImage: &responses.ResponseInputImageParam{
				FileID: openai.String(string(imageID)),
				Type:   "input_image",
			},
		})
	}
	// Add image URLs
	for _, url := range req.ImageURLs {
		inputs = append(inputs, responses.ResponseInputContentUnionParam{
			OfInputImage: &responses.ResponseInputImageParam{
				ImageURL: openai.String(url),
				Type:     "input_image",
			},
		})
	}
	// If we have any inputs, add them in a separate user message
	if len(inputs) > 0 {
		messages = append(messages, responses.ResponseInputItemUnionParam{
			OfMessage: &responses.EasyInputMessageParam{
				Role: "user",
				Content: responses.EasyInputMessageContentUnionParam{
					OfInputItemContentList: inputs,
				},
			},
		})
	}

	return messages, nil
}

// includeOptions maps api.Options to responses.ResponseNewParams
func includeOptions(params *responses.ResponseNewParams, opts llmproxy.Options) {
	if opts.MaxTokens != nil {
		params.MaxOutputTokens = openai.Int(int64(*opts.MaxTokens))
	}
	if opts.Temperature != nil {
		params.Temperature = openai.Float(float64(*opts.Temperature))
	}
	// ... Add other options as needed
}

// extractToolCalls extracts external tool call requests from the model output.
// Internal tool invocations (e.g. native web_search) are not returned here —
// their grounded output appears as URL citations on output_text annotations,
// extracted separately in extractTextAndCitations.
func extractToolCalls(resp *responses.Response) []llmproxy.ToolCallRequest {
	out := []llmproxy.ToolCallRequest{}
	for _, item := range resp.Output {
		if v, ok := item.AsAny().(responses.ResponseFunctionToolCall); ok {
			out = append(out, llmproxy.ToolCallRequest{
				CallID:    v.CallID,
				Name:      v.Name,
				Arguments: json.RawMessage(v.Arguments),
			})
		}
	}
	return out
}

// extractTextAndCitations walks the response output items, concatenating
// assistant text and collecting any URL citations attached as annotations.
// Citations are emitted by OpenAI when native web_search ran.
func extractTextAndCitations(resp *responses.Response) (string, []llmproxy.Citation) {
	var text string
	var citations []llmproxy.Citation
	for _, item := range resp.Output {
		msg, ok := item.AsAny().(responses.ResponseOutputMessage)
		if !ok {
			continue
		}
		for _, c := range msg.Content {
			ot, ok := c.AsAny().(responses.ResponseOutputText)
			if !ok {
				continue
			}
			offset := len(text)
			text += ot.Text
			for _, a := range ot.Annotations {
				if url, ok := a.AsAny().(responses.ResponseOutputTextAnnotationURLCitation); ok {
					citations = append(citations, llmproxy.Citation{
						URL:      url.URL,
						Title:    url.Title,
						StartIdx: offset + int(url.StartIndex),
						EndIdx:   offset + int(url.EndIndex),
					})
				}
			}
		}
	}
	return text, citations
}

// buildNativeWebSearch builds the OpenAI-side native web_search tool param
// from the per-provider config.
func buildNativeWebSearch(ws *WebSearchConfig) responses.ToolUnionParam {
	size := responses.WebSearchToolSearchContextSizeLow
	switch ws.ContextSize {
	case SearchContextSizeMedium:
		size = responses.WebSearchToolSearchContextSizeMedium
	case SearchContextSizeHigh:
		size = responses.WebSearchToolSearchContextSizeHigh
	}
	return responses.ToolUnionParam{
		OfWebSearch: &responses.WebSearchToolParam{
			Type:              responses.WebSearchToolTypeWebSearch,
			SearchContextSize: size,
		},
	}
}

// optFromString converts a string to param.Opt[string], treating empty string as omitted
func optFromString(s string) param.Opt[string] {
	if s == "" {
		return param.Opt[string]{} // omitted
	}
	return param.NewOpt(s) // included
}
