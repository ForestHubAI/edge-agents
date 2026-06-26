package node

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/channel"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// Implementation guards
var _ engine.Executable = (*MicrophoneCapture)(nil)
var _ engine.Emitter = (*MicrophoneCapture)(nil)

const microphoneCaptureOutID = "output"

// MicrophoneCapture records one clip from a microphone channel, emits it through
// the output binding as an opaque audio value, and advances.
type MicrophoneCapture struct {
	engine.LinearNode
	binding    workflow.OutputBinding
	microphone *channel.Microphone
}

// NewMicrophoneCapture builds a MicrophoneCapture bound to the given microphone channel.
func NewMicrophoneCapture(id string, binding workflow.OutputBinding, microphone *channel.Microphone) *MicrophoneCapture {
	return &MicrophoneCapture{
		LinearNode: engine.NewLinearNode(id),
		binding:    binding,
		microphone: microphone,
	}
}

func (m *MicrophoneCapture) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	clip, err := m.microphone.Capture(ctx)
	if err != nil {
		return "", fmt.Errorf("microphoneCapture %s: %w", m.ID(), err)
	}
	if err := engine.ApplyOutput(scope, m.ID(), microphoneCaptureOutID, m.binding, expr.AudioVal(clip)); err != nil {
		return "", fmt.Errorf("microphoneCapture %s: applying output: %w", m.ID(), err)
	}
	return m.Next(engine.PortCtrl, scope)
}

// Outputs declares the single "output" slot — audio. Returns it only if the
// binding is emit-mode (assign/discard don't materialize a variable).
func (m *MicrophoneCapture) Outputs() map[string]workflow.DataType {
	return engine.FilterEmitted(
		map[string]workflow.DataType{microphoneCaptureOutID: workflow.Audio},
		map[string]workflow.OutputBinding{microphoneCaptureOutID: m.binding},
	)
}
