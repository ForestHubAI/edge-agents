// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"context"
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/backend"
	"github.com/ForestHubAI/edge-agents/go/engine/driver"
	"github.com/ForestHubAI/edge-agents/go/engine/memory"
	"github.com/ForestHubAI/edge-agents/go/engine/transport"
	"github.com/ForestHubAI/edge-agents/go/engine/websearch"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
)

// Builder holds the engine-scoped dependencies needed to construct a Runner.
// Backend (optional; nil = standalone) is the client every backend-routed LLM
// provider forwards to; Build resolves the boot externalResources into the
// llmproxy client scoped to the Runner.
type Builder struct {
	Drivers    *driver.Registry
	Transports *transport.Registry
	Backend    *backend.Client
	Memory     *memory.Manager
	Retriever  engine.Retriever
	WebSearch  websearch.Provider // optional; nil disables WebSearchTool nodes
}

// Build constructs a Runner for the given workflow, resource mapping (dm), and
// external resources (ext); ext may be nil. Refreshes the memory snapshot before
// assembling nodes so agent nodes see the latest declared files.
func (b *Builder) Build(ctx context.Context, wf *workflowapi.Workflow, dm engine.ResourceMapping, ext *engine.ExternalResources) (*engine.Runner, error) {
	if b.Memory != nil {
		declared, err := declaredMemoryFiles(wf)
		if err != nil {
			return nil, fmt.Errorf("memory: reading declared files: %w", err)
		}
		if err := b.Memory.Reconcile(ctx, declared); err != nil {
			return nil, fmt.Errorf("reconciling memory: %w", err)
		}
	}
	// Compose the LLM client from the boot externalResources: catalog providers
	// plus any custom-model self-hosted endpoints. The client is scoped to this
	// Runner and GC'd on shutdown.
	providers, err := buildProviders(wf, dm, ext, b.Backend)
	if err != nil {
		return nil, fmt.Errorf("resolving llm providers: %w", err)
	}
	llmClient := llmproxy.NewClient(providers)
	if err := validateModelsResolvable(wf, llmClient); err != nil {
		return nil, fmt.Errorf("resolving referenced models: %w", err)
	}

	runner, err := buildRunner(ctx, wf, dm, ext, b.Transports, b.Drivers, llmClient, b.Memory, b.Retriever, b.WebSearch)
	if err != nil {
		return nil, err
	}
	return runner, nil
}

// declaredMemoryFiles extracts the MemoryFile declarations from a workflow,
// skipping other memory kinds (e.g. VectorDatabase, consumed by Retriever
// nodes). These are the canonical set of files the memory Manager restores.
func declaredMemoryFiles(wf *workflowapi.Workflow) ([]workflowapi.MemoryFile, error) {
	var out []workflowapi.MemoryFile
	for i, m := range wf.Memory {
		disc, err := m.Discriminator()
		if err != nil {
			return nil, fmt.Errorf("memory[%d]: %w", i, err)
		}
		if disc != string(workflowapi.MemoryFileTypeMemoryFile) {
			continue
		}
		mf, err := m.AsMemoryFile()
		if err != nil {
			return nil, fmt.Errorf("memory[%d]: %w", i, err)
		}
		out = append(out, mf)
	}
	return out, nil
}

// buildCollections resolves each declared VectorDatabase to its collection id
// through the resource mapping, skipping other memory kinds. Hard-fails on a
// missing binding, exactly as buildChannels does for hardware/MQTT channels.
func buildCollections(wf *workflowapi.Workflow, dm engine.ResourceMapping) (map[string]string, error) {
	out := make(map[string]string)
	for i, m := range wf.Memory {
		disc, err := m.Discriminator()
		if err != nil {
			return nil, fmt.Errorf("memory[%d]: %w", i, err)
		}
		if disc != string(workflowapi.VectorDatabaseTypeVectorDatabase) {
			continue
		}
		vd, err := m.AsVectorDatabase()
		if err != nil {
			return nil, fmt.Errorf("memory[%d]: %w", i, err)
		}
		b, err := bindingFor(dm, vd.Id)
		if err != nil {
			return nil, err
		}
		out[vd.Id] = b.Ref
	}
	return out, nil
}

// buildContext holds the inputs shared across every graph build.
type buildContext struct {
	ctx         context.Context
	channels    *channels                   // typed channel registry; nodes look up their linked channel here
	collections map[string]string           // resolved VectorDatabase id → collection id; Retriever nodes look up their collection here
	functions   map[string]*engine.Function // assembly-time registry; FunctionCall nodes resolve their target through this
	mainScope   *engine.Scope
	// clients for building nodes that rely on external services
	llm       engine.LlmClient
	memory    *memory.Manager
	retriever engine.Retriever
	webSearch websearch.Provider
}

// buildRunner assembles a Runner from workflow, configuration and clients
func buildRunner(ctx context.Context, wf *workflowapi.Workflow, dm engine.ResourceMapping, ext *engine.ExternalResources, transports *transport.Registry, drivers *driver.Registry, llm engine.LlmClient, mem *memory.Manager, ret engine.Retriever, webSearch websearch.Provider) (*engine.Runner, error) {
	// Create main scope
	ms, err := engine.NewMainScope(wf.DeclaredVariables)
	if err != nil {
		return nil, fmt.Errorf("creating main scope: %w", err)
	}

	// Build channels first as they orchestrate hardware resources
	chs, err := buildChannels(wf.Channels, dm, drivers, transports, ext)
	if err != nil {
		return nil, fmt.Errorf("channels: %w", err)
	}

	// Resolve declared VectorDatabases to their bound collection ids
	collections, err := buildCollections(wf, dm)
	if err != nil {
		return nil, fmt.Errorf("collections: %w", err)
	}

	// Forward declare functions so FunctionCall nodes can resolve them during build()
	functions := make(map[string]*engine.Function, len(wf.Functions))
	for i := range wf.Functions {
		fi := wf.Functions[i].FunctionInfo
		functions[fi.Id] = &engine.Function{Info: fi}
	}

	bc := &buildContext{ctx: ctx, channels: chs, collections: collections, functions: functions, mainScope: ms, llm: llm, memory: mem, retriever: ret, webSearch: webSearch}

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
	return r, nil
}
