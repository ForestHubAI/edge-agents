// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"fmt"
	"path/filepath"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/rag"
	"github.com/ForestHubAI/edge-agents/go/llmproxy"
	"github.com/ForestHubAI/edge-agents/go/llmproxy/provider/selfhosted"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

// storeFile is the artifact each store directory holds.
const storeFile = "index.db"

// retrieverLookup answers which retriever serves one bound vector database.
// Nil means neither a local artifact nor a fallback is available.
type retrieverLookup func(ref string) engine.Retriever

// buildRetriever resolves each declared vector database to the retriever that
// answers it: a local artifact when its binding names a vector store resource,
// otherwise the fallback. Iteration follows the declarations rather than the
// configured resources, so errors name the vector database and an unreferenced
// broken resource cannot kill the boot. Refs are deduplicated — several vector
// databases may share one store.
//
// The artifact is opened and its envelope validated here: a missing or foreign
// store must fail the boot, not the first query. Reachability of the embedding
// endpoint is not checked, being a runtime concern.
func buildRetriever(collections map[string]string, ext *engine.ExternalResources, ragDir string, fallback engine.Retriever) (retrieverLookup, error) {
	local := make(map[string]engine.Retriever)
	for vdbID, ref := range collections {
		if _, built := local[ref]; built {
			continue
		}
		var (
			cfg engine.VectorStoreConfig
			ok  bool
		)
		if ext != nil {
			cfg, ok = ext.VectorStores[ref]
		}
		if !ok {
			logging.Logger.Info().Str("memory", vdbID).Str("ref", ref).Msg("rag: routed to retrieval service")
			continue
		}

		retriever, err := openLocalRetriever(cfg, ragDir)
		if err != nil {
			return nil, fmt.Errorf("vector database %q: %w", vdbID, err)
		}
		local[ref] = retriever
		logging.Logger.Info().Str("memory", vdbID).Str("ref", ref).Str("store", cfg.Store).
			Msg("rag: routed to local store")
	}

	return func(ref string) engine.Retriever {
		if r, ok := local[ref]; ok {
			return r
		}
		if fallback != nil {
			return fallback
		}
		return nil
	}, nil
}

// openLocalRetriever opens the artifact cfg names and pairs it with the
// embedding endpoint that serves the model recorded in its envelope. Taking the
// model id from the artifact leaves no second place for it to disagree.
func openLocalRetriever(cfg engine.VectorStoreConfig, ragDir string) (*rag.LocalRetriever, error) {
	if err := validateStoreName(cfg.Store); err != nil {
		return nil, err
	}
	store, err := rag.OpenStore(filepath.Join(ragDir, cfg.Store, storeFile))
	if err != nil {
		return nil, fmt.Errorf("store %q: %w", cfg.Store, err)
	}

	env := store.Envelope()
	dimension := env.Dimension
	provider := selfhosted.NewProvider(selfhosted.Config{Endpoints: []selfhosted.ModelEndpoint{{
		URL:          cfg.URL,
		APIKey:       cfg.APIKey,
		ID:           llmproxy.ModelID(env.EmbeddingModel),
		Capabilities: []llmproxy.ModelCapability{llmproxy.CapabilityEmbedding},
		Dimension:    &dimension,
	}}})
	return rag.NewLocalRetriever(store, llmproxy.NewClient([]llmproxy.Provider{provider})), nil
}

// validateStoreName rejects anything but a plain directory name. The value comes
// from the deployment and becomes a path, and filepath.Join would happily clean
// a traversal into a valid path outside the mount.
func validateStoreName(name string) error {
	switch {
	case name == "":
		return fmt.Errorf("store name is empty")
	case strings.ContainsAny(name, `/\`), strings.Contains(name, ".."):
		return fmt.Errorf("store name %q must be a plain directory name", name)
	}
	return nil
}
