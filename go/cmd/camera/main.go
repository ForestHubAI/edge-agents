// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/ForestHubAI/edge-agents/go/camera"
	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/ForestHubAI/edge-agents/go/component/boot"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

func main() {
	cfg, err := LoadConfig()
	if err != nil {
		// Before logging.Configure, the stdout logger is at info level, so error passes through
		boot.Fail(err, "loading configuration") // malformed env config is permanent
	}
	logging.Configure(cfg.Log)

	cams, err := readCameraConfig(component.ConfigFile)
	if err != nil {
		// A missing or unparseable config file fails identically on restart.
		boot.Fail(err, "loading cameras from "+component.ConfigFile)
	}
	// A config with no cameras builds a component that can serve nothing — every
	// /capture 404s. Fail at boot (like the engine on an empty workflow) so the
	// deployment is marked failed here, not mysteriously at the engine's first capture.
	if len(cams.Cameras) == 0 {
		boot.Fail(errors.New("no cameras configured"), "validating "+component.ConfigFile)
	}
	sources, err := camera.BuildSources(cams)
	if err != nil {
		// Invalid camera config (unknown source, missing device) is permanent.
		boot.Fail(err, "loading cameras from "+component.ConfigFile)
	}

	// Real capture shells out to gst-launch-1.0; fail at boot, not on first request.
	// A missing binary is an image-level defect, so a restart fails identically.
	if sources.RequiresGStreamer() {
		if _, err := exec.LookPath("gst-launch-1.0"); err != nil {
			boot.Fail(err, "gst-launch-1.0 not found in PATH")
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Configure statically set-up capture pipelines before serving. A failure is
	// fatal so the restart policy retries until the devices are ready.
	if err := camera.RunSetup(ctx, cams); err != nil {
		// Transient: the devices may not be ready yet, so exit nonzero and let the
		// restart policy retry (not a permanent config error).
		boot.Retry(err, "camera setup failed — check the setup commands in cameras.json (see the bundle README)")
	}

	handler := cameraapi.HandlerFromMux(camera.NewServer(sources), http.NewServeMux())
	srv := &http.Server{
		Addr:    cfg.Addr,
		Handler: handler,
		// Guard against slow/stuck clients holding connections open. No
		// WriteTimeout: a capture can take up to CaptureTimeout plus the response
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

	// Give an in-flight capture (up to CaptureTimeout) room to finish cleanly.
	shutdownCtx, cancel := context.WithTimeout(context.Background(), camera.CaptureTimeout+5*time.Second)
	defer cancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		logging.Logger.Error().Err(err).Msg("graceful shutdown failed")
	}
}

// readCameraConfig reads and parses cameras.json into the contract seam type.
// A missing or malformed file is a permanent boot error.
func readCameraConfig(path string) (cameraapi.CameraConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return cameraapi.CameraConfig{}, err
	}
	var cfg cameraapi.CameraConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		return cameraapi.CameraConfig{}, err
	}
	return cfg, nil
}
