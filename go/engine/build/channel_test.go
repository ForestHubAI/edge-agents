// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBindingFor_ReturnsBinding(t *testing.T) {
	dm := engine.ResourceMapping{"ch-1": {Ref: "res-1", Index: pointer.Ptr(3)}}

	b, err := bindingFor(dm, "ch-1")
	require.NoError(t, err)
	assert.Equal(t, "res-1", b.Ref)
}

func TestBindingFor_NilMappingFails(t *testing.T) {
	_, err := bindingFor(nil, "ch-1")
	require.Error(t, err)
}

func TestBindingFor_MissingKeyFails(t *testing.T) {
	dm := engine.ResourceMapping{"ch-1": {Ref: "res-1"}}

	_, err := bindingFor(dm, "ch-2")
	require.Error(t, err)
}

func TestBindingFor_EmptyRefFails(t *testing.T) {
	dm := engine.ResourceMapping{"ch-1": {Ref: ""}}

	_, err := bindingFor(dm, "ch-1")
	require.Error(t, err)
}

func TestIndexFor_ReturnsIndex(t *testing.T) {
	idx, err := indexFor(engine.ResourceBinding{Ref: "res-1", Index: pointer.Ptr(7)}, "ch-1")
	require.NoError(t, err)
	assert.Equal(t, 7, idx)
}

func TestIndexFor_NilIndexFails(t *testing.T) {
	_, err := indexFor(engine.ResourceBinding{Ref: "res-1"}, "ch-1")
	require.Error(t, err)
}
