package mapping

import (
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"

	"github.com/ForestHubAI/edge-agents/go/api/llmapi"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/schemautil"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
)

// OptionsToDomain converts API options to core options.
func OptionsToDomain(in *llmapi.Options) *llmproxy.Options {
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

// ChatRequestToDomain converts HTTP API request to domain request
func ChatRequestToDomain(in *llmapi.ChatRequest) (*llmproxy.ChatRequest, error) {
	req := &llmproxy.ChatRequest{
		Model:              llmproxy.ModelID(in.Model),
		SystemPrompt:       in.SystemPrompt,
		ImageURLs:          in.ImageURLs,
		PreviousResponseID: in.PreviousResponseID,
	}
	// Convert input
	inp, err := InputToDomain(in.Input)
	if err != nil {
		return nil, fmt.Errorf("failed to convert input: %w", err)
	}
	req.Input = inp
	// Convert tools
	if len(in.Tools) > 0 {
		tools, err := toolsToDomain(in.Tools, nil)
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

	req.Options = OptionsToDomain(in.Options)
	return req, nil
}

// ChatResponseToAPI converts domain response to HTTP API response
func ChatResponseToAPI(in *llmproxy.ChatResponse) *llmapi.ChatResponse {
	res := &llmapi.ChatResponse{
		Text:       in.Text,
		ResponseID: in.ResponseID,
		TokensUsed: in.TokensUsed,
	}
	if len(in.Citations) > 0 {
		res.Citations = make([]llmapi.Citation, len(in.Citations))
		for i, c := range in.Citations {
			res.Citations[i] = llmapi.Citation{
				Url:      c.URL,
				Title:    pointer.Ptr(c.Title),
				Snippet:  pointer.Ptr(c.Snippet),
				StartIdx: pointer.Ptr(c.StartIdx),
				EndIdx:   pointer.Ptr(c.EndIdx),
			}
		}
	}

	if len(in.ToolCallRequests) > 0 {
		res.ToolCallRequests = make([]llmapi.ToolCallRequest, len(in.ToolCallRequests))
		for i, t := range in.ToolCallRequests {
			res.ToolCallRequests[i] = llmapi.ToolCallRequest{
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

// FileUploadResponseToAPI converts domain file response to HTTP API file response
func FileUploadResponseToAPI(in *llmproxy.FileUploadResponse) *llmapi.FileUpload {
	return &llmapi.FileUpload{
		FileID:   string(in.FileID),
		FileName: in.FileName,
	}
}

// ProvidersToAPI converts provider info to its API representation.
func ProvidersToAPI(in []llmproxy.ProviderInfo) []llmapi.ProviderInfo {
	return Slice(in, providerInfoToAPI)
}

func providerInfoToAPI(p *llmproxy.ProviderInfo) llmapi.ProviderInfo {
	return llmapi.ProviderInfo{
		Id:     string(p.ID),
		Models: Slice(p.Models, modelInfoToAPI),
	}
}

func modelInfoToAPI(m *llmproxy.ModelInfo) llmapi.ModelInfo {
	return llmapi.ModelInfo{
		Id:                 string(m.ID),
		Provider:           string(m.Provider),
		Label:              m.Label,
		MaxTokens:          m.MaxTokens,
		EmbeddingDimension: m.EmbeddingDimension,
		TokenModifier:      float32(m.TokenModifier),
		Capabilities: Slice(m.Capabilities, func(c *llmproxy.ModelCapability) llmapi.ModelCapability {
			return llmapi.ModelCapability(*c)
		}),
	}
}

// InputToDomain converts api Input to domain Input.
func InputToDomain(in llmapi.Input) (llmproxy.Input, error) {
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

// toolsToDomain converts API tools to domain tools. If externalMapper is non-nil, it is used
// to convert external tools (e.g. to wrap them as FunctionTool with a stub handler).
// If nil, external tools are converted to ExternalToolBase (can not be executed).
func toolsToDomain(tools []llmapi.Tool, externalMapper func(llmapi.ExternalTool) llmproxy.Tool) ([]llmproxy.Tool, error) {
	result := make([]llmproxy.Tool, len(tools))
	for i, tool := range tools {
		val, err := tool.ValueByDiscriminator()
		if err != nil {
			return nil, fmt.Errorf("failed to discriminate tool: %w", err)
		}
		switch t := val.(type) {
		case llmapi.ExternalTool:
			if externalMapper != nil {
				result[i] = externalMapper(t)
			} else {
				result[i] = llmproxy.ExternalToolBase{
					Name:        t.Name,
					Description: t.Description,
					Parameters:  t.Parameters,
				}
			}
		case llmapi.WebSearchTool:
			result[i] = llmproxy.WebSearch{}
		}
	}
	return result, nil
}

// ChatRequestToAPI converts an ChatRequest into the api shape.
// Used by the engine-side backend.Client to forward chat calls to fh-backend.
func ChatRequestToAPI(in *llmproxy.ChatRequest) (*llmapi.ChatRequest, error) {
	input, err := inputToAPI(in.Input)
	if err != nil {
		return nil, fmt.Errorf("input: %w", err)
	}
	out := &llmapi.ChatRequest{
		Model:              string(in.Model),
		Input:              input,
		SystemPrompt:       in.SystemPrompt,
		PreviousResponseID: in.PreviousResponseID,
		ImageURLs:          in.ImageURLs,
		Options:            optionsToAPI(in.Options),
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
		tools, err := toolsToAPI(in.Tools)
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
		out.ResponseFormat = &llmapi.ResponseFormat{
			Name:        in.ResponseFormat.Name,
			Schema:      in.ResponseFormat.Schema,
			Description: desc,
		}
	}
	return out, nil
}

// ChatResponseToDomain converts a api ChatResponse back to llmproxy form.
func ChatResponseToDomain(in *llmapi.ChatResponse) *llmproxy.ChatResponse {
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
func ProvidersToDomain(in []llmapi.ProviderInfo) []llmproxy.ProviderInfo {
	out := make([]llmproxy.ProviderInfo, len(in))
	for i, p := range in {
		out[i] = llmproxy.ProviderInfo{
			ID:     llmproxy.ProviderID(p.Id),
			Models: Slice(p.Models, modelInfoToDomain),
		}
	}
	return out
}

// ModelCapabilitiesToDomain converts api model capabilities to domain.
func ModelCapabilitiesToDomain(in []llmapi.ModelCapability) []llmproxy.ModelCapability {
	return Slice(in, func(c *llmapi.ModelCapability) llmproxy.ModelCapability {
		return llmproxy.ModelCapability(*c)
	})
}

func modelInfoToDomain(m *llmapi.ModelInfo) llmproxy.ModelInfo {
	return llmproxy.ModelInfo{
		ID:                 llmproxy.ModelID(m.Id),
		Provider:           llmproxy.ProviderID(m.Provider),
		Label:              m.Label,
		Capabilities:       ModelCapabilitiesToDomain(m.Capabilities),
		TokenModifier:      float64(m.TokenModifier),
		MaxTokens:          m.MaxTokens,
		EmbeddingDimension: m.EmbeddingDimension,
	}
}

func optionsToAPI(in *llmproxy.Options) *llmapi.Options {
	if in == nil {
		return nil
	}
	return &llmapi.Options{
		FrequencyPenalty: in.FrequencyPenalty,
		MaxTokens:        in.MaxTokens,
		PresencePenalty:  in.PresencePenalty,
		Seed:             in.Seed,
		Temperature:      in.Temperature,
		TopK:             in.TopK,
		TopP:             in.TopP,
	}
}

func inputToAPI(in llmproxy.Input) (llmapi.Input, error) {
	var out llmapi.Input
	switch v := in.(type) {
	case llmproxy.InputString:
		if err := out.FromInputString(llmapi.InputString{Value: string(v)}); err != nil {
			return out, fmt.Errorf("encode input string: %w", err)
		}
	case llmproxy.InputItems:
		items := make(llmapi.Input1, len(v))
		for i, item := range v {
			converted, err := inputItemToAPI(item)
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

func inputItemToAPI(item llmproxy.InputItem) (llmapi.Input_1_Item, error) {
	var out llmapi.Input_1_Item
	switch v := item.(type) {
	case llmproxy.InputString:
		if err := out.FromInputString(llmapi.InputString{Value: string(v)}); err != nil {
			return out, err
		}
	case llmproxy.ToolCallRequest:
		if err := out.FromToolCallRequest(llmapi.ToolCallRequest{
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
		if err := out.FromToolResult(llmapi.ToolResult{
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

// toolsToAPI maps tools as metadata only — the engine-side ToolCall
// handler stays local; only name/description/parameters cross the api.
func toolsToAPI(tools []llmproxy.Tool) ([]llmapi.Tool, error) {
	out := make([]llmapi.Tool, len(tools))
	for i, t := range tools {
		var item llmapi.Tool
		switch v := t.(type) {
		case llmproxy.ExternalTool:
			if err := item.FromExternalTool(llmapi.ExternalTool{
				Name:        v.ToolName(),
				Description: v.ToolDescription(),
				Parameters:  v.ToolParams(),
				Type:        llmapi.External,
			}); err != nil {
				return nil, fmt.Errorf("tool %d: %w", i, err)
			}
		case llmproxy.WebSearch:
			if err := item.FromWebSearchTool(llmapi.WebSearchTool{
				Type: llmapi.WebSearch,
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
