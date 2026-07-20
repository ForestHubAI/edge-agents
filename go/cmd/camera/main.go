// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package main

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"os/signal"
	"syscall"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/ForestHubAI/edge-agents/go/camera"
	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

func main() {
	env, err := LoadEnvConfig()
	if err != nil {
		// Before logging.Configure, the stdout logger is at info level, so error passes through
		component.BootFail(err, "loading configuration") // malformed env config is permanent
	}
	logging.Configure(env.Log)

	cfg, err := component.LoadConfig[cameraapi.CameraConfig]()
	if err != nil {
		// A missing or unparseable config file fails identically on restart.
		component.BootFail(err, "loading cameras from "+component.ConfigFile)
	}
	// A config with no cameras builds a component that can serve nothing — every
	// /capture 404s. Fail at boot (like the engine on an empty workflow) so the
	// deployment is marked failed here, not mysteriously at the engine's first capture.
	if len(cfg.Cameras) == 0 {
		component.BootFail(errors.New("no cameras configured"), "validating "+component.ConfigFile)
	}
	// Stream credentials arrive out-of-band in the mounted secret document, keyed
	// by the same manifest key as the camera they belong to — never in the config
	// blob. Absent when no camera authenticates.
	secrets, err := component.ReadSecrets()
	if err != nil {
		component.BootFail(err, "loading secrets from "+component.SecretsFile)
	}
	cams, err := camera.ToDomain(cfg, secrets)
	if err != nil {
		// An unknown kind is permanent: the component cannot learn one at runtime.
		component.BootFail(err, "loading cameras from "+component.ConfigFile)
	}
	sources, err := camera.BuildSources(cams)
	if err != nil {
		// Invalid camera config (missing device, negative warmup) is permanent.
		component.BootFail(err, "loading cameras from "+component.ConfigFile)
	}

	// Real capture shells out to gst-launch-1.0; fail at boot, not on first request.
	// A missing binary is an image-level defect, so a restart fails identically.
	if sources.RequiresGStreamer() {
		if _, err := exec.LookPath("gst-launch-1.0"); err != nil {
			component.BootFail(err, "gst-launch-1.0 not found in PATH")
		}
	}

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	// Configure statically set-up capture pipelines before serving. A failure is
	// fatal so the restart policy retries until the devices are ready.
	if err := camera.RunSetup(ctx, cams); err != nil {
		// Transient: the devices may not be ready yet, so exit nonzero and let the
		// restart policy retry (not a permanent config error).
		component.BootRetry(err, "camera setup failed — check the setup commands in the camera config (see the bundle README)")
	}

	// The engine dials this component at component.CameraPort; that constant is the
	// only thing that decides where we listen.
	addr := fmt.Sprintf(":%d", component.CameraPort)
	handler := cameraapi.HandlerFromMux(camera.NewServer(sources), http.NewServeMux())
	srv := &http.Server{
		Addr:    addr,
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
		logging.Logger.Info().Str("addr", addr).Int("cameras", len(sources)).Msg("fh-camera listening")
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
