package engine

import (
	"fmt"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// SubBufSize is the buffer size used in subscription channels. Events are dropped when this buffer size is exceeded.
const SubBufSize = 64

// Transition carries the metadata needed by a branching node to describe one
// of its possible outgoing transitions to an LLM.
type Transition struct {
	TargetID    string
	EdgeType    workflow.EdgeType
	Prompt      *workflow.Expression
	Description *string
}

// Apply runs the edge-type-specific side effect against the scope before the
// state machine moves on.
func (tr Transition) Apply(scope *Scope) error {
	switch tr.EdgeType {
	case workflow.AgentTask:
		if tr.Prompt == nil {
			return fmt.Errorf("agent task edge to %s: missing prompt", tr.TargetID)
		}
		v, err := expr.Eval(*tr.Prompt, scope)
		if err != nil {
			return fmt.Errorf("agent task prompt: %w", err)
		}
		scope.SetConversation(llmproxy.InputString(v.AsString()))
	case workflow.AgentDelegate:
		if tr.Prompt == nil {
			return nil // delegate with no prompt: preserve existing conversation as-is
		}
		v, err := expr.Eval(*tr.Prompt, scope)
		if err != nil {
			return fmt.Errorf("agent delegate prompt: %w", err)
		}
		updatedConv := append(scope.GetConversation(), llmproxy.InputString(v.AsString()))
		scope.SetConversation(updatedConv)
	case workflow.AgentChoice:
		scope.SetConversation(nil)
	}
	return nil
}

// Event is produced by a Trigger and consumed by the runner's state loop.
type Event struct {
	TargetState string       // Node ID to transition to
	Apply       func(*Scope) // Optional function to apply event data into the runner's scope
}

// RAGQueryParams is a similarity-search request issued through a Retriever.
type RAGQueryParams struct {
	CollectionID string
	Query        string
	TopK         int
}

// RAGQueryResult is one ranked chunk returned by a Retriever.
type RAGQueryResult struct {
	ChunkID    string
	DocumentID string
	Content    string
	Score      float64
}

// AgentRegistration is the per-boot state passed to Supervisor.Register.
type AgentRegistration struct {
	Address  string
	Status   AgentStatus
	Manifest *DeviceManifest
	Error    *string
	// DeploymentID is the opaque deployment token from ENGINE_DEPLOYMENT_ID,
	// echoed back so the backend can record which deployment is running. Empty
	// when not configured (e.g. an engine started without a deployment bundle).
	DeploymentID string
}

// AgentStatus is the boot outcome reported through Supervisor.Register.
type AgentStatus string

const (
	StatusOnline    AgentStatus = "online"
	StatusBootError AgentStatus = "booterror"
)

// RetryConfig tunes RegisterWithRetry and HeartbeatLoop. Interval is the
// wait between Register retries and the tick cadence for Heartbeat.
type RetryConfig struct {
	AttemptTimeout time.Duration
	Interval       time.Duration
}
