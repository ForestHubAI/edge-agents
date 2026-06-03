// Package test provides common test methods and types for LLM providers.
package test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"strings"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Chat tests basic chat functionality of the provider.
func Chat(t *testing.T, p testProvider, model llmproxy.ModelID) {
	req := &llmproxy.ChatRequest{
		Model: model,
		Input: llmproxy.InputString("Hello, how are you?"),
	}
	resp, err := p.Chat(context.Background(), req)
	assert.NoError(t, err)
	assert.NotEmpty(t, resp.Text)
	assert.NotEmpty(t, resp.ResponseID)
	assert.Greater(t, resp.TokensUsed, 0)
	fmt.Println(resp.Text)
}

// StructuredResponse tests chat functionality with structured response formats.
func StructuredResponse(t *testing.T, p testProvider, model llmproxy.ModelID) {
	format, err := llmproxy.NewResponseFormat[WeatherForecast]("weather", "A weather forecast with temperature details")
	assert.NoError(t, err)
	req := &llmproxy.ChatRequest{
		Model:          model,
		Input:          llmproxy.InputString("What's the weather like in Berlin?"),
		ResponseFormat: format,
	}
	resp, err := p.Chat(context.Background(), req)
	assert.NoError(t, err)
	assert.NotEmpty(t, resp.Text)
	assert.NotEmpty(t, resp.ResponseID)
	assert.Greater(t, resp.TokensUsed, 0)

	// Validate structure adheres to WeatherForecast
	var forecast WeatherForecast
	err = json.Unmarshal([]byte(resp.Text), &forecast)
	assert.NoError(t, err)
	assert.NotEmpty(t, forecast.Location)
	assert.NotEmpty(t, forecast.Conditions)
	assert.NotEmpty(t, forecast.Temperature.Unit)
	assert.Greater(t, forecast.Temperature.Current, float64(0))

	// Pretty print for readability
	pretty, err := json.MarshalIndent(forecast, "", "    ")
	assert.NoError(t, err)
	fmt.Println(string(pretty))
}

// ChatWithToolUse tests chat functionality with tool use.
func ChatWithToolUse(t *testing.T, p testProvider, model llmproxy.ModelID) {
	query := llmproxy.InputString("What's the weather in Berlin?")
	ft, err := llmproxy.NewFunctionTool(
		"get_weather",
		"Get the current weather information for a specified city.",
		GetWeather,
	)
	assert.NoError(t, err)

	req := &llmproxy.ChatRequest{
		Model: model,
		Input: query,
		Tools: []llmproxy.Tool{ft},
	}

	resp, err := p.Chat(context.Background(), req)
	assert.NoError(t, err)
	assert.NotEmpty(t, resp.ResponseID)
	assert.Greater(t, resp.TokensUsed, 0)
	require.NotEmpty(t, resp.ToolCallRequests)
	tcr := resp.ToolCallRequests[0]
	assert.Equal(t, "get_weather", tcr.Name)
	assert.JSONEq(t, `{"city":"Berlin"}`, string(tcr.Arguments))
	// Print tool call
	tcrJSON, err := json.MarshalIndent(tcr, "", "  ")
	assert.NoError(t, err)
	fmt.Println(string(tcrJSON))

	// Prepare second request with example tool result
	toolResult := llmproxy.ToolResult{
		CallID: tcr.CallID,
		Name:   tcr.Name,
		Output: Weather{
			City:             "Berlin",
			TemperatureRange: "14-20C",
			Conditions:       "Sunny with wind.",
		},
	}
	assert.NoError(t, err)
	req2 := &llmproxy.ChatRequest{
		Model: model,
		Input: llmproxy.InputItems{query, tcr, toolResult},
	}
	resp2, err := p.Chat(context.Background(), req2)
	assert.NoError(t, err)
	assert.NotEmpty(t, resp2.Text)
	assert.NotEmpty(t, resp2.ResponseID)
	assert.Greater(t, resp2.TokensUsed, 0)
	assert.Empty(t, resp2.ToolCallRequests)
	fmt.Println(resp2.Text)

}

// FileHandling tests file upload and deletion functionality of the provider.
func FileHandling(t *testing.T, p testProvider) {
	fileContent := `{"messages":[{"role":"user","content":"Hello!"},{"role":"assistant","content":"Hi there!"}]}
	{"messages":[{"role":"user","content":"How are you?"},{"role":"assistant","content":"I'm good, thanks!"}]}`

	req := &llmproxy.FileUploadRequest{
		File:     io.NopCloser(strings.NewReader(fileContent)),
		FileName: "testfile.jsonl",
		Purpose:  "fine-tune", // or "batch" / "ocr"
	}
	resp, err := p.UploadFile(context.Background(), req)
	assert.NoError(t, err)
	assert.NotEmpty(t, resp.FileID)
	assert.Equal(t, resp.FileName, "testfile.jsonl")
	// Remove file
	deleted, err := p.DeleteFile(context.Background(), resp.FileID)
	assert.NoError(t, err)
	assert.True(t, deleted)
}
