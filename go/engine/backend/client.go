// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package backend is the engine-side HTTP client for everything the engine
// needs from fh-backend: LLM chat and RAG queries. All requests authenticate
// with the engine's device secret via the Device-Key header (validated by the
// backend's DeviceKeyAuth middleware). Status and liveness are NOT here —
// Ranger observes the engine container and reports them.
package backend

import (
	"time"

	"github.com/ForestHubAI/edge-agents/go/util/httpclient"
)

const (
	// ProviderLoadTimeout caps the one-shot /llm/providers fetch used to
	// discover backend-routed LLM fallbacks at engine startup.
	ProviderLoadTimeout = 10 * time.Second
)

// Client is the engine-side HTTP client for backend interactions.
// All requests carry the Device-Key authorization header.
type Client struct {
	BackendURL string
	Secret     string
	http       *httpclient.Client
}

// NewClient constructs a Client backed by the shared httpclient.
func NewClient(backendURL, secret string) *Client {
	return &Client{
		BackendURL: backendURL,
		Secret:     secret,
		http:       httpclient.NewClient(backendURL, "Device-Key", secret),
	}
}
