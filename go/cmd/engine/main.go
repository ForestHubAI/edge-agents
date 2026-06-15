package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/backend"
	"github.com/ForestHubAI/edge-agents/go/engine/build"
	"github.com/ForestHubAI/edge-agents/go/engine/driver"
	"github.com/ForestHubAI/edge-agents/go/engine/memory"
	"github.com/ForestHubAI/edge-agents/go/engine/websearch"
	"github.com/ForestHubAI/edge-agents/go/logging"
	"github.com/ForestHubAI/edge-agents/go/mapping"
	"github.com/rs/zerolog"

	"github.com/go-chi/chi/v5"
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
	// events reach the backend before exit.
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

	// Create backend client only when an endpoint is actually configured.
	// A nil client signals "standalone mode" to every downstream consumer
	// (LLM provider discovery, memory store, retriever, lifecycle goroutine)
	// so they fall back to the offline defaults in engine/local.
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
				Address:      cfg.PublicAddress,
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

	// Only normalise if the operator actually opted into file mode. An empty
	// path stays empty so the deploy handler can surface a clear "not configured"
	// error instead of trying to read the process working directory.
	workflowFile := cfg.WorkflowFile
	if workflowFile != "" {
		if abs, err := filepath.Abs(workflowFile); err == nil {
			workflowFile = abs
		}
	}

	// Load device manifest and build driver registry
	manifest, err := loadManifest(cfg.DeviceManifestFile)
	if err != nil {
		bootFail(err, "loading driver manifest")
	}
	loadedManifest = &manifest
	drivers, err := driver.NewRegistry(&manifest)
	if err != nil {
		bootFail(err, "initialising driver registry")
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

	// Create builder and engine
	builder := &build.Builder{
		Drivers:      drivers,
		LLMProviders: llmProviders,
		Memory:       memoryManager,
		WebSearch:    webSearchProvider,
		Retriever:    retriever,
	}
	eng := &engine.Engine{
		Secret:  cfg.Secret,
		Builder: builder.Build,
	}

	// Deploy workflow from file if configured
	if workflowFile != "" {
		wfData, err := os.ReadFile(workflowFile)
		if err != nil {
			bootFail(err, "reading workflow file")
		}
		var wf workflow.Workflow
		if err := json.Unmarshal(wfData, &wf); err != nil {
			bootFail(err, "parsing workflow file")
		}
		ext, err := loadExternalResources(cfg.ExternalResourcesFile)
		if err != nil {
			bootFail(err, "loading external resources")
		}
		dm, err := loadDeploymentMapping(cfg.DeploymentMappingFile)
		if err != nil {
			bootFail(err, "loading deployment mapping")
		}
		if err := eng.Deploy(&wf, dm, ext); err != nil {
			bootFail(err, "deploying workflow from file")
		}
	}

	// HTTP surface is the oapi-codegen strict server generated from
	// openapi.yaml. The bearer-secret check runs as a strict middleware so
	// it applies uniformly to every operation.
	r := chi.NewRouter()
	strictHandler := engineapi.NewStrictHandler(
		NewStrictServer(eng),
		[]engineapi.StrictMiddlewareFunc{AuthMiddleware(cfg.Secret)},
	)
	engineapi.HandlerFromMux(strictHandler, r)

	server := &http.Server{Addr: cfg.ListenAddr, Handler: r}

	// Boot-time self-registration: RegisterWithRetry runs in its own goroutine
	// so a cold-started backend does not delay the listen-port. Once Register
	// succeeds, HeartbeatLoop takes over for periodic liveness. Both share
	// liveCtx, which is canceled on SIGTERM.
	liveCtx, cancelLive := context.WithCancel(context.Background())
	defer cancelLive()
	// PublicAddress is optional. Cloud-mode engines sit behind NAT and leave it
	// empty; the backend then rejects push deploys for this agent but still
	// tracks liveness through heartbeats and accepts bundle deploys.
	if backendClient != nil {
		reg := engine.AgentRegistration{
			Address:      cfg.PublicAddress,
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
			engine.RegisterWithRetry(liveCtx, backendClient, reg, registerCfg)
			if liveCtx.Err() != nil {
				return
			}
			engine.HeartbeatLoop(liveCtx, backendClient, cfg.PublicAddress, heartbeatCfg)
		}()
	} else {
		logging.Logger.Info().Msg("FH_BACKEND_URL or ENGINE_SECRET not set, skipping self-registration")
	}

	// Graceful shutdown: cancel the boot+heartbeat goroutine, then tear down
	// engine + drivers + HTTP server. The backend marks the agent offline once
	// last_seen_at crosses the online threshold; no explicit deactivate call
	// is needed.
	go func() {
		sigCh := make(chan os.Signal, 1)
		signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
		<-sigCh
		logging.Logger.Info().Msg("shutting down")
		cancelLive()
		eng.Stop()
		if err := drivers.CloseAll(); err != nil {
			logging.Logger.Warn().Err(err).Msg("closing driver registry")
		}
		server.Close()
	}()

	logging.Logger.Info().Str("addr", cfg.ListenAddr).Str("config-file", workflowFile).Msg("engine server starting")
	if err := server.ListenAndServe(); err != http.ErrServerClosed {
		logging.Logger.Fatal().Err(err).Msg("server error")
	}
}

// loadManifest reads a JSON DriverManifest from the given path. An empty path
// returns an empty manifest; the workflow must then not declare any channels
// (every channel needs a driverId that resolves into this manifest). A missing
// file at an explicit path is a fatal misconfiguration.
func loadManifest(path string) (engine.DeviceManifest, error) {
	if path == "" {
		return engine.DeviceManifest{}, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return engine.DeviceManifest{}, err
	}
	var m engine.DeviceManifest
	if err := json.Unmarshal(data, &m); err != nil {
		return engine.DeviceManifest{}, err
	}
	return m, nil
}

// loadExternalResources reads the deploy's external-resource configs (wire
// shape) from path and maps them to the engine domain. An empty path is the
// only "optional" signal — the engine boots without transports and waits for
// the next /deploy push to supply them. A non-empty path pointing at a missing
// or malformed file is a fatal misconfiguration; matches loadManifest's
// strictness.
func loadExternalResources(path string) (*engine.ExternalResources, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var ext engineapi.ExternalResources
	if err := json.Unmarshal(data, &ext); err != nil {
		return nil, err
	}
	return mapping.ExternalResourcesToDomain(&ext), nil
}

// loadDeploymentMapping reads the deploy mapping that binds a file-mounted
// workflow's logical resource ids to this environment. An empty path yields a
// nil mapping — fine for workflows with no channels; channel-bearing workflows
// will then hard-fail at build with a clear "no binding" error. A non-empty
// path pointing at a missing or malformed file is fatal.
func loadDeploymentMapping(path string) (engine.DeploymentMapping, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var dm engine.DeploymentMapping
	if err := json.Unmarshal(data, &dm); err != nil {
		return nil, err
	}
	return dm, nil
}
