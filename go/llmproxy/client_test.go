// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package llmproxy

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/assert"
	mock "github.com/stretchr/testify/mock"
)

// newTestProvider returns a MockProvider with default behavior for its ID.
func newTestProvider(t *testing.T, id ProviderID) *MockProvider {
	p := NewMockProvider(t)
	p.EXPECT().ProviderID().Return(id)
	return p
}

func TestClient_Health(t *testing.T) {
	t.Run("all healthy", func(t *testing.T) {
		p1 := newTestProvider(t, "providerA")
		p2 := newTestProvider(t, "providerB")
		p1.EXPECT().AvailableModels().Return([]ModelInfo{})
		p2.EXPECT().AvailableModels().Return([]ModelInfo{})
		p1.EXPECT().Health(mock.Anything).Return(nil)
		p2.EXPECT().Health(mock.Anything).Return(nil)
		c := NewClient([]Provider{p1, p2})
		err := c.Health(context.Background())
		assert.NoError(t, err)
	})

	t.Run("one unhealthy", func(t *testing.T) {
		p1 := newTestProvider(t, "providerA")
		p2 := newTestProvider(t, "providerB")
		p1.EXPECT().AvailableModels().Return([]ModelInfo{})
		p2.EXPECT().AvailableModels().Return([]ModelInfo{})
		p1.EXPECT().Health(mock.Anything).Return(nil).Maybe() // Random map order may call p2 first
		p2.EXPECT().Health(mock.Anything).Return(fmt.Errorf("unhealthy"))
		c := NewClient([]Provider{p1, p2})
		err := c.Health(context.Background())
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "providerB")
	})
}

func TestClient_AvailableModels(t *testing.T) {
	modelsA := []ModelInfo{{ID: "modelA1"}, {ID: "modelA2"}}
	modelsB := []ModelInfo{{ID: "modelB1"}}

	t.Run("success", func(t *testing.T) {
		p1 := newTestProvider(t, "providerA")
		p2 := newTestProvider(t, "providerB")
		p1.EXPECT().AvailableModels().Return(modelsA)
		p2.EXPECT().AvailableModels().Return(modelsB)
		c := NewClient([]Provider{p1, p2})
		result := c.AvailableModels()
		assert.Len(t, result, 3)
		ids := []string{string(result[0].ID), string(result[1].ID), string(result[2].ID)}
		assert.Contains(t, ids, "modelA1")
		assert.Contains(t, ids, "modelA2")
		assert.Contains(t, ids, "modelB1")
	})
}
