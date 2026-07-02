package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/captureapi"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

// server implements the generated captureapi.ServerInterface over the configured
// capture sources.
type server struct {
	sources map[string]source
}

func newServer(sources map[string]source) *server {
	return &server{sources: sources}
}

// Capture reads one frame from the named device and returns its JPEG bytes.
func (s *server) Capture(w http.ResponseWriter, r *http.Request, params captureapi.CaptureParams) {
	src, ok := s.sources[params.Name]
	if !ok {
		writeError(w, http.StatusNotFound, fmt.Sprintf("unknown device %q", params.Name))
		return
	}

	width, height := 0, 0
	if params.Width != nil {
		width = *params.Width
	}
	if params.Height != nil {
		height = *params.Height
	}

	start := time.Now()
	data, err := src.capture(r.Context(), width, height)
	if err != nil {
		logging.Logger.Error().Str("name", params.Name).Err(err).Msg("capture failed")
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	logging.Logger.Info().
		Str("name", params.Name).
		Int("bytes", len(data)).
		Dur("duration", time.Since(start)).
		Msg("captured frame")

	w.Header().Set("Content-Type", "image/jpeg")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(data)
}

// Healthz is liveness — always ok while the process runs.
func (s *server) Healthz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, captureapi.Health{Status: "ok"})
}

// Readyz is readiness — the config is loaded eagerly before the server starts,
// so once serving it is always ready.
func (s *server) Readyz(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, captureapi.Health{Status: "ok"})
}

// Metadata lists the configured device names.
func (s *server) Metadata(w http.ResponseWriter, r *http.Request) {
	names := make([]string, 0, len(s.sources))
	for name := range s.sources {
		names = append(names, name)
	}
	sort.Strings(names)

	devices := make([]captureapi.DeviceMetadata, 0, len(names))
	for _, name := range names {
		devices = append(devices, captureapi.DeviceMetadata{Name: name})
	}
	writeJSON(w, http.StatusOK, captureapi.CaptureMetadata{Devices: devices})
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, captureapi.Error{Message: msg})
}
