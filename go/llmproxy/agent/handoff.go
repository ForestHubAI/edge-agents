package agent

import "github.com/ForestHubAI/fh-core/go/llmproxy"

var NoParamsSchema = map[string]any{
	"type":       "object",
	"properties": map[string]any{},
}

// Handoff is an external tool that represents handing off control to another agent.
type Handoff struct {
	llmproxy.ExternalToolBase

	Agent *Agent `json:"-"`

	// Optional model override for the handoff agent. If not set, the runner's default model will be used instead.
	Model *llmproxy.ModelID `json:"-"`
}

// NewHandoff creates a new Handoff tool that invokes the given agent.
func NewHandoff(name, description string, agent *Agent, model *llmproxy.ModelID) Handoff {
	return Handoff{
		ExternalToolBase: llmproxy.ExternalToolBase{
			Name:        name,
			Description: description,
			Parameters:  NoParamsSchema,
		},
		Agent: agent,
		Model: model,
	}
}
