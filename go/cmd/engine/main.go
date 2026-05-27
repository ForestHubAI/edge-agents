package main

import (
	"context"
	"encoding/json"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"syscall"

	"github.com/ForestHubAI/fh-core/go/api/engineapi"
	"github.com/ForestHubAI/fh-core/go/api/workflow"
	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/engine/backend"
	"github.com/ForestHubAI/fh-core/go/engine/build"
	"github.com/ForestHubAI/fh-core/go/engine/driver"
	"github.com/ForestHubAI/fh-core/go/engine/logging"
	"github.com/ForestHubAI/fh-core/go/engine/memory"
	"github.com/ForestHubAI/fh-core/go/engine/websearch"
	"github.com/ForestHubAI/fh-core/go/llmproxy"

	"github.com/go-chi/chi/v5"
)

func main() {
	cfg, err := LoadConfig()
	if err != nil {
		logging.Logger.Fatal().Err(err).Msg("loading configuration")
	}

	// Create backend client
	backendClient := backend.NewClient(cfg.BackendURL, cfg.Secret)

	// Create LLM provider registry and client. Locally-configured providers
	// take precedence; any provider the backend exposes that the engine lacks
	// a key for is registered as a backend-routed stand-in.
	loadCtx, cancelLoad := context.WithTimeout(context.Background(), backend.ProviderLoadTimeout)
	providers := buildLLMProviders(loadCtx, cfg.LLM, backendClient)
	cancelLoad() // Release loadCtx resources
	llmClient := llmproxy.NewClient(providers)

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
		logging.Logger.Fatal().Err(err).Msg("loading driver manifest")
	}
	drivers, err := driver.NewRegistry(&manifest)
	if err != nil {
		logging.Logger.Fatal().Err(err).Msg("initialising driver registry")
	}

	// Memory subsystem: backed by the configured local dir, syncs through
	// the same backend client used for RAG/logs/etc. Restore is invoked on
	// every Build (deploy or initial), so no eager call here.
	memoryManager := memory.NewManager(cfg.MemoryDir, backendClient)

	// Optional web search provider. Built eagerly so a bad provider name fails
	// fatal at boot; absent api key leaves it nil and any WebSearchTool node
	// in a deployed workflow fails the build with a clear message.
	var webSearchProvider websearch.Provider
	if cfg.WebSearch.APIKey != "" {
		p, err := websearch.New(cfg.WebSearch.Provider, cfg.WebSearch.APIKey)
		if err != nil {
			logging.Logger.Fatal().Err(err).Msg("configuring web search provider")
		}
		webSearchProvider = p
		logging.Logger.Info().Str("provider", cfg.WebSearch.Provider).Msg("web search enabled")
	}

	// Create builder and engine
	builder := &build.Builder{
		Drivers:   drivers,
		LLM:       llmClient,
		Memory:    memoryManager,
		WebSearch: webSearchProvider,
		Retriever: backendClient,
	}
	eng := &engine.Engine{
		Secret:  cfg.Secret,
		Builder: builder.Build,
	}

	// Deploy workflow from file if configured
	if workflowFile != "" {
		wfData, err := os.ReadFile(workflowFile)
		if err != nil {
			logging.Logger.Fatal().Err(err).Msg("reading workflow file")
		}
		var wf workflow.Workflow
		if err := json.Unmarshal(wfData, &wf); err != nil {
			logging.Logger.Fatal().Err(err).Msg("parsing workflow file")
		}
		nm, err := loadNetworkManifest(cfg.NetworkManifestFile)
		if err != nil {
			logging.Logger.Fatal().Err(err).Msg("loading network manifest")
		}
		if err := eng.Deploy(&wf, nm); err != nil {
			logging.Logger.Fatal().Err(err).Msg("deploying workflow from file")
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
			Address:  cfg.PublicAddress,
			Status:   engine.StatusOnline,
			Manifest: &manifest,
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
// returns a minimal default suitable for local dev and CI. A missing file at
// an explicit path is a fatal misconfiguration.
func loadManifest(path string) (engine.DeviceManifest, error) {
	if path == "" {
		return engine.DeviceManifest{
			GPIOs: map[string]engine.GPIOConfig{
				"gpiochip0": {Chip: "/dev/gpiochip0"},
			},
		}, nil
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

// loadNetworkManifest reads a pre-resolved network manifest from path. An
// empty path is the only "optional" signal — the engine boots without broker
// connections and waits for the next /deploy push to supply the manifest.
// A non-empty path that points at a missing or malformed file is a fatal
// misconfiguration (the compose file mounted nothing where something was
// expected); matches the strictness of loadManifest above.
func loadNetworkManifest(path string) (*engine.NetworkManifest, error) {
	if path == "" {
		return nil, nil
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var nm engine.NetworkManifest
	if err := json.Unmarshal(data, &nm); err != nil {
		return nil, err
	}
	return &nm, nil
}
