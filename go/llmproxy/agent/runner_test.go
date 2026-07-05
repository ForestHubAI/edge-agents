// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package agent

import (
	"context"
	"encoding/json"
	"fmt"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/test"

	"github.com/stretchr/testify/assert"
)

// NoArgs represents an empty JSON object for tool call arguments.
var NoArgs = json.RawMessage([]byte("{}"))

// NewTestRunner creates a new Runner with the given mock provider for testing purposes.
func NewTestRunner(llmClient llmClient, model llmproxy.ModelID, opts ...RunnerOption) *Runner {
	r := &Runner{
		llmClient:    llmClient,
		DefaultModel: model,
	}
	for _, opt := range opts {
		opt(r)
	}
	return r
}

// TestAgentAnswersImmediately tests that an agent can provide an immediate answer without tool calls.
func TestAgentAnswersImmediately(t *testing.T) {
	systemPrompt := "You are a helpful assistant."
	agent := NewAgent("test-agent", WithInstructions(systemPrompt))
	client := newMockllmClient(t)
	model := llmproxy.ModelID("test-model")
	runner := NewTestRunner(client, model)

	// Prepare the expected chat request
	input := llmproxy.InputString("What is the capital of France?")
	req := &llmproxy.ChatRequest{
		Model:        model,
		Input:        llmproxy.AsInputItems(input),
		SystemPrompt: systemPrompt,
	}

	// Mock the llm client to return a direct answer
	client.EXPECT().Chat(context.Background(), req).Return(&llmproxy.ChatResponse{
		Text: "The capital of France is Paris.",
	}, nil)

	res, err := runner.Run(context.Background(), agent, input)
	assert.NoError(t, err)
	assert.Equal(t, 1, res.Turns)
}

// TestNoOutput tests the behavior when an agent produces no output.
func TestNoOutput(t *testing.T) {
	systemPrompt := "You are a helpful assistant."
	agent := NewAgent("test-agent", WithInstructions(systemPrompt))
	client := newMockllmClient(t)
	model := llmproxy.ModelID("test-model")
	runner := NewTestRunner(client, model)

	// Prepare the expected chat request
	input := llmproxy.InputString("What is the capital of France?")
	req := &llmproxy.ChatRequest{
		Model:        model,
		Input:        llmproxy.AsInputItems(input),
		SystemPrompt: systemPrompt,
	}

	// Mock the llm client to return a direct answer
	client.EXPECT().Chat(context.Background(), req).Return(&llmproxy.ChatResponse{
		Text: "",
	}, nil)

	_, err := runner.Run(context.Background(), agent, input)
	assert.Error(t, err)
}

func TestToolUse(t *testing.T) {
	systemPrompt := "You are a helpful assistant."
	ft, err := llmproxy.NewFunctionTool(
		"get_weather",
		"Get the current weather information for a specified city.",
		test.GetWeather,
	)
	agent := NewAgent("test-agent", WithInstructions(systemPrompt), WithTools(ft))
	client := newMockllmClient(t)
	model := llmproxy.ModelID("test-model")
	runner := NewTestRunner(client, model)

	// Prepare the expected chat request
	input := llmproxy.InputString("What's the weather in Paris?")
	req := &llmproxy.ChatRequest{
		Model:        model,
		Input:        llmproxy.InputItems{input},
		SystemPrompt: systemPrompt,
		Tools:        agent.Tools,
	}
	toolCallReq := llmproxy.ToolCallRequest{
		Name:      "get_weather",
		Arguments: json.RawMessage(`{"city":"Paris"}`),
	}
	toolResult := llmproxy.ToolResult{
		Name:   "get_weather",
		Output: test.Weather{City: "Paris", TemperatureRange: "14-20C", Conditions: "Sunny with wind."},
	}
	req2 := &llmproxy.ChatRequest{
		Model:        model,
		Input:        llmproxy.InputItems{input, toolCallReq, toolResult},
		SystemPrompt: systemPrompt,
		Tools:        agent.Tools,
	}

	// Mock the llm client
	client.EXPECT().Chat(context.Background(), req).Return(&llmproxy.ChatResponse{
		// Return answer and tool call -> answer is ignored
		Text:             "I will check the weather for Paris.",
		ToolCallRequests: []llmproxy.ToolCallRequest{toolCallReq},
	}, nil).Once()
	client.EXPECT().Chat(context.Background(), req2).Return(&llmproxy.ChatResponse{
		Text: "The current weather in Paris is 14-20C and sunny with wind.",
	}, nil).Once()

	res, err := runner.Run(context.Background(), agent, input)
	assert.NoError(t, err)
	assert.Equal(t, 2, res.Turns)
}

// TestAgentAsTool tests using an agent as a tool.
func TestAgentAsTool(t *testing.T) {
	// Inner agent that will be used as a tool
	innerSystemPrompt := "You are a calculator."
	innerAgent := NewAgent("inner-agent", WithInstructions(innerSystemPrompt), WithInstructions("You are a calculator."))
	client := newMockllmClient(t)
	innerModel := llmproxy.ModelID("inner-model")
	innerRunner := NewTestRunner(client, innerModel)

	// The input prompt for the tool
	toolPrompt := "What is 2 + 2?"
	innerReq := &llmproxy.ChatRequest{
		Model:        innerModel,
		Input:        llmproxy.AsInputItems(llmproxy.InputString(toolPrompt)),
		SystemPrompt: innerSystemPrompt,
	}
	// Mock the inner agent's provider to return the calculation
	client.EXPECT().Chat(context.Background(), innerReq).Return(&llmproxy.ChatResponse{
		Text: "4",
	}, nil).Once()

	// Wrap the inner agent as a tool
	tool, err := innerAgent.AsTool("calc", "Performs calculations", innerRunner)
	assert.NoError(t, err)

	// Outer agent uses the tool
	outerAgent := NewAgent("outer-agent", WithTools(tool))
	outerModel := llmproxy.ModelID("outer-model")
	outerRunner := NewTestRunner(client, outerModel)

	// Outer agent receives a prompt that requires using the tool
	outerInput := llmproxy.InputString("Please calculate 2 + 2.")
	outerReq := &llmproxy.ChatRequest{
		Model: outerModel,
		Input: llmproxy.AsInputItems(outerInput),
		Tools: outerAgent.Tools,
	}
	// The tool call that the outer agent will make
	toolCallReq := llmproxy.ToolCallRequest{
		Name:      "calc",
		Arguments: json.RawMessage(fmt.Sprintf(`{"prompt":"%s"}`, toolPrompt)),
	}
	toolResult := llmproxy.ToolResult{
		Name:   "calc",
		Output: "4",
	}
	outerReq2 := &llmproxy.ChatRequest{
		Model: outerModel,
		Input: llmproxy.InputItems{outerInput, toolCallReq, toolResult},
		Tools: outerAgent.Tools,
	}

	// Mock the outer provider: first call returns a tool call, second returns the final answer
	client.EXPECT().Chat(context.Background(), outerReq).Return(&llmproxy.ChatResponse{
		Text:             "Let me calculate that for you.",
		ToolCallRequests: []llmproxy.ToolCallRequest{toolCallReq},
	}, nil).Once()
	client.EXPECT().Chat(context.Background(), outerReq2).Return(&llmproxy.ChatResponse{
		Text: "The answer is 4.",
	}, nil).Once()

	res, err := outerRunner.Run(context.Background(), outerAgent, outerInput)
	assert.NoError(t, err)
	assert.Equal(t, 2, res.Turns)
	assert.Equal(t, "The answer is 4.", res.FinalOutput)
}

// TestAgentHandoff tests the handoff functionality between agents.
func TestAgentHandoff(t *testing.T) {
	client := newMockllmClient(t)
	supportModel := llmproxy.ModelID("support-model")
	billingModel := llmproxy.ModelID("billing-model")
	runner := NewTestRunner(client, supportModel)
	// Setup two agents: support and billing
	supportPrompt := "You are a helpful support agent. Answer general questions, but hand off billing questions to the billing department."
	billingPrompt := "You are a billing specialist. Answer all questions about invoices and payments."
	billingAgent := NewAgent("billing-agent", WithInstructions(billingPrompt))

	t.Run("with same model", func(t *testing.T) {
		// Create a Handoff tool that points to the billing agent
		handoffTool := NewHandoff("handoff_to_billing", "Hand off billing questions to the billing agent.", billingAgent, nil)
		supportAgent := NewAgent("support-agent", WithInstructions(supportPrompt), WithTools(handoffTool))

		// The user asks a billing-related question
		input := llmproxy.InputString("I have a question about my last invoice. Can you help?")
		supportReq := &llmproxy.ChatRequest{
			Model:        supportModel,
			Input:        llmproxy.AsInputItems(input),
			SystemPrompt: supportPrompt,
			Tools:        supportAgent.Tools,
		}
		// The support agent responds with a tool call to the handoff tool
		handoffCall := llmproxy.ToolCallRequest{
			Name:      handoffTool.ToolName(),
			Arguments: NoArgs,
		}
		client.EXPECT().Chat(context.Background(), supportReq).Return(&llmproxy.ChatResponse{
			Text:             "This is a billing question. Let me transfer you to our billing department.",
			ToolCallRequests: []llmproxy.ToolCallRequest{handoffCall},
		}, nil).Once()

		// The billing agent receives the same input
		billingReq := &llmproxy.ChatRequest{
			Model:        supportModel,
			Input:        llmproxy.AsInputItems(input),
			SystemPrompt: billingPrompt,
		}
		client.EXPECT().Chat(context.Background(), billingReq).Return(&llmproxy.ChatResponse{
			Text: "Of course! Please provide your invoice number and I'll assist you.",
		}, nil).Once()

		// Run the support agent with the support runner
		res, err := runner.Run(context.Background(), supportAgent, input)
		assert.NoError(t, err)
		assert.Equal(t, "Of course! Please provide your invoice number and I'll assist you.", res.FinalOutput)
		assert.Equal(t, 2, res.Turns)
	})

	t.Run("with separate model", func(t *testing.T) {
		// Create a Handoff tool that points to the billing agent
		handoffTool := NewHandoff("handoff_to_billing", "Hand off billing questions to the billing agent.", billingAgent, &billingModel)
		supportAgent := NewAgent("support-agent", WithInstructions(supportPrompt), WithTools(handoffTool))

		// The user asks a billing-related question
		input := llmproxy.InputString("I have a question about my last invoice. Can you help?")
		supportReq := &llmproxy.ChatRequest{
			Model:        supportModel,
			Input:        llmproxy.AsInputItems(input),
			SystemPrompt: supportPrompt,
			Tools:        supportAgent.Tools,
		}
		// The support agent responds with a tool call to the handoff tool
		handoffCall := llmproxy.ToolCallRequest{
			Name:      handoffTool.ToolName(),
			Arguments: NoArgs,
		}
		client.EXPECT().Chat(context.Background(), supportReq).Return(&llmproxy.ChatResponse{
			Text:             "This is a billing question. Let me transfer you to our billing department.",
			ToolCallRequests: []llmproxy.ToolCallRequest{handoffCall},
		}, nil).Once()

		// The billing agent receives the same input
		billingReq := &llmproxy.ChatRequest{
			Model:        billingModel,
			Input:        llmproxy.AsInputItems(input),
			SystemPrompt: billingPrompt,
		}
		client.EXPECT().Chat(context.Background(), billingReq).Return(&llmproxy.ChatResponse{
			Text: "Of course! Please provide your invoice number and I'll assist you.",
		}, nil).Once()

		// Run the support agent with the support runner
		res, err := runner.Run(context.Background(), supportAgent, input)
		assert.NoError(t, err)
		assert.Equal(t, "Of course! Please provide your invoice number and I'll assist you.", res.FinalOutput)
		assert.Equal(t, 2, res.Turns)
	})
}
