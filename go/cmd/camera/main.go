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

	sources, err := loadCameras(cfg.ConfigFile)
	if err != nil {
		logging.Logger.Fatal().Err(err).Str("config-file", cfg.ConfigFile).Msg("loading cameras")
	}

	// Real capture shells out to gst-launch-1.0; fail at boot, not on first request.
	if hasNonDebugSource(sources) {
		if _, err := exec.LookPath("gst-launch-1.0"); err != nil {
			logging.Logger.Fatal().Err(err).Msg("gst-launch-1.0 not found in PATH")
		}
	}

	handler := captureapi.HandlerFromMux(newServer(sources), http.NewServeMux())
	srv := &http.Server{Addr: cfg.Addr, Handler: handler}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	go func() {
		logging.Logger.Info().Str("addr", cfg.Addr).Int("cameras", len(sources)).Msg("fh-camera listening")
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			logging.Logger.Fatal().Err(err).Msg("server error")
		}
	}()

	<-ctx.Done()
	logging.Logger.Info().Msg("shutting down")

	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logging.Logger.Error().Err(err).Msg("graceful shutdown failed")
	}
}
