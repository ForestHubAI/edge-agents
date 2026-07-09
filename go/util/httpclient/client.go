// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package httpclient provides a reusable HTTP client for JSON-based APIs.
package httpclient

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"sync"
	"time"
)

const (
	// OctetStream represents the MIME type for binary data.
	OctetStream = "application/octet-stream"

	// ApplicationJSON represents the MIME type for JSON data.
	ApplicationJSON = "application/json"
)

// Client defines a reusable abstraction for JSON-based APIs.
type Client struct {
	baseURL     *url.URL
	httpClient  *http.Client
	headerName  string // static auth header name; empty disables it
	headerValue string // value sent with every request when headerName is set
	bufferPool  *sync.Pool
}

// NewClient initializes a reusable HTTP client. When headerName is non-empty,
// every outgoing request carries authentication in the form of headerName: headerValue.
func NewClient(baseURL, headerName, headerValue string) *Client {
	parsedURL, err := url.Parse(baseURL)
	if err != nil {
		panic(fmt.Sprintf("invalid base URL: %v", err))
	}

	return &Client{
		baseURL:     parsedURL,
		httpClient:  &http.Client{Timeout: 120 * time.Second},
		headerName:  headerName,
		headerValue: headerValue,
		bufferPool: &sync.Pool{
			New: func() any { return new(bytes.Buffer) },
		},
	}
}

// APIError represents a standard error response from the API.
type APIError struct {
	Error struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error"`
}

// Do sends a request and decodes the JSON response into the provided 'out'.
// Pass a pointer as 'out' (e.g. &myStruct). If out is nil, the response body is discarded.
func (c *Client) Do(ctx context.Context, method, path string, queryParams map[string]string, payload any, out any) error {
	// Prepare request body
	var body io.Reader
	var contentType string

	if payload != nil {
		switch t := payload.(type) {
		case io.Reader:
			body = t
			contentType = OctetStream
		case []FormPart:
			buf := c.bufferPool.Get().(*bytes.Buffer)
			buf.Reset()
			defer c.bufferPool.Put(buf)
			writer := multipart.NewWriter(buf)
			for _, p := range t {
				if err := p.WriteTo(writer); err != nil {
					return fmt.Errorf("failed to write form part: %w", err)
				}
			}
			writer.Close()
			body = buf
			contentType = writer.FormDataContentType()
		default:
			buf := c.bufferPool.Get().(*bytes.Buffer)
			buf.Reset()
			defer c.bufferPool.Put(buf)
			if err := json.NewEncoder(buf).Encode(payload); err != nil {
				return fmt.Errorf("failed to encode payload: %w", err)
			}
			body = buf
			contentType = ApplicationJSON
		}
	}

	// Build request
	fullURL := c.baseURL.ResolveReference(&url.URL{Path: path})
	req, err := http.NewRequestWithContext(ctx, method, fullURL.String(), body)
	if err != nil {
		return fmt.Errorf("failed to create request: %w", err)
	}

	// Add query parameters
	if queryParams != nil {
		q := req.URL.Query()
		for k, v := range queryParams {
			q.Add(k, v)
		}
		req.URL.RawQuery = q.Encode()
	}

	// Set headers
	req.Header.Set("Content-Type", contentType)
	req.Header.Set("Accept", ApplicationJSON) // Expect JSON response
	if c.headerName != "" {
		req.Header.Set(c.headerName, c.headerValue)
	}

	// Send request
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return fmt.Errorf("HTTP request failed: %w", err)
	}
	defer resp.Body.Close()

	// Read full response body for error handling and decoding
	res, err := io.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed reading response body: %w", err)
	}

	// Handle non-2xx responses
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiErr APIError
		if err := json.Unmarshal(res, &apiErr); err == nil && apiErr.Error.Message != "" {
			return fmt.Errorf("HTTP %d: API error %s: %s", resp.StatusCode, apiErr.Error.Type, apiErr.Error.Message)
		}
		// fallback: include raw body
		return fmt.Errorf("HTTP %d: API returned an error: %s", resp.StatusCode, string(res))
	}

	// Decode return JSON into out if out is provided
	if out != nil {
		if err := json.Unmarshal(res, out); err != nil {
			return fmt.Errorf("failed to decode JSON response: %w", err)
		}
	}
	return nil
}
