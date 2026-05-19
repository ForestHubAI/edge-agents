package logging

import (
	"bytes"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/rs/zerolog"
)

// httpWriter posts log lines to <backendURL>/agents/logs. Implements
// zerolog.LevelWriter so Fatal events block until the POST completes
// while everything else is fire-and-forget.
type httpWriter struct {
	url      string
	agentKey string
	client   *http.Client
	wg       sync.WaitGroup
}

func newHTTPWriter(backendURL, agentKey string) *httpWriter {
	return &httpWriter{
		url:      strings.TrimRight(backendURL, "/") + "/agents/logs",
		agentKey: agentKey,
		client:   &http.Client{Timeout: 5 * time.Second},
	}
}

// Write sends p in a detached goroutine. Errors are dropped; the only
// contract is best-effort delivery.
func (h *httpWriter) Write(p []byte) (int, error) {
	return h.WriteLevel(zerolog.NoLevel, p)
}

// WriteLevel dispatches per level. Fatal sends synchronously so the
// log line reaches the backend before os.Exit fires inside zerolog's
// Fatal path.
func (h *httpWriter) WriteLevel(level zerolog.Level, p []byte) (int, error) {
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

func (h *httpWriter) send(body []byte) {
	req, err := http.NewRequest(http.MethodPost, h.url, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	if h.agentKey != "" {
		req.Header.Set("Agent-Key", h.agentKey)
	}
	resp, err := h.client.Do(req)
	if err != nil {
		return
	}
	resp.Body.Close()
}

// Close waits for in-flight goroutines, bounded by httpCloseTimeout.
func (h *httpWriter) Close() error {
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
