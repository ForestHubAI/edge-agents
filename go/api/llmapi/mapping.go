package llmapi

// Domain<->api mapping for the LLM-proxy contract. Imports llmproxy (the domain).
// That import direction makes `llmproxy -> llmapi` a compile-time cycle, so
// it is structurally impossible for the llmproxy package to depend on
// api types. Wire identifiers are unqualified here (same package); domain
// identifiers are llmproxy-qualified.

import (
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"

	"github.com/ForestHubAI/fh-core/go/llmproxy"
	"github.com/ForestHubAI/fh-core/go/llmproxy/schemautil"
	"github.com/ForestHubAI/fh-core/go/util/mapping"
	"github.com/ForestHubAI/fh-core/go/util/pointer"
)

// LLMOptionsToDomain converts API LLM options to core options.
func LLMOptionsToDomain(in *Options) *llmproxy.Options {
	if in == nil {
		return nil
	}
	return &llmproxy.Options{
		FrequencyPenalty: in.FrequencyPenalty,
		MaxTokens:        in.MaxTokens,
		PresencePenalty:  in.PresencePenalty,
		Seed:             in.Seed,
		Temperature:      in.Temperature,
		TopK:             in.TopK,
		TopP:             in.TopP,
	}
}

// ChatRequestToDomain converts HTTP API request to LLM domain request
func ChatRequestToDomain(in *ChatRequest) (*llmproxy.ChatRequest, error) {
	req := &llmproxy.ChatRequest{
		Model:              llmproxy.ModelID(in.Model),
		SystemPrompt:       in.SystemPrompt,
		ImageURLs:          in.ImageURLs,
		PreviousResponseID: in.PreviousResponseID,
	}
	// Convert input
	inp, err := LLMInputToDomain(in.Input)
	if err != nil {
		return nil, fmt.Errorf("failed to convert input: %w", err)
	}
	req.Input = inp
	// Convert tools
	if len(in.Tools) > 0 {
		tools, err := llmToolsToDomain(in.Tools, nil)
		if err != nil {
			return nil, err
		}
		req.Tools = tools
	}

	// Convert strings to FileID
	if len(in.FileIDs) > 0 {
		req.FileIDs = make([]llmproxy.FileID, len(in.FileIDs))
		for i, id := range in.FileIDs {
			req.FileIDs[i] = llmproxy.FileID(id)
		}
	}
	if len(in.ImageIDs) > 0 {
		req.ImageIDs = make([]llmproxy.FileID, len(in.ImageIDs))
		for i, id := range in.ImageIDs {
			req.ImageIDs[i] = llmproxy.FileID(id)
		}
	}

	// Handle response format
	if in.ResponseFormat != nil {
		schema, err := schemautil.EnsureStrictness(in.ResponseFormat.Schema)
		if err != nil {
			return nil, fmt.Errorf("invalid response format schema: %w", err)
		}
		req.ResponseFormat = &llmproxy.ResponseFormat{
			Name:   in.ResponseFormat.Name,
			Schema: schema,
		}
		if in.ResponseFormat.Description != nil {
			req.ResponseFormat.Description = *in.ResponseFormat.Description
		}
	}

	req.Options = LLMOptionsToDomain(in.Options)
	return req, nil
}

// ChatResponseToAPI converts LLM domain response to HTTP API response
func ChatResponseToAPI(in *llmproxy.ChatResponse) *ChatResponse {
	res := &ChatResponse{
		Text:       in.Text,
		ResponseID: in.ResponseID,
		TokensUsed: in.TokensUsed,
	}
	if len(in.Citations) > 0 {
		res.Citations = make([]Citation, len(in.Citations))
		for i, c := range in.Citations {
			res.Citations[i] = Citation{
				Url:      c.URL,
				Title:    pointer.Ptr(c.Title),
				Snippet:  pointer.Ptr(c.Snippet),
				StartIdx: pointer.Ptr(c.StartIdx),
				EndIdx:   pointer.Ptr(c.EndIdx),
			}
		}
	}

	if len(in.ToolCallRequests) > 0 {
		res.ToolCallRequests = make([]ToolCallRequest, len(in.ToolCallRequests))
		for i, t := range in.ToolCallRequests {
			res.ToolCallRequests[i] = ToolCallRequest{
				CallId:    t.CallID,
				Name:      t.Name,
				Arguments: t.Arguments,
			}
		}
	}

	return res
}

// FileUploadRequestToDomain maps multipart.Reader to FileUploadRequest
// The caller is responsible for closing the File field.
func FileUploadRequestToDomain(reader *multipart.Reader) (*llmproxy.FileUploadRequest, error) {
	res := &llmproxy.FileUploadRequest{}
	for {
		part, err := reader.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to read multipart part: %w", err)
		}
		switch part.FormName() {
		case "provider":
			val, err := io.ReadAll(part)
			if err != nil {
				return nil, fmt.Errorf("failed to read provider part: %w", err)
			}
			res.ProviderID = llmproxy.ProviderID(string(val))
		case "fileType":
			val, err := io.ReadAll(part)
			if err != nil {
				return nil, fmt.Errorf("failed to read fileType part: %w", err)
			}
			res.FileType = llmproxy.ContentType(string(val))
		case "purpose":
			val, err := io.ReadAll(part)
			if err != nil {
				return nil, fmt.Errorf("failed to read purpose part: %w", err)
			}
			res.Purpose = string(val)
		case "file":
			res.File = part // io.ReadCloser; caller must close
			continue        // don't close part here; caller must close
		}
		part.Close()
	}
	if res.File == nil {
		return nil, fmt.Errorf("file part is missing")
	}
	if res.ProviderID == "" || res.FileType == "" {
		return nil, fmt.Errorf("missing required fields")
	}
	return res, nil
}

// FileUploadResponseToAPI converts LLM domain file response to HTTP API file response
func FileUploadResponseToAPI(in *llmproxy.FileUploadResponse) *FileUpload {
	return &FileUpload{
		FileID:   string(in.FileID),
		FileName: in.FileName,
	}
}

// ProvidersToAPI converts LLM provider info to its API representation.
func ProvidersToAPI(in []llmproxy.ProviderInfo) []ProviderInfo {
	return mapping.Slice(in, providerInfoToAPI)
}

func providerInfoToAPI(p *llmproxy.ProviderInfo) ProviderInfo {
	return ProviderInfo{
		Id:     string(p.ID),
		Models: mapping.Slice(p.Models, modelInfoToAPI),
	}
}

func modelInfoToAPI(m *llmproxy.ModelInfo) ModelInfo {
	return ModelInfo{
		Id:                 string(m.ID),
		Provider:           string(m.Provider),
		Label:              m.Label,
		MaxTokens:          m.MaxTokens,
		EmbeddingDimension: m.EmbeddingDimension,
		TokenModifier:      float32(m.TokenModifier),
		Capabilities: mapping.Slice(m.Capabilities, func(c *llmproxy.ModelCapability) ModelCapability {
			return ModelCapability(*c)
		}),
	}
}

// LLMInputToDomain converts api Input to llmproxy.Input
func LLMInputToDomain(in Input) (llmproxy.Input, error) {
	// Input is InputString
	inpStr, err := in.AsInputString()
	if err == nil {
		return llmproxy.InputString(inpStr.Value), nil
	}
	// Input must be []InputItem
	items, err := in.AsInput1()
	if err != nil {
		return nil, fmt.Errorf("unknown input type: %T", in)
	}
	coreItems := make(llmproxy.InputItems, len(items))
	for i, item := range items {
		inpStr, err := item.AsInputString()
		if err == nil && inpStr.Value != "" {
			coreItems[i] = llmproxy.InputString(inpStr.Value)
			continue
		}
		tcr, err := item.AsToolCallRequest()
		if err == nil && tcr.CallId != "" && tcr.Name != "" && tcr.Arguments != nil {
			coreItems[i] = llmproxy.ToolCallRequest{
				CallID:    tcr.CallId,
				Name:      tcr.Name,
				Arguments: tcr.Arguments,
			}
			continue
		}
		tr, err := item.AsToolResult()
		if err == nil && tr.CallId != "" && tr.Name != "" && tr.Output != nil {
			coreItems[i] = llmproxy.ToolResult{
				CallID: tr.CallId,
				Output: tr.Output,
				Name:   tr.Name,
			}
			continue
		}
		return nil, fmt.Errorf("unknown input item type at index %d: %T", i, item)
	}
	return coreItems, nil
}

// llmToolsToDomain converts API tools to domain tools. If externalMapper is non-nil, it is used
// to convert external tools (e.g. to wrap them as FunctionTool with a stub handler).
// If nil, external tools are converted to ExternalToolBase (can not be executed).
func llmToolsToDomain(tools []Tool, externalMapper func(ExternalTool) llmproxy.Tool) ([]llmproxy.Tool, error) {
	result := make([]llmproxy.Tool, len(tools))
	for i, tool := range tools {
		val, err := tool.ValueByDiscriminator()
		if err != nil {
			return nil, fmt.Errorf("failed to discriminate tool: %w", err)
		}
		switch t := val.(type) {
		case ExternalTool:
			if externalMapper != nil {
				result[i] = externalMapper(t)
			} else {
				result[i] = llmproxy.ExternalToolBase{
					Name:        t.Name,
					Description: t.Description,
					Parameters:  t.Parameters,
				}
			}
		case WebSearchTool:
			result[i] = llmproxy.WebSearch{}
		}
	}
	return result, nil
}

// ChatRequestToAPI converts an ChatRequest into the api api shape.
// Used by the engine-side backend.Client to forward chat calls to fh-backend.
func ChatRequestToAPI(in *llmproxy.ChatRequest) (*ChatRequest, error) {
	input, err := llmInputToAPI(in.Input)
	if err != nil {
		return nil, fmt.Errorf("input: %w", err)
	}
	out := &ChatRequest{
		Model:              string(in.Model),
		Input:              input,
		SystemPrompt:       in.SystemPrompt,
		PreviousResponseID: in.PreviousResponseID,
		ImageURLs:          in.ImageURLs,
		Options:            llmOptionsToAPI(in.Options),
	}
	if len(in.FileIDs) > 0 {
		out.FileIDs = make([]string, len(in.FileIDs))
		for i, id := range in.FileIDs {
			out.FileIDs[i] = string(id)
		}
	}
	if len(in.ImageIDs) > 0 {
		out.ImageIDs = make([]string, len(in.ImageIDs))
		for i, id := range in.ImageIDs {
			out.ImageIDs[i] = string(id)
		}
	}
	if len(in.Tools) > 0 {
		tools, err := llmToolsToAPI(in.Tools)
		if err != nil {
			return nil, err
		}
		out.Tools = tools
	}
	if in.ResponseFormat != nil {
		var desc *string
		if in.ResponseFormat.Description != "" {
			d := in.ResponseFormat.Description
			desc = &d
		}
		out.ResponseFormat = &ResponseFormat{
			Name:        in.ResponseFormat.Name,
			Schema:      in.ResponseFormat.Schema,
			Description: desc,
		}
	}
	return out, nil
}

// ChatResponseToDomain converts a api ChatResponse back to llmproxy form.
func ChatResponseToDomain(in *ChatResponse) *llmproxy.ChatResponse {
	out := &llmproxy.ChatResponse{
		Text:       in.Text,
		ResponseID: in.ResponseID,
		TokensUsed: in.TokensUsed,
	}
	if len(in.Citations) > 0 {
		out.Citations = make([]llmproxy.Citation, len(in.Citations))
		for i, c := range in.Citations {
			out.Citations[i] = llmproxy.Citation{
				URL:      c.Url,
				Title:    pointer.Val(c.Title),
				Snippet:  pointer.Val(c.Snippet),
				StartIdx: pointer.Val(c.StartIdx),
				EndIdx:   pointer.Val(c.EndIdx),
			}
		}
	}
	if len(in.ToolCallRequests) > 0 {
		out.ToolCallRequests = make([]llmproxy.ToolCallRequest, len(in.ToolCallRequests))
		for i, t := range in.ToolCallRequests {
			out.ToolCallRequests[i] = llmproxy.ToolCallRequest{
				CallID:    t.CallId,
				Name:      t.Name,
				Arguments: t.Arguments,
			}
		}
	}
	return out
}

// ProvidersToDomain converts a list of api ProviderInfo back to llmproxy form.
func ProvidersToDomain(in []ProviderInfo) []llmproxy.ProviderInfo {
	out := make([]llmproxy.ProviderInfo, len(in))
	for i, p := range in {
		out[i] = llmproxy.ProviderInfo{
			ID:     llmproxy.ProviderID(p.Id),
			Models: mapping.Slice(p.Models, modelInfoToDomain),
		}
	}
	return out
}

func modelInfoToDomain(m *ModelInfo) llmproxy.ModelInfo {
	caps := make([]llmproxy.ModelCapability, len(m.Capabilities))
	for i, c := range m.Capabilities {
		caps[i] = llmproxy.ModelCapability(c)
	}
	return llmproxy.ModelInfo{
		ID:                 llmproxy.ModelID(m.Id),
		Provider:           llmproxy.ProviderID(m.Provider),
		Label:              m.Label,
		Capabilities:       caps,
		TokenModifier:      float64(m.TokenModifier),
		MaxTokens:          m.MaxTokens,
		EmbeddingDimension: m.EmbeddingDimension,
	}
}

func llmOptionsToAPI(in *llmproxy.Options) *Options {
	if in == nil {
		return nil
	}
	return &Options{
		FrequencyPenalty: in.FrequencyPenalty,
		MaxTokens:        in.MaxTokens,
		PresencePenalty:  in.PresencePenalty,
		Seed:             in.Seed,
		Temperature:      in.Temperature,
		TopK:             in.TopK,
		TopP:             in.TopP,
	}
}

func llmInputToAPI(in llmproxy.Input) (Input, error) {
	var out Input
	switch v := in.(type) {
	case llmproxy.InputString:
		if err := out.FromInputString(InputString{Value: string(v)}); err != nil {
			return out, fmt.Errorf("encode input string: %w", err)
		}
	case llmproxy.InputItems:
		items := make(Input1, len(v))
		for i, item := range v {
			converted, err := llmInputItemToAPI(item)
			if err != nil {
				return out, fmt.Errorf("input item %d: %w", i, err)
			}
			items[i] = converted
		}
		if err := out.FromInput1(items); err != nil {
			return out, fmt.Errorf("encode input items: %w", err)
		}
	default:
		return out, fmt.Errorf("unknown input type: %T", in)
	}
	return out, nil
}

func llmInputItemToAPI(item llmproxy.InputItem) (Input_1_Item, error) {
	var out Input_1_Item
	switch v := item.(type) {
	case llmproxy.InputString:
		if err := out.FromInputString(InputString{Value: string(v)}); err != nil {
			return out, err
		}
	case llmproxy.ToolCallRequest:
		if err := out.FromToolCallRequest(ToolCallRequest{
			CallId:    v.CallID,
			Name:      v.Name,
			Arguments: v.Arguments,
		}); err != nil {
			return out, err
		}
	case llmproxy.ToolResult:
		// ToolResult.Output is `any`; the api shape requires a JSON object.
		// Marshal/unmarshal coerces; non-object outputs get wrapped under "result".
		output, ok := v.Output.(map[string]any)
		if !ok {
			b, err := json.Marshal(v.Output)
			if err != nil {
				return out, fmt.Errorf("marshal tool result: %w", err)
			}
			output = map[string]any{}
			if err := json.Unmarshal(b, &output); err != nil {
				output = map[string]any{"result": v.Output}
			}
		}
		if err := out.FromToolResult(ToolResult{
			CallId: v.CallID,
			Name:   v.Name,
			Output: output,
		}); err != nil {
			return out, err
		}
	default:
		return out, fmt.Errorf("unknown input item type: %T", v)
	}
	return out, nil
}

// llmToolsToAPI maps tools as metadata only — the engine-side ToolCall
// handler stays local; only name/description/parameters cross the api.
func llmToolsToAPI(tools []llmproxy.Tool) ([]Tool, error) {
	out := make([]Tool, len(tools))
	for i, t := range tools {
		var item Tool
		switch v := t.(type) {
		case llmproxy.ExternalTool:
			if err := item.FromExternalTool(ExternalTool{
				Name:        v.ToolName(),
				Description: v.ToolDescription(),
				Parameters:  v.ToolParams(),
				Type:        External,
			}); err != nil {
				return nil, fmt.Errorf("tool %d: %w", i, err)
			}
		case llmproxy.WebSearch:
			if err := item.FromWebSearchTool(WebSearchTool{
				Type: WebSearch,
			}); err != nil {
				return nil, fmt.Errorf("tool %d: %w", i, err)
			}
		default:
			return nil, fmt.Errorf("tool %d: unsupported type %T", i, t)
		}
		out[i] = item
	}
	return out, nil
}
