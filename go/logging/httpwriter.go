// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package logging

import (
	"bytes"
	"net/http"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

const httpCloseTimeout = 3 * time.Second

// HTTPWriter posts log lines to a configured URL. Implements
// zerolog.LevelWriter so Fatal events block until the POST completes
// while everything else is fire-and-forget.
type HTTPWriter struct {
	url        string
	headerName string
	headerVal  string
	client     *http.Client
	wg         sync.WaitGroup
}

// NewHTTPWriter constructs a writer that POSTs each log line to url.
// An empty headerName disables the auth header; otherwise headerValue
// is sent as headerName on every request.
func NewHTTPWriter(url, headerName, headerValue string) *HTTPWriter {
	return &HTTPWriter{
		url:        url,
		headerName: headerName,
		headerVal:  headerValue,
		client:     &http.Client{Timeout: 5 * time.Second},
	}
}

// Write sends p in a detached goroutine. Errors are dropped; the only
// contract is best-effort delivery.
func (h *HTTPWriter) Write(p []byte) (int, error) {
	return h.WriteLevel(zerolog.NoLevel, p)
}

// WriteLevel dispatches per level. Fatal sends synchronously so the
// log line lands before os.Exit fires inside zerolog's Fatal path.
func (h *HTTPWriter) WriteLevel(level zerolog.Level, p []byte) (int, error) {
	body := append([]byte(nil), bytes.TrimSpace(p)...)
	if level == zerolog.FatalLevel {
		h.send(body)
		return len(p), nil
	}
	h.wg.Add(1)
	go func() {
		defer h.wg.Done()
		h.send(body)
	}()
	return len(p), nil
}

func (h *HTTPWriter) send(body []byte) {
	req, err := http.NewRequest(http.MethodPost, h.url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if h.headerName != "" {
		req.Header.Set(h.headerName, h.headerVal)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

// Close waits for in-flight goroutines, bounded by httpCloseTimeout.
func (h *HTTPWriter) Close() error {
	done := make(chan struct{})
	go func() {
		h.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(httpCloseTimeout):
	}
	return nil
}
