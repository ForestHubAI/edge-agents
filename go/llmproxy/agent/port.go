package agent

import (
	"context"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"
)

type llmClient interface {
	Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error)
}
