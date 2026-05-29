package gemini

import (
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider"

	"github.com/rs/zerolog/log"
	"google.golang.org/genai"
)

// toGeminiRequest converts a llmproxy.ChatRequest to Gemini SDK types.
func toGeminiRequest(req *llmproxy.ChatRequest, cfg Config) ([]*genai.Content, *genai.GenerateContentConfig, error) {
	contents, err := toGeminiContents(req.Input)
	if err != nil {
		return nil, nil, err
	}

	config := &genai.GenerateContentConfig{}

	// System instruction
	if req.SystemPrompt != "" {
		config.SystemInstruction = genai.NewContentFromText(req.SystemPrompt, "")
	}

	// Tools — external pass through, WebSearch marker becomes native if config allows.
	for _, tool := range req.Tools {
		switch t := tool.(type) {
		case llmproxy.ExternalTool:
			config.Tools = append(config.Tools, &genai.Tool{
				FunctionDeclarations: []*genai.FunctionDeclaration{
					{
						Name:        t.ToolName(),
						Description: t.ToolDescription(),
						Parameters:  toGenAISchema(t.ToolParams()),
					},
				},
			})
		case llmproxy.WebSearch:
			if ws := cfg.InternalTools.WebSearch; ws != nil {
				config.Tools = append(config.Tools, &genai.Tool{
					GoogleSearch: &genai.GoogleSearch{
						ExcludeDomains: ws.ExcludeDomains,
					},
				})
			} else {
				log.Warn().Msg("gemini: WebSearch marker passed but InternalTools.WebSearch is nil; ignoring")
			}
		default:
			return nil, nil, fmt.Errorf("unsupported tool type: %T", tool)
		}
	}

	// Structured output
	if req.ResponseFormat != nil {
		config.ResponseMIMEType = "application/json"
		config.ResponseSchema = toGenAISchema(req.ResponseFormat.Schema)
	}

	// Options
	if req.Options != nil {
		includeOptions(config, *req.Options)
	}

	return contents, config, nil
}

// toGeminiContents converts llmproxy.Input to Gemini Content objects.
func toGeminiContents(input llmproxy.Input) ([]*genai.Content, error) {
	switch inp := input.(type) {
	case llmproxy.InputString:
		return []*genai.Content{
			genai.NewContentFromText(inp.String(), "user"),
		}, nil
	case llmproxy.InputItems:
		var contents []*genai.Content
		for _, item := range inp {
			switch it := item.(type) {
			case llmproxy.ToolCallRequest:
				args := map[string]any{}
				if len(it.Arguments) > 0 {
					if err := json.Unmarshal(it.Arguments, &args); err != nil {
						return nil, fmt.Errorf("failed to unmarshal tool call arguments: %w", err)
					}
				}
				contents = append(contents, &genai.Content{
					Role: "model",
					Parts: []*genai.Part{
						genai.NewPartFromFunctionCall(it.Name, args),
					},
				})
			case llmproxy.ToolResult:
				respMap, ok := it.Output.(map[string]any)
				if !ok {
					respMap = map[string]any{"result": it.Output}
				}
				contents = append(contents, &genai.Content{
					Role: "user",
					Parts: []*genai.Part{
						genai.NewPartFromFunctionResponse(it.Name, respMap),
					},
				})
			default:
				contents = append(contents, genai.NewContentFromText(item.String(), "user"))
			}
		}
		return contents, nil
	}
	return nil, fmt.Errorf("unsupported input type: %T", input)
}

// includeOptions maps llmproxy.Options to GenerateContentConfig fields.
func includeOptions(config *genai.GenerateContentConfig, opts llmproxy.Options) {
	if opts.MaxTokens != nil {
		config.MaxOutputTokens = int32(*opts.MaxTokens)
	}
	if opts.Temperature != nil {
		config.Temperature = genai.Ptr(float32(*opts.Temperature))
	}
	if opts.TopP != nil {
		config.TopP = genai.Ptr(float32(*opts.TopP))
	}
	if opts.TopK != nil {
		config.TopK = genai.Ptr(float32(*opts.TopK))
	}
	if opts.Seed != nil {
		config.Seed = genai.Ptr(int32(*opts.Seed))
	}
	if opts.FrequencyPenalty != nil {
		config.FrequencyPenalty = genai.Ptr(float32(*opts.FrequencyPenalty))
	}
	if opts.PresencePenalty != nil {
		config.PresencePenalty = genai.Ptr(float32(*opts.PresencePenalty))
	}
}

// fromGeminiResponse converts a Gemini GenerateContentResponse to llmproxy.ChatResponse.
func fromGeminiResponse(resp *genai.GenerateContentResponse) (*llmproxy.ChatResponse, error) {
	if resp == nil {
		return nil, fmt.Errorf("nil response from Gemini API")
	}

	// Check for safety blocks
	if len(resp.Candidates) > 0 && resp.Candidates[0].FinishReason == genai.FinishReasonSafety {
		return nil, fmt.Errorf("%w: blocked by safety filter", provider.ErrIncompleteResponse)
	}

	// Extract text and tool calls
	text := resp.Text()
	toolCallRequests, err := extractToolCalls(resp)
	if err != nil {
		return nil, err
	}
	citations := extractCitations(resp)

	// Token usage
	var inputTokens, outputTokens, tokensUsed int
	if resp.UsageMetadata != nil {
		inputTokens = int(resp.UsageMetadata.PromptTokenCount)
		outputTokens = int(resp.UsageMetadata.CandidatesTokenCount)
		tokensUsed = int(resp.UsageMetadata.TotalTokenCount)
	}

	// Incomplete response check (non-safety)
	var incompleteErr error
	if len(resp.Candidates) > 0 {
		fr := resp.Candidates[0].FinishReason
		if fr != "" && fr != genai.FinishReasonStop && fr != genai.FinishReasonSafety {
			incompleteErr = fmt.Errorf("%w: %s", provider.ErrIncompleteResponse, fr)
		}
	}

	return &llmproxy.ChatResponse{
		Text:             text,
		Citations:        citations,
		ToolCallRequests: toolCallRequests,
		ResponseID:       fmt.Sprintf("gemini-%d", tokensUsed),
		InputTokens:      inputTokens,
		OutputTokens:     outputTokens,
		TokensUsed:       tokensUsed,
	}, incompleteErr
}

// extractToolCalls extracts external function tool call requests.
func extractToolCalls(resp *genai.GenerateContentResponse) ([]llmproxy.ToolCallRequest, error) {
	if resp == nil {
		return nil, nil
	}
	var out []llmproxy.ToolCallRequest
	for i, fc := range resp.FunctionCalls() {
		argsJSON, err := json.Marshal(fc.Args)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal function call args for %s: %w", fc.Name, err)
		}
		out = append(out, llmproxy.ToolCallRequest{
			CallID:    fmt.Sprintf("call_%s_%d", fc.Name, i),
			Name:      fc.Name,
			Arguments: json.RawMessage(argsJSON),
		})
	}
	return out, nil
}

// extractCitations pulls per-segment grounding supports out of the response.
// Populated when Gemini's native Google Search grounding ran.
func extractCitations(resp *genai.GenerateContentResponse) []llmproxy.Citation {
	if resp == nil || len(resp.Candidates) == 0 || resp.Candidates[0].GroundingMetadata == nil {
		return nil
	}
	gm := resp.Candidates[0].GroundingMetadata
	var out []llmproxy.Citation
	for _, sup := range gm.GroundingSupports {
		if sup == nil || sup.Segment == nil {
			continue
		}
		for _, idx := range sup.GroundingChunkIndices {
			if int(idx) >= len(gm.GroundingChunks) {
				continue
			}
			chunk := gm.GroundingChunks[idx]
			if chunk == nil || chunk.Web == nil {
				continue
			}
			out = append(out, llmproxy.Citation{
				URL:      chunk.Web.URI,
				Title:    chunk.Web.Title,
				Snippet:  sup.Segment.Text,
				StartIdx: int(sup.Segment.StartIndex),
				EndIdx:   int(sup.Segment.EndIndex),
			})
		}
	}
	return out
}

// toGenAISchema recursively converts a JSON Schema (map[string]any) to a genai.Schema.
func toGenAISchema(schema map[string]any) *genai.Schema {
	// Collect root-level $defs so nested $ref can be resolved.
	defs, _ := schema["$defs"].(map[string]any)
	return convertSchema(schema, defs)
}

// convertSchema does the recursive conversion, carrying root $defs for $ref resolution.
func convertSchema(schema map[string]any, defs map[string]any) *genai.Schema {
	if schema == nil {
		return nil
	}

	// Resolve $ref first — replace schema with the referenced definition.
	if ref, ok := schema["$ref"].(string); ok {
		if resolved := resolveRef(ref, defs); resolved != nil {
			return convertSchema(resolved, defs)
		}
	}

	s := &genai.Schema{}

	if t, ok := schema["type"].(string); ok {
		switch t {
		case "string":
			s.Type = genai.TypeString
		case "number":
			s.Type = genai.TypeNumber
		case "integer":
			s.Type = genai.TypeInteger
		case "boolean":
			s.Type = genai.TypeBoolean
		case "array":
			s.Type = genai.TypeArray
		case "object":
			s.Type = genai.TypeObject
		}
	}

	if desc, ok := schema["description"].(string); ok {
		s.Description = desc
	}

	if enum, ok := schema["enum"].([]any); ok {
		for _, e := range enum {
			if str, ok := e.(string); ok {
				s.Enum = append(s.Enum, str)
			}
		}
	}

	if required, ok := schema["required"].([]any); ok {
		for _, r := range required {
			if str, ok := r.(string); ok {
				s.Required = append(s.Required, str)
			}
		}
	}

	if props, ok := schema["properties"].(map[string]any); ok {
		s.Properties = make(map[string]*genai.Schema)
		for key, val := range props {
			if propMap, ok := val.(map[string]any); ok {
				s.Properties[key] = convertSchema(propMap, defs)
			}
		}
	}

	if items, ok := schema["items"].(map[string]any); ok {
		s.Items = convertSchema(items, defs)
	}

	return s
}

// resolveRef resolves a $ref string like "#/$defs/MyType" against a $defs map.
func resolveRef(ref string, defs map[string]any) map[string]any {
	// Expected format: "#/$defs/TypeName"
	const prefix = "#/$defs/"
	if len(ref) <= len(prefix) {
		return nil
	}
	name := ref[len(prefix):]
	if def, ok := defs[name].(map[string]any); ok {
		return def
	}
	return nil
}
