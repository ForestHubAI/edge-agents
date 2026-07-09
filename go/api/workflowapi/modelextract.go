// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package workflowapi

// ReferencedModelIDs collects the chat-model ids referenced by Agent nodes across
// the main graph and every function body — the models a runtime must be able to
// serve. Only Agent nodes reference chat models today; a node with a missing model
// id is skipped (the graph build reports that as a MissingField).
func ReferencedModelIDs(wf *Workflow) ([]string, error) {
	seen := make(map[string]struct{})
	var out []string
	scan := func(nodes []Node) error {
		for _, n := range nodes {
			v, err := n.ValueByDiscriminator()
			if err != nil {
				return err
			}
			a, ok := v.(AgentNode)
			if !ok || a.Arguments.Model == nil || *a.Arguments.Model == "" {
				continue
			}
			id := *a.Arguments.Model
			if _, dup := seen[id]; dup {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
		return nil
	}
	if err := scan(wf.Nodes); err != nil {
		return nil, err
	}
	for _, f := range wf.Functions {
		if err := scan(f.Nodes); err != nil {
			return nil, err
		}
	}
	return out, nil
}
