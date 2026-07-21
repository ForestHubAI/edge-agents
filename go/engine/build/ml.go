// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/resource"
)

// buildDeployML resolves a workflow's declared ML models into per-model inference
// clients. wf.Models also holds LLM models (resolved separately in
// selfHostedEndpoints); those are skipped here by discriminator. An unbound or
// unconfigured ML model is a deploy error. Many models may resolve to the same
// component url — expected, since one component serves a repository of models and
// the model name is sent per request.
func buildDeployML(wf *workflowapi.Workflow, rm engine.ResourceMapping, ext *engine.ExternalResources) (map[string]engine.MLClient, error) {
	endpoints := make(map[string]engine.MLClient)
	for _, mu := range wf.Models {
		disc, err := mu.Discriminator()
		if err != nil {
			return nil, fmt.Errorf("declared model: %w", err)
		}
		if disc != string(workflowapi.MLModelTypeMLModel) {
			continue
		}
		m, err := mu.AsMLModel()
		if err != nil {
			return nil, fmt.Errorf("declared model: %w", err)
		}
		b, ok := rm[m.Id]
		if !ok || b.Ref == "" {
			return nil, fmt.Errorf("model %q: declared but not bound by the deployment mapping", m.Id)
		}
		var cfg engine.MLConfig
		if ext != nil {
			cfg, ok = ext.ML[b.Ref]
		}
		if !ok {
			return nil, fmt.Errorf("model %q: bound to %q but no ml inference config in deploy externalResources", m.Id, b.Ref)
		}
		// The component selects on the address's model sub-address, which the
		// mapping must supply (one component fronts a repository of models).
		if b.Model == nil || *b.Model == "" {
			return nil, fmt.Errorf("model %q: mapped to %q but the address carries no model name for the component to select on", m.Id, b.Ref)
		}
		ep, err := resource.OpenML(cfg.URL, *b.Model)
		if err != nil {
			return nil, fmt.Errorf("model %q: %w", m.Id, err)
		}
		endpoints[m.Id] = ep
	}
	return endpoints, nil
}
