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

func TestAddressFor_ReturnsAddress(t *testing.T) {
	dm := engine.ResourceMapping{"ch-1": {Ref: "res-1", Index: pointer.Ptr(3)}}

	b, err := addressFor(dm, "ch-1")
	require.NoError(t, err)
	assert.Equal(t, "res-1", b.Ref)
}

func TestAddressFor_NilMappingFails(t *testing.T) {
	_, err := addressFor(nil, "ch-1")
	require.Error(t, err)
}

func TestAddressFor_MissingKeyFails(t *testing.T) {
	dm := engine.ResourceMapping{"ch-1": {Ref: "res-1"}}

	_, err := addressFor(dm, "ch-2")
	require.Error(t, err)
}

func TestAddressFor_EmptyRefFails(t *testing.T) {
	dm := engine.ResourceMapping{"ch-1": {Ref: ""}}

	_, err := addressFor(dm, "ch-1")
	require.Error(t, err)
}

func TestIndexFor_ReturnsIndex(t *testing.T) {
	idx, err := indexFor(engine.ResourceAddress{Ref: "res-1", Index: pointer.Ptr(7)}, "ch-1")
	require.NoError(t, err)
	assert.Equal(t, 7, idx)
}

func TestIndexFor_NilIndexFails(t *testing.T) {
	_, err := indexFor(engine.ResourceAddress{Ref: "res-1"}, "ch-1")
	require.Error(t, err)
}
