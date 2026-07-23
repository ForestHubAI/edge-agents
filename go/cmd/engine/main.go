// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"context"
	"errors"
	"os"
	"os/signal"
	"syscall"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/backend"
	"github.com/ForestHubAI/edge-agents/go/engine/build"
	"github.com/ForestHubAI/edge-agents/go/engine/memory"
	"github.com/ForestHubAI/edge-agents/go/engine/resource"
	"github.com/ForestHubAI/edge-agents/go/engine/websearch"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

func main() {
	env, err := LoadEnvConfig()
	if err != nil {
		// Before logging.Configure, the stdout logger is at info level, so error passes through
		component.BootFail(err, "loading configuration") // malformed env config is permanent
	}
	logging.Configure(env.Log)

	cfg, err := component.LoadConfig[engineapi.EngineConfig]()
	if err != nil {
		component.BootFail(err, "loading engine config")
	}

	// Create backend client only when configured
	var backendClient *backend.Client
	if env.BackendURL != "" {
		backendClient = backend.NewClient(env.BackendURL, env.Secret)
	}

	// A present config with no workflow is still a boot error, not an idle engine:
	// an empty workflow builds into a runner with no triggers that blocks forever
	// doing nothing. SchemaVersion == 0 is the zero-value signal (the contract
	// requires schemaVersion >= 1).
	if cfg.Workflow.SchemaVersion == 0 {
		component.BootFail(errors.New("engine config has no workflow"), "validating engine config")
	}

	// Open every resource main owns for the engine's lifetime as one registry,
	// from the single frozen Resources bundle (device drivers + MQTT/ML endpoints;
	// credentials resolved from the mounted secret store first). Injected into the
	// builder, borrowed by the workflow's channels, closed by main at shutdown.
	secrets, err := component.ReadSecrets()
	if err != nil {
		component.BootFail(err, "loading engine secrets")
	}
	res := engine.ResourcesToDomain(cfg.Resources, secrets)
	resources, err := resource.NewRegistry(res)
	if err != nil {
		if resource.IsTransient(err) {
			// A peer not up yet (e.g. a co-deployed broker still starting) may
			// recover; let the orchestrator retry the boot rather than fail it.
			component.BootRetry(err, "opening resources")
		}
		component.BootFail(err, "opening resources")
	}

	// Memory subsystem: the Manager owns durable local storage rooted at the
	// workspace mount (component.Workspace). Memory is device-storage-only — it
	// survives engine restarts on a persistent volume, with no backend mirror.
	// Reconcile is invoked from Builder.Build at boot, so no eager call here.
	memoryManager := memory.NewManager(component.Workspace)

	// Optional web search provider. Built eagerly so a bad provider name fails
	// fatal at boot; absent api key leaves it nil and any WebSearchTool node
	// in the workflow fails the build with a clear message.
	var webSearchProvider websearch.Provider
	if env.WebSearch.APIKey != "" {
		p, err := websearch.New(env.WebSearch.Provider, env.WebSearch.APIKey)
		if err != nil {
			component.BootFail(err, "configuring web search provider")
		}
		webSearchProvider = p
		logging.Logger.Info().Str("provider", env.WebSearch.Provider).Msg("web search enabled")
	}

	// Retriever: backend if cloud mode, otherwise nil. No offline RAG backend
	// exists yet, and a nil retriever makes the build reject any workflow that
	// declares a Retriever node (clear boot-time error) rather than silently
	// returning empty context at runtime.
	var retriever engine.Retriever
	if backendClient != nil {
		retriever = backendClient
	}

	// Create the builder for the workflow runner. Build resolves the LLM
	// providers from the boot resources, and any backendLlm instance
	// forwards through this backend client (nil = standalone).
	builder := &build.Builder{
		Resources: resources,
		Backend:   backendClient,
		Memory:    memoryManager,
		WebSearch: webSearchProvider,
		Retriever: retriever,
	}

	// One lifecycle context for the whole process: a termination signal cancels it
	// (graceful shutdown); the runner exiting on its own ends the process just the
	// same. The engine serves no inbound HTTP and self-reports no status — liveness
	// is observed externally (Ranger / the container runtime) from its process state.
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		select {
		case <-sigCh:
			logging.Logger.Info().Msg("shutting down")
			cancel()
		case <-ctx.Done():
		}
	}()

	// Build the runner.
	rm := engine.ResourceMappingToDomain(cfg.Mapping)
	runner, err := builder.Build(ctx, &cfg.Workflow, rm, res)
	if err != nil {
		component.BootFail(err, "building workflow runner")
	}

	// Run the workflow, BLOCKING until it exits — on its own (terminal: the
	// workflow stopped or hit a fatal error) or because ctx was cancelled
	// (graceful shutdown). A runner exit is terminal in the immutable model;
	// the exit code surfaces the outcome (nonzero on error) to the supervisor.
	logging.Logger.Info().Msg("engine running")
	runErr := runner.Run(ctx)

	cancel() // also stops the heartbeat on the natural-exit path
	if err := resources.CloseAll(); err != nil {
		logging.Logger.Warn().Err(err).Msg("closing resource registry")
	}
	if runErr != nil && !errors.Is(runErr, context.Canceled) {
		logging.Logger.Fatal().Err(runErr).Msg("runner exited with error")
	}
}
