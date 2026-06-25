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
	// Bootstrap logger (stdout @ info) before LoadConfig so config-load failures
	// are visible. Re-configured below once cfg is available.
	logging.Configure(logging.Config{})

	cfg, err := LoadConfig()
	if err != nil {
		logging.Logger.Fatal().Err(err).Msg("loading configuration")
	}

	// Wire the real sinks from cfg.Log (stdout always; opt-in file + HTTP). The
	// component name is a code constant, not env; the deployment dimension is never
	// a logger field — it is structural, carried by the on-device log path Ranger
	// assigns (device-filesystem.md §5). The closer drains in-flight HTTP sends so
	// Fatal events land before exit.
	cfg.Log.Component = "engine"
	closer := logging.Configure(cfg.Log)
	defer closer.Close()

	logging.Logger.Info().Str("version", Version).Msg("starting engine")

	// Create backend client only when configured
	var backendClient *backend.Client
	if cfg.BackendURL != "" {
		backendClient = backend.NewClient(cfg.BackendURL, cfg.Secret)
	}

	// bootFail logs a fatal boot error and exits nonzero. In the immutable model a
	// boot failure ends the process; Ranger (or the container runtime) observes the
	// nonzero exit as a failed container — the engine no longer self-reports status.
	bootFail := func(cause error, msg string) {
		logging.Logger.Fatal().Err(cause).Msg(msg)
	}

	// Create LLM provider registry and client. Locally-configured providers
	// take precedence; any provider the backend exposes that the engine lacks
	// a key for is registered as a backend-routed stand-in.
	loadCtx, cancelLoad := context.WithTimeout(context.Background(), backend.ProviderLoadTimeout)
	llmProviders := buildLLMProviders(loadCtx, cfg.LLM, backendClient)
	cancelLoad() // Release loadCtx resources

	// Load the single boot config file: workflow + bindings + device manifest.
	// A workflow is mandatory — the engine exists only to run one — so a missing
	// config or workflow is a boot error, not an idle engine.
	configFile := component.ConfigFile
	if abs, err := filepath.Abs(configFile); err == nil {
		configFile = abs
	}
	ec, err := loadEngineConfig(configFile)
	if err != nil {
		bootFail(err, "loading engine config")
	}
	// A present config with no workflow is still a boot error, not an idle engine:
	// an empty workflow builds into a runner with no triggers that blocks forever
	// doing nothing. SchemaVersion == 0 is the zero-value signal (the contract
	// requires schemaVersion >= 1).
	if ec.Workflow.SchemaVersion == 0 {
		bootFail(errors.New("engine config has no workflow"), "validating engine config")
	}

	// Build the I/O registries main owns for the engine's lifetime: drivers from
	// the device manifest, MQTT transports from the deploy's external resources.
	// Both are injected into the builder, borrowed by the workflow's channels,
	// and closed by main at shutdown.
	manifest := mapping.DeviceManifestToDomain(ec.Manifest)
	drivers, err := driver.NewRegistry(&manifest)
	if err != nil {
		bootFail(err, "initialising driver registry")
	}
	resourceSecrets, err := parseResourceSecrets(cfg.ResourceSecrets)
	if err != nil {
		bootFail(err, "parsing resource secrets")
	}
	ext := mapping.ExternalResourcesToDomain(ec.ExternalResources, resourceSecrets)
	transports, err := transport.NewRegistry(ext)
	if err != nil {
		bootFail(err, "opening transports")
	}

	// Memory subsystem: the Manager owns durable local storage rooted at the
	// workspace mount (component.Workspace; declared memory survives engine
	// restarts with no backend). The backend, when configured, is an optional
	// remote mirror — it hydrates an empty local copy on a cold start and receives
	// best-effort pushes; nil means local-only. Restore is invoked on every Build
	// (deploy or initial), so no eager call here.
	var memorySync engine.MemorySync
	if backendClient != nil {
		memorySync = backendClient
	}
	memoryManager := memory.NewManager(component.Workspace, memorySync)

	// Optional web search provider. Built eagerly so a bad provider name fails
	// fatal at boot; absent api key leaves it nil and any WebSearchTool node
	// in a deployed workflow fails the build with a clear message.
	var webSearchProvider websearch.Provider
	if cfg.WebSearch.APIKey != "" {
		p, err := websearch.New(cfg.WebSearch.Provider, cfg.WebSearch.APIKey)
		if err != nil {
			bootFail(err, "configuring web search provider")
		}
		webSearchProvider = p
		logging.Logger.Info().Str("provider", cfg.WebSearch.Provider).Msg("web search enabled")
	}

	// Retriever: backend if cloud mode, otherwise nil. No offline RAG backend
	// exists yet, and a nil retriever makes the build reject any workflow that
	// declares a Retriever node (clear deploy-time error) rather than silently
	// returning empty context at runtime.
	var retriever engine.Retriever
	if backendClient != nil {
		retriever = backendClient
	}

	// Create the builder for the workflow runner.
	builder := &build.Builder{
		Drivers:      drivers,
		Transports:   transports,
		LLMProviders: llmProviders,
		Memory:       memoryManager,
		WebSearch:    webSearchProvider,
		Retriever:    retriever,
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

	// Build the runner. A build failure exits nonzero (Ranger observes a failed
	// container); there is no "online" callback for it to contradict.
	dm := mapping.DeploymentMappingToDomain(ec.Mapping)
	runner, err := builder.Build(ctx, &ec.Workflow, dm, ext)
	if err != nil {
		bootFail(err, "building workflow runner")
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

// parseResourceSecrets decodes the FH_RESOURCE_SECRETS env (a JSON map of
// external-resource id -> credentials) into the domain secrets the api->domain
// mapping merges into connections. Secrets travel out-of-band, never in the
// deployment spec. An empty/unset value yields no secrets.
func parseResourceSecrets(raw string) (engine.ResourceSecrets, error) {
	if raw == "" {
		return nil, nil
	}
	var s engine.ResourceSecrets
	if err := json.Unmarshal([]byte(raw), &s); err != nil {
		return nil, fmt.Errorf("FH_RESOURCE_SECRETS: %w", err)
	}
	return s, nil
}
