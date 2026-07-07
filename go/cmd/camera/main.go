package main

import (
	"context"
	"errors"
	"net/http"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/captureapi"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

func main() {
	logging.Configure(logging.Config{})

	cfg, err := LoadConfig()
	if err != nil {
		logging.Logger.Fatal().Err(err).Msg("loading configuration")
	}

	file, err := readConfig(cfg.ConfigFile)
	if err != nil {
		logging.Logger.Fatal().Err(err).Str("config-file", cfg.ConfigFile).Msg("loading cameras")
	}
	sources, err := buildSources(file)
	if err != nil {
		logging.Logger.Fatal().Err(err).Str("config-file", cfg.ConfigFile).Msg("loading cameras")
	}

	// Real capture shells out to gst-launch-1.0; fail at boot, not on first request.
	if hasNonDebugSource(sources) {
		if _, err := exec.LookPath("gst-launch-1.0"); err != nil {
			logging.Logger.Fatal().Err(err).Msg("gst-launch-1.0 not found in PATH")
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Configure statically set-up capture pipelines before serving. A failure is
	// fatal so the restart policy retries until the devices are ready.
	if err := runSetup(ctx, file); err != nil {
		logging.Logger.Fatal().Err(err).Msg("camera setup failed — check the setup commands in cameras.json (see the bundle README)")
	}

	handler := captureapi.HandlerFromMux(newServer(sources), http.NewServeMux())
	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: handler,
		// Guard against slow/stuck clients holding connections open. No
		// WriteTimeout: a capture can take up to captureTimeout plus the response
		// write, and a blanket write deadline would cut long captures off.
		ReadHeaderTimeout: 5 * time.Second,
		ReadTimeout:       10 * time.Second,
		IdleTimeout:       60 * time.Second,
		MaxHeaderBytes:    1 << 16,
	}

	go func() {
		logging.Logger.Info().Str("addr", cfg.Addr).Int("cameras", len(sources)).Msg("fh-camera listening")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logging.Logger.Fatal().Err(err).Msg("server error")
		}
	}()

	<-ctx.Done()
	logging.Logger.Info().Msg("shutting down")

	// Give an in-flight capture (up to captureTimeout) room to finish cleanly.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), captureTimeout+5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logging.Logger.Error().Err(err).Msg("graceful shutdown failed")
	}
}
