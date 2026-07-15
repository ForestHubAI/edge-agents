// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package build

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/stretchr/testify/require"
	"gopkg.in/yaml.v3"
)

// contractPath is the source-of-truth schema, relative to this package dir.
const contractPath = "../../../contract/workflow.yaml"

// nodeTypesFromContract reads the Node discriminator mapping out of the contract
// YAML and returns every declared node `type` string. The list is derived from
// the contract — NOT a hand-maintained slice — so a node added to the schema is
// picked up here automatically, which is the whole point.
func nodeTypesFromContract(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(contractPath)
	require.NoError(t, err, "reading contract at %s", contractPath)

	var doc struct {
		Components struct {
			Schemas struct {
				Node struct {
					Discriminator struct {
						Mapping map[string]string `yaml:"mapping"`
					} `yaml:"discriminator"`
				} `yaml:"Node"`
			} `yaml:"schemas"`
		} `yaml:"components"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &doc), "parsing contract YAML")

	mapping := doc.Components.Schemas.Node.Discriminator.Mapping
	require.NotEmpty(t, mapping, "no components.schemas.Node.discriminator.mapping in contract")

	types := make([]string, 0, len(mapping))
	for typ := range mapping {
		types = append(types, typ)
	}
	return types
}

// TestBuildSwitchHandlesEveryContractNode is the exhaustiveness backstop the Go
// compiler cannot provide: it asserts the hand-written type switch in
// (*graph).build() has a case arm for EVERY node type the contract declares.
//
// Go type switches are not checked for exhaustiveness, so a node added to the
// contract (and regenerated into the api package) but forgotten in graph.go
// compiles clean and fails only at boot via the "unsupported node type"
// default. This test moves that failure left to `go test`.
//
// Mechanism: for each node type, feed a bare {"type": T} node through build()
// and assert it does NOT fall through to the default arm. A bare node usually
// trips a MissingFieldError or a missing-dependency/channel error first — that is
// fine: reaching ANY arm proves the case exists. Only the default-arm sentinel
// (or a stale-mappings discriminator failure) is a real failure.
func TestBuildSwitchHandlesEveryContractNode(t *testing.T) {
	for _, typ := range nodeTypesFromContract(t) {
		t.Run(typ, func(t *testing.T) {
			ms, err := engine.NewMainScope(nil)
			require.NoError(t, err)

			// Minimal build context. The only deps an arm can reach before its
			// own validation are channels (nil-map lookups return a clean
			// "no X channel" error) and functions (empty map → "not declared").
			bc := &buildContext{
				ctx:       context.Background(),
				channels:  &channels{},
				functions: map[string]*engine.Function{},
				mainScope: ms,
			}

			var n workflowapi.Node
			require.NoError(t,
				json.Unmarshal(fmt.Appendf(nil, `{"id":"n1","type":%q,"arguments":{}}`, typ), &n),
				"constructing a %q node", typ)

			buildErr := safeBuild(bc, n)
			if buildErr == nil {
				return // handled (e.g. OnStartup wires cleanly with no edges)
			}
			msg := buildErr.Error()
			require.NotContains(t, msg, "unsupported node type",
				"node type %q is declared in the contract but has no case arm in (*graph).build() — add one (see /sync-go-engine)", typ)
			require.NotContains(t, msg, "reading node discriminator",
				"node type %q fails discriminator resolution — the generated api mappings are stale, run `go generate ./...`", typ)
		})
	}
}

// channelTypesFromContract reads the Channel discriminator mapping out of the
// contract YAML and returns every declared channel `type` string. Like its node
// sibling, the list is derived from the contract, so a channel added to the
// schema is picked up here automatically.
func channelTypesFromContract(t *testing.T) []string {
	t.Helper()
	raw, err := os.ReadFile(contractPath)
	require.NoError(t, err, "reading contract at %s", contractPath)

	var doc struct {
		Components struct {
			Schemas struct {
				Channel struct {
					Discriminator struct {
						Mapping map[string]string `yaml:"mapping"`
					} `yaml:"discriminator"`
				} `yaml:"Channel"`
			} `yaml:"schemas"`
		} `yaml:"components"`
	}
	require.NoError(t, yaml.Unmarshal(raw, &doc), "parsing contract YAML")

	mapping := doc.Components.Schemas.Channel.Discriminator.Mapping
	require.NotEmpty(t, mapping, "no components.schemas.Channel.discriminator.mapping in contract")

	types := make([]string, 0, len(mapping))
	for typ := range mapping {
		types = append(types, typ)
	}
	return types
}

// TestBuildChannelsHandlesEveryContractChannel is the channel counterpart to
// TestBuildSwitchHandlesEveryContractNode: it asserts the hand-written type
// switch in buildChannels has a case arm for EVERY channel type the contract
// declares. A channel added to the contract but forgotten in buildChannels
// compiles clean and fails only at deploy time via the "unsupported type"
// default — this moves that failure left to `go test`.
//
// Mechanism: feed a bare {"type": T} channel through buildChannels with empty
// deps. Most types trip a missing-mapping error first — that is fine: reaching
// ANY arm proves the case exists. Only the default-arm sentinel is a real
// failure.
func TestBuildChannelsHandlesEveryContractChannel(t *testing.T) {
	for _, typ := range channelTypesFromContract(t) {
		t.Run(typ, func(t *testing.T) {
			var c workflowapi.Channel
			require.NoError(t,
				json.Unmarshal(fmt.Appendf(nil, `{"id":"c1","type":%q,"label":"c1"}`, typ), &c),
				"constructing a %q channel", typ)

			_, err := buildChannels([]workflowapi.Channel{c}, nil, nil, nil, nil)
			if err == nil {
				return // handled cleanly (a camera, for instance, is a no-op here)
			}
			require.NotContains(t, err.Error(), "unsupported type",
				"channel type %q is declared in the contract but has no case arm in buildChannels — add one", typ)
		})
	}
}

// safeBuild runs build() for a single node, converting a panic from a node
// constructor (fed deliberately-empty arguments) into a nil error: a panic still
// proves the type switch reached that arm, which is all this test checks. The
// default arm returns an error rather than panicking, so a genuine missing case
// can never be masked by this recover.
func safeBuild(bc *buildContext, n workflowapi.Node) (err error) {
	defer func() {
		if r := recover(); r != nil {
			err = nil
		}
	}()
	_, err = newGraph(bc).build([]workflowapi.Node{n}, nil)
	return err
}
