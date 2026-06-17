package main

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/backend"
	"github.com/ForestHubAI/edge-agents/go/engine/build"
	"github.com/ForestHubAI/edge-agents/go/engine/driver"
	"github.com/ForestHubAI/edge-agents/go/engine/memory"
	"github.com/ForestHubAI/edge-agents/go/engine/transport"
	"github.com/ForestHubAI/edge-agents/go/engine/websearch"
	"github.com/ForestHubAI/edge-agents/go/logging"
	"github.com/ForestHubAI/edge-agents/go/mapping"
	"github.com/rs/zerolog"
)

func main() {
	// Bootstrap a stderr logger before LoadConfig so config-load failures
	// are visible. Re-configured below once cfg is available.
	logging.Configure(zerolog.InfoLevel, os.Stderr)

	cfg, err := LoadConfig()
	if err != nil {
		logging.Logger.Fatal().Err(err).Msg("loading configuration")
	}

	// Re-configure with the user-requested level and the optional HTTPWriter
	// once cfg is available. Closer drains in-flight HTTP sends so Fatal
	// events reach the HTTPWriter before exit.
	level, err := logging.ParseLevel(cfg.LogLevel)
	if err != nil {
		logging.Logger.Warn().Err(err).Str("input", cfg.LogLevel).Msg("invalid log level; falling back to info")
	}
	writers := []io.Writer{os.Stderr}
	if cfg.BackendURL != "" && cfg.Secret != "" {
		writers = append(writers, logging.NewHTTPWriter(cfg.BackendURL+"/agents/logs", "Agent-Key", cfg.Secret))
	}
	closer := logging.Configure(level, writers...)
	defer closer.Close()
	logging.Logger.Info().Str("version", Version).Msg("starting engine")
	if cfg.BackendURL != "" && cfg.Secret == "" {
		logging.Logger.Warn().Msg("FH_BACKEND_URL set but ENGINE_SECRET empty — HTTP log pushes will 401")
	}

	// Create backend client only when configured
	var backendClient *backend.Client
	if cfg.BackendURL != "" {
		backendClient = backend.NewClient(cfg.BackendURL, cfg.Secret)
	}

	// loadedManifest tracks the device manifest once it parses, so a boot error
	// after that point can report it; it stays nil if the manifest itself fails
	// to load (matching AgentBootCallback's "null on booterror" contract).
	var loadedManifest *engine.DeviceManifest

	// bootFail reports a booterror callback to the backend (best-effort, single
	// bounded attempt) when one is configured, then exits. Used for every
	// boot-sequence failure so the backend records status=error instead of
	// inferring it from a missed heartbeat. Reached only before the online
	// registration below, so the two never contradict each other.
	bootFail := func(cause error, msg string) {
		if backendClient != nil {
			errStr := cause.Error()
			reportCtx, cancel := context.WithTimeout(context.Background(), backend.BootCallbackTimeout)
			rerr := backendClient.Register(reportCtx, engine.AgentRegistration{
				Status:       engine.StatusBootError,
				Manifest:     loadedManifest,
				Error:        &errStr,
				DeploymentID: cfg.DeploymentID,
			})
			cancel()
			if rerr != nil {
				logging.Logger.Warn().Err(rerr).Msg("reporting boot error to backend")
			}
		}
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
	configFile := cfg.ConfigFile
	if configFile != "" {
		if abs, err := filepath.Abs(configFile); err == nil {
			configFile = abs
		}
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
	loadedManifest = &manifest
	drivers, err := driver.NewRegistry(&manifest)
	if err != nil {
		bootFail(err, "initialising driver registry")
	}
	ext := mapping.ExternalResourcesToDomain(ec.ExternalResources)
	transports, err := transport.NewRegistry(ext)
	if err != nil {
		bootFail(err, "opening transports")
	}

	// Memory subsystem: the Manager owns durable local storage rooted at
	// cfg.MemoryDir (declared memory survives engine restarts with no
	// backend). The backend, when configured, is an optional remote mirror —
	// it hydrates an empty local copy on a cold start and receives best-effort
	// pushes; nil means local-only. Restore is invoked on every Build (deploy
	// or initial), so no eager call here.
	var memorySync engine.MemorySync
	if backendClient != nil {
		memorySync = backendClient
	}
	memoryManager := memory.NewManager(cfg.MemoryDir, memorySync)

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

	// One lifecycle context for the whole process: the workflow runner and the
	// heartbeat both run under it. A termination signal cancels it (graceful
	// shutdown); the runner exiting on its own ends the process just the same.
	// The engine reports OUT only — it serves no inbound HTTP and advertises no
	// address, since nothing connects back to it; liveness is observed from its
	// container/process state.
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

	// Build the runner before the online registration so a build failure reports
	// as a boot error rather than contradicting an already-sent "online" callback.
	dm := mapping.DeploymentMappingToDomain(ec.Mapping)
	runner, err := builder.Build(ctx, &ec.Workflow, dm, ext)
	if err != nil {
		bootFail(err, "building workflow runner")
	}

	// Boot-time self-registration: RegisterWithRetry runs in its own goroutine so
	// a cold-started backend does not block boot. Once Register succeeds,
	// HeartbeatLoop takes over for periodic liveness; both stop when ctx is
	// cancelled.
	if backendClient != nil {
		reg := engine.AgentRegistration{
			Status:       engine.StatusOnline,
			Manifest:     &manifest,
			DeploymentID: cfg.DeploymentID,
		}
		registerCfg := engine.RetryConfig{
			AttemptTimeout: backend.BootCallbackTimeout,
			Interval:       backend.RegisterRetryInterval,
		}
		heartbeatCfg := engine.RetryConfig{
			AttemptTimeout: backend.HeartbeatTimeout,
			Interval:       backend.HeartbeatInterval,
		}
		go func() {
			engine.RegisterWithRetry(ctx, backendClient, reg, registerCfg)
			if ctx.Err() != nil {
				return
			}
			engine.HeartbeatLoop(ctx, backendClient, "", heartbeatCfg)
		}()
	} else {
		logging.Logger.Info().Msg("FH_BACKEND_URL or ENGINE_SECRET not set, skipping self-registration")
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
// wire shape: workflow + bindings + device manifest). The path is mandatory —
// the engine exists only to run the workflow this file carries, so an empty path
// (ENGINE_CONFIG_FILE unset), or a missing or malformed file, is a fatal boot
// error.
func loadEngineConfig(path string) (*engineapi.EngineConfig, error) {
	if path == "" {
		return nil, errors.New("ENGINE_CONFIG_FILE not set")
	}
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
