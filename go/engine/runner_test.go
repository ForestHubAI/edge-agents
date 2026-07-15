// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import (
	"context"
	"testing"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// A graph cycle never returns to StateIdle, so the idle select is unreachable;
// these tests pin that cancellation still stops the loops (the per-iteration
// ctx check on the execution path).

func TestRunner_CancelStopsNodeCycle(t *testing.T) {
	r := &Runner{
		Nodes: map[string]Executable{
			"a": &fakeAction{id: "a", next: "b"},
			"b": &fakeAction{id: "b", next: "a"},
		},
		Triggers:        map[string]Trigger{},
		EntryTransition: Transition{TargetID: "a"},
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()

	time.Sleep(10 * time.Millisecond) // let the cycle spin
	cancel()

	select {
	case err := <-done:
		assert.ErrorIs(t, err, context.Canceled)
	case <-time.After(2 * time.Second):
		t.Fatal("runner did not stop after cancel — node cycle ignores ctx")
	}
}

// An OnStartup edge feeding an agent must seed the conversation
// before the entry node runs.
func TestRunner_EntryTransitionAppliesBeforeEntryNode(t *testing.T) {
	s, err := NewMainScope(nil)
	require.NoError(t, err)

	var seen llmproxy.InputItems
	entry := &fakeAction{
		id:   "agent",
		next: StateIdle,
		run: func(sc *Scope) error {
			seen = sc.GetConversation()
			return nil
		},
	}
	r := &Runner{
		Scope:    s,
		Nodes:    map[string]Executable{"agent": entry},
		Triggers: map[string]Trigger{},
		EntryTransition: Transition{
			TargetID: "agent",
			EdgeType: workflowapi.AgentTask,
			Prompt:   pointer.Ptr(literalString("do the thing")),
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- r.Run(ctx) }()

	// Give the entry node time to run, then stop the idle loop.
	time.Sleep(20 * time.Millisecond)
	cancel()
	<-done

	require.Len(t, seen, 1, "entry node ran without a seeded conversation")
	assert.Equal(t, "do the thing", seen[0].String())
}

func TestFunction_CallCancelStopsCycle(t *testing.T) {
	fn := &Function{
		Info:            workflowapi.FunctionInfo{Name: "loop", Id: "fn1"},
		EntryTransition: Transition{TargetID: "a"},
		Executables: map[string]Executable{
			"a": &fakeAction{id: "a", next: "b"},
			"b": &fakeAction{id: "b", next: "a"},
		},
	}

	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan error, 1)
	go func() {
		_, err := fn.Call(ctx, nil)
		done <- err
	}()

	time.Sleep(10 * time.Millisecond)
	cancel()

	select {
	case err := <-done:
		require.Error(t, err)
		assert.ErrorIs(t, err, context.Canceled)
	case <-time.After(2 * time.Second):
		t.Fatal("function call did not stop after cancel — body cycle ignores ctx")
	}
}
