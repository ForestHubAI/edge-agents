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

// mlBinding pairs the shared component client (one per MLProvider, held in the
// registry) with the model name this workflow model resolves to on that
// component. The node holds both and sends the name per request.
type mlBinding struct {
	client engine.MLClient
	model  string
}

// buildDeployML resolves a workflow's declared ML models into per-model bindings.
// wf.Models also holds LLM models (resolved separately in selfHostedEndpoints);
// those are skipped here by discriminator. An unbound model, an unregistered ref
// (no MLProvider in the deploy externalResources), or a missing model sub-address
// is a deploy error. Many models may resolve to the same client — expected, since
// one component serves a repository of models, selected per request.
func buildDeployML(wf *workflowapi.Workflow, rm engine.ResourceMapping, resources *resource.Registry) (map[string]mlBinding, error) {
	bindings := make(map[string]mlBinding)
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
		// One client per component, looked up by the binding's ref; a ref with no
		// MLProvider in externalResources is unregistered here.
		client, err := resources.ML(b.Ref)
		if err != nil {
			return nil, fmt.Errorf("model %q: %w", m.Id, err)
		}
		// The component selects on the address's model sub-address, which the
		// mapping must supply (one component fronts a repository of models).
		if b.Model == nil || *b.Model == "" {
			return nil, fmt.Errorf("model %q: mapped to %q but the address carries no model name for the component to select on", m.Id, b.Ref)
		}
		bindings[m.Id] = mlBinding{client: client, model: *b.Model}
	}
	return bindings, nil
}
