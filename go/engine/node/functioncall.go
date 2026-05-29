package node

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/schemautil"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"
	"github.com/ForestHubAI/edge-agents/go/mapping"
)

// Implementation guards
var _ engine.Executable = (*FunctionCall)(nil)
var _ engine.Emitter = (*FunctionCall)(nil)
var _ engine.ToolProvider = (*FunctionCall)(nil)

// FunctionCall invokes a compiled engine.Function. It evaluates input
// bindings in the surrounding scope, runs the function and applies output bindings back
// to the surrounding scope.
type FunctionCall struct {
	engine.LinearNode
	fn              *engine.Function
	inputBindings   map[string]workflow.Expression    // arg uid → expression
	outputBindings  map[string]workflow.OutputBinding // return uid → binding
	toolDescription string
}

// NewFunctionCall builds a FunctionCall. Validates that every declared return
// has a matching output binding.
func NewFunctionCall(id string, fn *engine.Function, inputBindings map[string]workflow.Expression, outputBindings map[string]workflow.OutputBinding, toolDescription string) (*FunctionCall, error) {
	for _, ret := range fn.Info.Returns {
		if _, ok := outputBindings[ret.Uid]; !ok {
			return nil, fmt.Errorf("function_call %s: missing output binding for return %s (uid %s)", id, ret.Name, ret.Uid)
		}
	}
	for _, arg := range fn.Info.Arguments {
		if _, ok := inputBindings[arg.Uid]; !ok {
			return nil, fmt.Errorf("function_call %s: missing input binding for argument %s (uid %s)", id, arg.Name, arg.Uid)
		}
	}
	return &FunctionCall{
		LinearNode:      engine.NewLinearNode(id),
		fn:              fn,
		inputBindings:   inputBindings,
		outputBindings:  outputBindings,
		toolDescription: toolDescription,
	}, nil
}

func (n *FunctionCall) Outputs() map[string]workflow.DataType {
	raw := make(map[string]workflow.DataType, len(n.fn.Info.Returns))
	for _, ret := range n.fn.Info.Returns {
		raw[ret.Uid] = ret.DataType
	}
	return engine.FilterEmitted(raw, n.outputBindings)
}

func (n *FunctionCall) Execute(ctx context.Context, scope *engine.Scope) (string, error) {
	args := make(map[string]expr.Value, len(n.fn.Info.Arguments))
	for _, arg := range n.fn.Info.Arguments {
		v, err := expr.Eval(n.inputBindings[arg.Uid], scope)
		if err != nil {
			return "", fmt.Errorf("function_call %s: argument %s: %w", n.ID(), arg.Name, err)
		}
		args[arg.Uid] = v.Cast(arg.DataType)
	}

	results, err := n.fn.Call(ctx, args)
	if err != nil {
		return "", fmt.Errorf("function_call %s: %w", n.ID(), err)
	}

	for _, ret := range n.fn.Info.Returns {
		if err := engine.ApplyOutput(scope, n.ID(), ret.Uid, n.outputBindings[ret.Uid], results[ret.Uid]); err != nil {
			return "", fmt.Errorf("function_call %s: applying output %s: %w", n.ID(), ret.Name, err)
		}
	}
	return n.Next(engine.PortCtrl, scope)
}

// Tools exposes this function as an LLM-callable tool.
func (n *FunctionCall) Tools() ([]llmproxy.FunctionTool, error) {
	properties := make(map[string]any, len(n.fn.Info.Arguments))
	argByName := make(map[string]workflow.Variable, len(n.fn.Info.Arguments))
	for _, a := range n.fn.Info.Arguments {
		properties[a.Name] = map[string]any{"type": mapping.JSONTypeFor(a.DataType)}
		argByName[a.Name] = a
	}
	returnByUid := make(map[string]workflow.Variable, len(n.fn.Info.Returns))
	for _, r := range n.fn.Info.Returns {
		returnByUid[r.Uid] = r
	}

	ft := llmproxy.FunctionTool{
		ExternalToolBase: llmproxy.ExternalToolBase{
			Name:        n.fn.Info.Name,
			Description: n.toolDescription,
			Parameters:  schemautil.StrictObject(properties),
		},
		ToolCall: func(ctx context.Context, arguments json.RawMessage) (any, error) {
			var in map[string]any
			if len(arguments) > 0 {
				if err := json.Unmarshal(arguments, &in); err != nil {
					return nil, fmt.Errorf("function_call %s: parse arguments: %w", n.ID(), err)
				}
			}
			args := make(map[string]expr.Value, len(argByName))
			for argName, meta := range argByName {
				raw, ok := in[argName]
				if !ok {
					return nil, fmt.Errorf("function_call %s: missing argument %q", n.ID(), argName)
				}
				v, err := expr.Coerce(meta.DataType, raw)
				if err != nil {
					return nil, fmt.Errorf("function_call %s: argument %q: %w", n.ID(), argName, err)
				}
				args[meta.Uid] = v
			}
			results, err := n.fn.Call(ctx, args)
			if err != nil {
				return nil, fmt.Errorf("function_call %s: %w", n.ID(), err)
			}
			out := make(map[string]any, len(results))
			for uid, v := range results {
				out[returnByUid[uid].Name] = v.Raw
			}
			return out, nil
		},
	}
	return []llmproxy.FunctionTool{ft}, nil
}
