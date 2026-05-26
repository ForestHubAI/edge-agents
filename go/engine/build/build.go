package build

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/fh-core/go/api/workflow"

	"github.com/ForestHubAI/fh-core/go/llmproxy"

	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/backend"
	"github.com/ForestHubAI/fh-core/go/engine/driver"
	"github.com/ForestHubAI/fh-core/go/engine/memory"
	"github.com/ForestHubAI/fh-core/go/engine/transport"
	"github.com/ForestHubAI/fh-core/go/engine/websearch"
)

// Builder holds the engine-scoped dependencies needed to construct a Runner.
type Builder struct {
	Drivers   *driver.Registry
	LLM       *llmproxy.Client
	Memory    *memory.Manager
	WebSearch websearch.Provider // optional; nil disables WebSearchTool nodes
}

// Build constructs a Runner for the given workflow and network manifest.
// nm may be nil. Refreshes the memory snapshot before assembling nodes so
// agent nodes see the latest declared files (including any seeded by the
// current deploy).
func (b *Builder) Build(ctx context.Context, wf *workflow.Workflow, nm *engine.NetworkManifest) (*engine.Runner, error) {
	if b.Memory != nil {
		if err := b.Memory.Restore(ctx); err != nil {
			return nil, fmt.Errorf("refreshing memory: %w", err)
		}
	}
	transports, err := transport.NewRegistry(nm)
	if err != nil {
		return nil, fmt.Errorf("creating transport registry: %w", err)
	}
	runner, err := buildRunner(ctx, wf, nm, transports, b.Drivers, b.Backend, b.LLM, b.Memory, b.WebSearch)
	if err != nil {
		transports.CloseAll()
		return nil, err
	}
	return runner, nil
}

// buildContext holds the inputs shared across every graph build.
type buildContext struct {
	ctx       context.Context
	channels  *channels                   // typed channel registry; nodes look up their linked channel here
	functions map[string]*engine.Function // assembly-time registry; FunctionCall nodes resolve their target through this
	mainScope *engine.Scope
	// clients for building nodes that rely on external services
	backend   *backend.Client
	llm       *llmproxy.Client
	memory    *memory.Manager
	webSearch websearch.Provider
}

// buildRunner assembles a Runner from workflow, configuration and clients
func buildRunner(ctx context.Context, wf *workflow.Workflow, nm *engine.NetworkManifest, transports *transport.Registry, drivers *driver.Registry, backend *backend.Client, llm *llmproxy.Client, mem *memory.Manager, webSearch websearch.Provider) (*engine.Runner, error) {
	// Create main scope
	ms, err := engine.NewMainScope(wf.DeclaredVariables)
	if err != nil {
		return nil, fmt.Errorf("creating main scope: %w", err)
	}

	// Build channels first as they orchestrate hardware resources
	chs, err := buildChannels(wf.Channels, drivers, transports, nm)
	if err != nil {
		return nil, fmt.Errorf("channels: %w", err)
	}

	// Forward declare functions so FunctionCall nodes can resolve them during build()
	functions := make(map[string]*engine.Function, len(wf.Functions))
	for i := range wf.Functions {
		fi := wf.Functions[i].FunctionInfo
		functions[fi.Id] = &engine.Function{Info: fi}
	}

	bc := &buildContext{ctx: ctx, channels: chs, functions: functions, mainScope: ms, backend: backend, llm: llm, memory: mem, webSearch: webSearch}

	// Build each function body in its own builder.
	functionGraphs := make([]*graph, 0, len(wf.Functions))
	for i := range wf.Functions {
		f := wf.Functions[i]
		b := newGraph(bc)
		initialState, err := b.build(f.Nodes, f.Edges)
		if err != nil {
			return nil, fmt.Errorf("function %s: %w", f.FunctionInfo.Name, err)
		}
		if len(b.triggers) > 0 {
			return nil, fmt.Errorf("function %s: runtime triggers not allowed in function body", f.FunctionInfo.Name)
		}
		if initialState == engine.StateIdle {
			return nil, fmt.Errorf("function %s: missing OnFunctionCall trigger (no entry edge)", f.FunctionInfo.Name)
		}
		// Set built data on the Function object
		target := functions[f.FunctionInfo.Id]
		target.InitialState = initialState
		target.Actions = b.actions
		target.DeclaredVars = f.DeclaredVariables
		target.OutputAssignments = f.OutputAssignments
		functionGraphs = append(functionGraphs, b)
	}

	// Build the main graph
	mainGraph := newGraph(bc)
	initialState, err := mainGraph.build(wf.Nodes, wf.Edges)
	if err != nil {
		return nil, err
	}

	// All graphs are built; all hardware resources registered. Configure the
	// underlying hardware once via every channel's Setup.
	if err := chs.SetupAll(); err != nil {
		return nil, fmt.Errorf("channels setup: %w", err)
	}

	// Per-graph node setup. Order across graphs is irrelevant
	for i, g := range functionGraphs {
		if err := g.setupNodes(); err != nil {
			return nil, fmt.Errorf("function %s: %w", wf.Functions[i].FunctionInfo.Name, err)
		}
	}
	if err := mainGraph.setupNodes(); err != nil {
		return nil, err
	}

	// Pre-populate the main scope with zero values for each node's declared
	// output slots so downstream expressions can resolve references before
	// the producing node has fired. Tools are intentionally excluded.
	// Function graphs will do the same once Function sets up its own scope at runtime.
	for _, a := range mainGraph.actions {
		if em, ok := a.(engine.Emitter); ok {
			engine.RegisterNodeOutputs(ms, em)
		}
	}
	for _, t := range mainGraph.triggers {
		if em, ok := t.(engine.Emitter); ok {
			engine.RegisterNodeOutputs(ms, em)
		}
	}

	r := &engine.Runner{
		Scope:        ms,
		Nodes:        mainGraph.actions,
		Triggers:     mainGraph.triggers,
		InitialState: initialState,
	}
	// Ownership transfers to Runner; Run's defer chain releases on ctx cancellation.
	r.Transports = transports
	return r, nil
}
