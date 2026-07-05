// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"fmt"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/node"
	"github.com/ForestHubAI/edge-agents/go/engine/node/trigger"
	"github.com/ForestHubAI/edge-agents/go/mapping"
)

// graph holds the per-build state for a single graph (main workflow or function).
type graph struct {
	*buildContext
	actions  map[string]engine.Executable
	triggers map[string]engine.Trigger
	tools    map[string]engine.Wirable
	allNodes map[string]engine.Wirable // Union of the above three, keyed by node ID. Used for wiring and setup.
}

// newGraph constructs a per-graph builder that shares bc with sibling graphs.
// The collection maps are freshly allocated.
func newGraph(bc *buildContext) *graph {
	return &graph{
		buildContext: bc,
		actions:      make(map[string]engine.Executable),
		triggers:     make(map[string]engine.Trigger),
		tools:        make(map[string]engine.Wirable),
		allNodes:     make(map[string]engine.Wirable),
	}
}

// build instantiates every node and wires edges. Populates actions,
// triggers, tools, and allNodes as a side effect.
// Registers hardware resources in channels as nodes are constructed.
// Returns the initial state (target of the OnStartup/OnFunctionCall edge, or StateIdle if absent).
func (b *graph) build(apiNodes []workflow.Node, edges []workflow.Edge) (string, error) {
	var onStartUpID string // Possible ID of the single OnStartup/OnFunctionCall node

	// Instantiate every node. Unsupported types fail the build.
	for _, n := range apiNodes {
		val, err := n.ValueByDiscriminator()
		if err != nil {
			return "", fmt.Errorf("reading node discriminator: %w", err)
		}
		switch nd := val.(type) {
		// Not a runtime trigger — wireEdges converts its outgoing edge
		// into the runner's initial state (or function entry).
		case workflow.OnStartupNode:
			onStartUpID = nd.Id
		case workflow.OnFunctionCallNode:
			onStartUpID = nd.Id

		case workflow.TickerNode:
			if nd.Arguments.IntervalValue == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "intervalValue"}
			}
			interval := mapping.TickerInterval(*nd.Arguments.IntervalValue, nd.Arguments.IntervalUnit)
			t := trigger.NewTicker(nd.Id, interval)
			b.allNodes[nd.Id] = t
			b.triggers[nd.Id] = t

		case workflow.AlarmNode:
			t, err := trigger.NewAlarm(nd.Id, pointer.Val(nd.Arguments.Time), nd.Arguments.Days)
			if err != nil {
				return "", err
			}
			b.allNodes[nd.Id] = t
			b.triggers[nd.Id] = t

		case workflow.DelayNode:
			if nd.Arguments.DelayMs == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "delayMs"}
			}
			t := trigger.NewDelay(nd.Id, time.Duration(*nd.Arguments.DelayMs)*time.Millisecond)
			b.allNodes[nd.Id] = t
			b.triggers[nd.Id] = t

		case workflow.OnSerialReceiveNode:
			uart, err := b.channels.uart(pointer.Val(nd.Arguments.PortReference))
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			t := trigger.NewOnSerialReceive(nd.Id, uart, nd.Arguments.Output)
			b.allNodes[nd.Id] = t
			b.triggers[nd.Id] = t

		case workflow.OnPinEdgeNode:
			if nd.Arguments.PinReference == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "pinReference"}
			}
			gpioin, err := b.channels.gpioInput(*nd.Arguments.PinReference)
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			t := trigger.NewOnPinEdge(nd.Id, gpioin, trigger.Edge(nd.Arguments.Edge))
			b.allNodes[nd.Id] = t
			b.triggers[nd.Id] = t

		case workflow.OnThresholdNode:
			if nd.Arguments.Variable == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "variable"}
			}
			if nd.Arguments.Threshold == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "threshold"}
			}
			direction := trigger.DirBoth
			if nd.Arguments.Direction != "" {
				direction = trigger.Direction(nd.Arguments.Direction)
			}
			t := trigger.NewOnThreshold(
				nd.Id,
				*nd.Arguments.Variable,
				float64(*nd.Arguments.Threshold),
				direction,
				float64(pointer.Val(nd.Arguments.Deadband)),
				pointer.Ptr(nd.Arguments.Output),
				b.mainScope,
			)
			b.allNodes[nd.Id] = t
			b.triggers[nd.Id] = t

		case workflow.SetVariableNode:
			if nd.Arguments.Variable == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "variable"}
			}
			n := node.NewSetVariable(nd.Id, *nd.Arguments.Variable, nd.Arguments.Value)
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.IfNode:
			n := node.NewIf(nd.Id, nd.Arguments.Condition)
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.ReadPinNode:
			n, err := b.buildReadPin(nd)
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.WritePinNode:
			n, err := b.buildWritePin(nd)
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.SerialReadNode:
			uart, err := b.channels.uart(pointer.Val(nd.Arguments.PortReference))
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			prompt := ""
			if nd.Arguments.Prompt != nil {
				prompt = *nd.Arguments.Prompt
			}
			n := node.NewSerialRead(nd.Id, nd.Arguments.Output, prompt, uart)
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.SerialWriteNode:
			dst, err := b.channels.textWriter(pointer.Val(nd.Arguments.PortReference))
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			n := node.NewSerialWrite(nd.Id, nd.Arguments.Value, dst)
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.MqttPublishNode:
			if nd.Arguments.ChannelReference == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "channelReference"}
			}
			mq, err := b.channels.mqtt(*nd.Arguments.ChannelReference)
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			n := node.NewMqttPublish(nd.Id, mq, mq.Topic, nd.Arguments.DataType, nd.Arguments.Value, byte(nd.Arguments.Qos), nd.Arguments.Retain)
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.OnMqttMessageNode:
			if nd.Arguments.ChannelReference == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "channelReference"}
			}
			mq, err := b.channels.mqtt(*nd.Arguments.ChannelReference)
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			t, err := trigger.NewOnMqttMessage(nd.Id, mq, mq.Topic, nd.Arguments.DataType, nd.Arguments.Output, 0)
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			b.allNodes[nd.Id] = t
			b.triggers[nd.Id] = t

		case workflow.FunctionCallNode:
			fn, ok := b.functions[nd.Id]
			if !ok {
				return "", fmt.Errorf("node %s: function %q not declared in workflow", nd.Id, nd.Id)
			}
			if nd.Arguments.InputBindings == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "inputBindings"}
			}
			if nd.Arguments.OutputBindings == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "outputBindings"}
			}
			n, err := node.NewFunctionCall(nd.Id, fn, *nd.Arguments.InputBindings, *nd.Arguments.OutputBindings, pointer.Val(nd.Arguments.ToolDescription))
			if err != nil {
				return "", fmt.Errorf("node %s: %w", nd.Id, err)
			}
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.RetrieverNode:
			if b.retriever == nil {
				return "", fmt.Errorf("node %s: retriever node requires a configured RAG backend, none available", nd.Id)
			}
			if nd.Arguments.MemoryReference == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "memoryReference"}
			}
			if nd.Arguments.TopK == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "topK"}
			}
			collID, ok := b.collections[*nd.Arguments.MemoryReference]
			if !ok {
				return "", fmt.Errorf("node %s: memory %q is not a declared VectorDatabase", nd.Id, *nd.Arguments.MemoryReference)
			}
			n := node.NewRetriever(nd.Id, collID, *nd.Arguments.TopK, nd.Arguments.Query, nd.Arguments.Output, pointer.Val(nd.Arguments.ToolDescription), b.retriever)
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.WebFetchNode:
			maxChars := 0
			if nd.Arguments.MaxChars != nil {
				maxChars = *nd.Arguments.MaxChars
			}
			n := node.NewWebFetch(nd.Id, nd.Arguments.Url, maxChars, nd.Arguments.Output)
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		case workflow.WebSearchToolNode:
			if b.webSearch == nil {
				return "", fmt.Errorf("node %s: web search tool requires ENGINE_WEB_SEARCH_API_KEY to be configured", nd.Id)
			}
			n := node.NewWebSearchTool(nd.Id, b.webSearch, pointer.Val(nd.Arguments.MaxResults))
			b.allNodes[nd.Id] = n

		case workflow.AgentNode:
			if b.llm == nil {
				return "", fmt.Errorf("node %s: agent node requires an llm client, none configured", nd.Id)
			}
			if nd.Arguments.Model == nil {
				return "", &engine.MissingFieldError{NodeID: nd.Id, Field: "model"}
			}
			n := node.NewAgent(
				nd.Id,
				pointer.Val(nd.Arguments.Name),
				*nd.Arguments.Model,
				nd.Arguments.Instructions,
				nd.Arguments.Answer,
				nd.Arguments.OutputDeclarations,
				nd.Arguments.MemoryRefs,
				nd.Arguments.MaxTurns,
				pointer.Val(nd.Arguments.ToolDescription),
				b.llm,
				b.memory,
			)
			b.allNodes[nd.Id] = n
			b.actions[nd.Id] = n

		default:
			return "", fmt.Errorf("unsupported node type %T", val)
		}
	}

	return b.wireEdges(edges, onStartUpID)
}

// buildReadPin resolves the linked channel from the workflow's
// declarations and constructs the right ReadPin variant for signalType.
func (b *graph) buildReadPin(nd workflow.ReadPinNode) (*node.ReadPin, error) {
	desc := pointer.Val(nd.Arguments.ToolDescription)
	switch nd.Arguments.SignalType {
	case workflow.Digital:
		if nd.Arguments.PinReference == nil {
			return nil, &engine.MissingFieldError{NodeID: nd.Id, Field: "pinReference"}
		}
		v, err := b.channels.gpioInput(*nd.Arguments.PinReference)
		if err != nil {
			return nil, err
		}
		return node.NewReadPinDigital(nd.Id, nd.Arguments.Output, desc, v), nil
	case workflow.Analog:
		if nd.Arguments.PinReference == nil {
			return nil, &engine.MissingFieldError{NodeID: nd.Id, Field: "pinReference"}
		}
		v, err := b.channels.adc(*nd.Arguments.PinReference)
		if err != nil {
			return nil, err
		}
		return node.NewReadPinAnalog(nd.Id, nd.Arguments.Output, desc, v), nil
	default:
		return nil, fmt.Errorf("unknown signalType %q", nd.Arguments.SignalType)
	}
}

// buildWritePin resolves the linked channel and constructs the right
// WritePin variant. Digital → GPIOOUT. Analog → PWM or DAC, picked by
// whichever channel the pinReference resolves to.
func (b *graph) buildWritePin(nd workflow.WritePinNode) (*node.WritePin, error) {
	switch nd.Arguments.SignalType {
	case workflow.Digital:
		if nd.Arguments.PinReference == nil {
			return nil, &engine.MissingFieldError{NodeID: nd.Id, Field: "pinReference"}
		}
		v, err := b.channels.gpioOutput(*nd.Arguments.PinReference)
		if err != nil {
			return nil, err
		}
		return node.NewWritePinDigital(nd.Id, nd.Arguments.Value, v), nil
	case workflow.Analog:
		// Analog pin can be either a PWM or DAC channel. Try PWM first; if
		// the id isn't in the PWM map, fall back to DAC.
		if nd.Arguments.PinReference == nil {
			return nil, &engine.MissingFieldError{NodeID: nd.Id, Field: "pinReference"}
		}
		if pwm, err := b.channels.pwm(*nd.Arguments.PinReference); err == nil {
			return node.NewWritePinPWM(nd.Id, nd.Arguments.Value, pwm), nil
		}
		dac, err := b.channels.dac(*nd.Arguments.PinReference)
		if err != nil {
			return nil, fmt.Errorf("no PWM or DAC channel %q", *nd.Arguments.PinReference)
		}
		return node.NewWritePinDAC(nd.Id, nd.Arguments.Value, dac), nil
	default:
		return nil, fmt.Errorf("unknown signalType %q", nd.Arguments.SignalType)
	}
}

// wireEdges connects nodes based on the workflow's connections and partitions
// tool-wired receivers out of actions into tools.
// Returns the initial state (target of the OnStartup/OnFunctionCall edge, or StateIdle if absent).
func (b *graph) wireEdges(edges []workflow.Edge, onStartupID string) (string, error) {
	// First identify tool-wired receivers and extract them from actions.
	// Done before the wiring pass so control-flow edges can reject a target
	// that's already tool-wired, regardless of edge ordering in the input.
	for _, e := range edges {
		if e.Type != workflow.Tool {
			continue
		}
		n, ok := b.allNodes[e.To.NodeId]
		if !ok {
			return "", fmt.Errorf("tool edge to unknown node %s", e.To.NodeId)
		}
		b.tools[e.To.NodeId] = n
		delete(b.actions, e.To.NodeId)
	}

	initialState := engine.StateIdle
	for _, e := range edges {
		// OnStartup/OnFunctionCall isn't registered in any collection; its outgoing
		// edge defines the runner's initial state rather than a runtime transition.
		if onStartupID == e.From.NodeId {
			initialState = e.To.NodeId
			continue
		}
		emitter, ok := b.allNodes[e.From.NodeId]
		if !ok {
			return "", fmt.Errorf("edge from unknown node %s", e.From.NodeId)
		}
		receiver, ok := b.allNodes[e.To.NodeId]
		if !ok {
			return "", fmt.Errorf("edge to unknown node %s", e.To.NodeId)
		}
		// Tool edge: attach the provider to the agent's tool list
		if e.Type == workflow.Tool {
			tool, ok := receiver.(engine.ToolProvider)
			if !ok {
				return "", fmt.Errorf("tool edge from %s to %s: receiver is not a ToolProvider", e.From.NodeId, e.To.NodeId)
			}
			ag, ok := emitter.(*node.Agent)
			if !ok {
				return "", fmt.Errorf("tool edge from %s to %s: source is not an Agent node", e.From.NodeId, e.To.NodeId)
			}
			ag.AddTool(tool)
			continue
		}

		// Control-flow edge
		if _, isTool := b.tools[e.To.NodeId]; isTool {
			return "", fmt.Errorf("node %s is wired as a tool but also targeted by a control-flow edge from %s", e.To.NodeId, e.From.NodeId)
		}
		tr := engine.Transition{
			TargetID:    e.To.NodeId,
			EdgeType:    e.Type,
			Prompt:      e.Prompt,
			Description: e.Description,
		}
		if err := emitter.AddTransition(e.From.Port, tr); err != nil {
			return "", fmt.Errorf("wiring edge from %s: %w", e.From.NodeId, err)
		}
	}
	return initialState, nil
}

// setupNodes runs each node's Setup once.
// Returns on the first failure; partial state is not
// rolled back — the caller should tear down the driver Registry on error.
func (b *graph) setupNodes() error {
	for id, n := range b.allNodes {
		setup, ok := n.(engine.HasSetup)
		if !ok {
			continue
		}
		if err := setup.Setup(b.ctx); err != nil {
			return fmt.Errorf("setting up node %s: %w", id, err)
		}
	}
	return nil
}
