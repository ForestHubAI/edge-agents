package agent

import (
	"context"

	"github.com/ForestHubAI/fh-core/go/llmproxy"
)

type llmClient interface {
	Chat(ctx context.Context, req *llmproxy.ChatRequest) (*llmproxy.ChatResponse, error)
}
