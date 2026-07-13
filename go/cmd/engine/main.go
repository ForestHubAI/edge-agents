// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/ForestHubAI/edge-agents/go/component/boot"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/backend"
	"github.com/ForestHubAI/edge-agents/go/engine/build"
	"github.com/ForestHubAI/edge-agents/go/engine/driver"
	"github.com/ForestHubAI/edge-agents/go/engine/memory"
	"github.com/ForestHubAI/edge-agents/go/engine/transport"
	"github.com/ForestHubAI/edge-agents/go/engine/websearch"
	"github.com/ForestHubAI/edge-agents/go/logging"
	"github.com/ForestHubAI/edge-agents/go/mapping"
)

func main() {
	cfg, err := LoadConfig()
	if err != nil {
		// Before logging.Configure, the stdout logger is at info level, so error passes through
		boot.Fail(err, "loading configuration") // malformed env config is permanent
	}
	logging.Configure(cfg.Log)

	// Create backend client only when configured
	var backendClient *backend.Client
	if cfg.BackendURL != "" {
		backendClient = backend.NewClient(cfg.BackendURL, cfg.Secret)
	}

	// Load the single boot config file: workflow + bindings + device manifest.
	// A workflow is mandatory — the engine exists only to run one — so a missing
	// config or workflow is a boot error, not an idle engine.
	configFile := component.ConfigFile
	if abs, err := filepath.Abs(configFile); err == nil {
		configFile = abs
	}
	ec, err := loadEngineConfig(configFile)
	if err != nil {
		boot.Fail(err, "loading engine config")
	}
	// A present config with no workflow is still a boot error, not an idle engine:
	// an empty workflow builds into a runner with no triggers that blocks forever
	// doing nothing. SchemaVersion == 0 is the zero-value signal (the contract
	// requires schemaVersion >= 1).
	if ec.Workflow.SchemaVersion == 0 {
		boot.Fail(errors.New("engine config has no workflow"), "validating engine config")
	}

	// Build the I/O registries main owns for the engine's lifetime: drivers from
	// the device manifest, MQTT transports from the external resources. Both are
	// injected into the builder, borrowed by the workflow's channels, and closed
	// by main at shutdown.
	manifest := mapping.DeviceManifestToDomain(ec.Manifest)
	drivers, err := driver.NewRegistry(&manifest)
	if err != nil {
		boot.Fail(err, "initialising driver registry")
	}
	// Resolve resource credentials from the mounted secret store, not env: a
	// dynamic, id-keyed JSON doc mounted read-only at component.SecretsFile,
	// parallel to the boot config file. Absent when no resource needs a secret.
	secrets, err := loadEngineSecrets(component.SecretsFile)
	if err != nil {
		boot.Fail(err, "loading engine secrets")
	}
	ext := mapping.ExternalResourcesToDomain(ec.ExternalResources, secrets)
	transports, err := transport.NewRegistry(ext)
	if err != nil {
		// A broker unreachable at boot may come back; let the orchestrator retry.
		boot.Retry(err, "opening transports")
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
	if cfg.WebSearch.APIKey != "" {
		p, err := websearch.New(cfg.WebSearch.Provider, cfg.WebSearch.APIKey)
		if err != nil {
			boot.Fail(err, "configuring web search provider")
		}
		webSearchProvider = p
		logging.Logger.Info().Str("provider", cfg.WebSearch.Provider).Msg("web search enabled")
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
	// providers from the boot externalResources, and any backendLlm instance
	// forwards through this backend client (nil = standalone).
	builder := &build.Builder{
		Drivers:    drivers,
		Transports: transports,
		Backend:    backendClient,
		Memory:     memoryManager,
		WebSearch:  webSearchProvider,
		Retriever:  retriever,
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
	dm := mapping.ResourceMappingToDomain(ec.Mapping)
	runner, err := builder.Build(ctx, &ec.Workflow, dm, ext)
	if err != nil {
		boot.Fail(err, "building workflow runner")
	}

	// Run the workflow, BLOCKING until it exits — on its own (terminal: the
	// workflow stopped or hit a fatal error) or because ctx was cancelled
	// (graceful shutdown). A runner exit is terminal in the immutable model;
	// the exit code surfaces the outcome (nonzero on error) to the supervisor.
	logging.Logger.Info().Str("config-file", configFile).Msg("engine running")
	runErr := runner.Run(ctx)

	cancel() // also stops the heartbeat on the natural-exit path
	if err := drivers.CloseAll(); err != nil {
		logging.Logger.Warn().Err(err).Msg("closing driver registry")
	}
	if err := transports.CloseAll(); err != nil {
		logging.Logger.Warn().Err(err).Msg("closing transports")
	}
	if runErr != nil && !errors.Is(runErr, context.Canceled) {
		logging.Logger.Fatal().Err(runErr).Msg("runner exited with error")
	}
}

// loadEngineConfig reads the engine's single boot config file (the EngineConfig
// wire shape: workflow + bindings + device manifest). The path is the contract
// mount constant (component.ConfigFile); a missing or malformed file is a fatal
// boot error — the engine exists only to run the workflow this file carries.
func loadEngineConfig(path string) (*engineapi.EngineConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var ec engineapi.EngineConfig
	if err := json.Unmarshal(data, &ec); err != nil {
		return nil, err
	}
	return &ec, nil
}

// loadEngineSecrets reads the mounted secret store (a JSON map of secret id ->
// opaque value) and maps it into the domain secrets the api->domain mapping
// merges into connections. Secrets travel out-of-band in this file, never in the
// deployment spec. A missing file yields no secrets (valid: anonymous broker,
// keyless endpoint); only a present-but-malformed file is a boot error.
func loadEngineSecrets(path string) (engine.Secrets, error) {
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	var wire engineapi.EngineSecrets
	if err := json.Unmarshal(data, &wire); err != nil {
		return nil, fmt.Errorf("%s: %w", path, err)
	}
	return mapping.SecretsToDomain(wire), nil
}
