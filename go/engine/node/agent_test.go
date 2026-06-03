package node

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/util/pointer"

	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/engine/expr"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// newAgentNode builds an Agent node with a no-provider llmproxy client.
// The returned agent never invokes the runner during the tests below — only
// pure helpers (Setup / Outputs / applyStructuredOutputs / next) are exercised.
func newAgentNode(
	id string,
	answer workflow.OutputBinding,
	decls []workflow.OutputDeclaration,
) *Agent {
	client := llmproxy.NewClient(nil)
	return NewAgent(
		id,
		"agent-"+id,
		"test-model",
		nil, // instructions
		answer,
		decls,
		nil, // memoryRefs
		nil, // maxTurns
		"",  // toolDescription
		client,
		nil, // memory manager
	)
}

func TestChoiceToken(t *testing.T) {
	assert.Equal(t, "choice_0", choiceToken(0))
	assert.Equal(t, "choice_1", choiceToken(1))
	assert.Equal(t, "choice_42", choiceToken(42))
}

func TestParseChoiceToken(t *testing.T) {
	t.Run("valid token within range", func(t *testing.T) {
		idx, err := parseChoiceToken("choice_2", 5)
		require.NoError(t, err)
		assert.Equal(t, 2, idx)
	})

	t.Run("missing prefix", func(t *testing.T) {
		_, err := parseChoiceToken("foo_2", 5)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "invalid choice token")
	})

	t.Run("non-numeric suffix", func(t *testing.T) {
		_, err := parseChoiceToken("choice_abc", 5)
		require.Error(t, err)
	})

	t.Run("negative index rejected", func(t *testing.T) {
		_, err := parseChoiceToken("choice_-1", 5)
		require.Error(t, err)
	})

	t.Run("out-of-range index rejected", func(t *testing.T) {
		_, err := parseChoiceToken("choice_5", 5) // 5 not < 5
		require.Error(t, err)
	})

	t.Run("zero is valid when branches exist", func(t *testing.T) {
		idx, err := parseChoiceToken("choice_0", 1)
		require.NoError(t, err)
		assert.Equal(t, 0, idx)
	})
}

func TestBuildBranchingPrompt(t *testing.T) {
	t.Run("emits one line per branch with token and description", func(t *testing.T) {
		brs := []engine.Transition{
			{TargetID: "a", Description: pointer.Ptr("first branch")},
			{TargetID: "b", Description: pointer.Ptr("second branch")},
		}
		out, err := buildBranchingPrompt(brs)
		require.NoError(t, err)
		assert.Contains(t, out, `"choice_0"`)
		assert.Contains(t, out, "first branch")
		assert.Contains(t, out, `"choice_1"`)
		assert.Contains(t, out, "second branch")
	})

	t.Run("missing description on a branch errors", func(t *testing.T) {
		brs := []engine.Transition{
			{TargetID: "a", Description: pointer.Ptr("ok")},
			{TargetID: "b", Description: nil},
		}
		_, err := buildBranchingPrompt(brs)
		require.Error(t, err)
		assert.Contains(t, err.Error(), "no description")
	})
}

func TestAgent_Outputs(t *testing.T) {
	t.Run("answer slot emitted only in emit mode", func(t *testing.T) {
		emit := workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}
		assign := workflow.OutputBinding{
			Active: true,
			Mode:   workflow.OutputBindingModeAssign,
			Target: &workflow.Reference{SrcId: engine.SrcDeclared, VarId: "x"},
		}

		a1 := newAgentNode("a1", emit, nil)
		out := a1.Outputs()
		assert.Contains(t, out, "answer")
		assert.Equal(t, workflow.String, out["answer"])

		a2 := newAgentNode("a2", assign, nil)
		out = a2.Outputs()
		assert.NotContains(t, out, "answer")
	})

	t.Run("emit-mode declared outputs are included", func(t *testing.T) {
		emit := workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}
		decls := []workflow.OutputDeclaration{
			{Name: "score", DataType: workflow.Int, Mode: workflow.OutputDeclarationModeEmit, Uid: pointer.Ptr("score-uid")},
			{Name: "tag", DataType: workflow.String, Mode: workflow.OutputDeclarationModeAssign,
				Target: &workflow.Reference{SrcId: engine.SrcDeclared, VarId: "x"}},
		}
		a := newAgentNode("a", emit, decls)
		out := a.Outputs()

		assert.Contains(t, out, "score-uid")
		assert.Equal(t, workflow.Int, out["score-uid"])
		assert.NotContains(t, out, "tag") // assign-mode declarations are not emitter outputs
	})
}

func TestAgent_BuildResponseFormat(t *testing.T) {
	emit := workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}

	t.Run("contains answer property", func(t *testing.T) {
		a := newAgentNode("a", emit, nil)
		rf := a.buildResponseFormat()
		require.NotNil(t, rf)
		assert.Equal(t, "a_output", rf.Name)
		props, ok := rf.Schema["properties"].(map[string]any)
		require.True(t, ok)
		assert.Contains(t, props, "answer")
	})

	t.Run("includes declared outputs keyed by name", func(t *testing.T) {
		a := newAgentNode("a", emit, []workflow.OutputDeclaration{
			{Name: "score", DataType: workflow.Int, Mode: workflow.OutputDeclarationModeEmit, Uid: pointer.Ptr("u1")},
			{Name: "label", DataType: workflow.String, Mode: workflow.OutputDeclarationModeEmit, Uid: pointer.Ptr("u2")},
		})
		rf := a.buildResponseFormat()
		props, ok := rf.Schema["properties"].(map[string]any)
		require.True(t, ok)

		score, _ := props["score"].(map[string]any)
		assert.Equal(t, "integer", score["type"])
		label, _ := props["label"].(map[string]any)
		assert.Equal(t, "string", label["type"])
	})

	t.Run("no choice property when zero or one branch", func(t *testing.T) {
		a := newAgentNode("a", emit, nil)
		// no transitions wired
		rf := a.buildResponseFormat()
		props := rf.Schema["properties"].(map[string]any)
		assert.NotContains(t, props, "choice")

		// One branch
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "n1", Description: pointer.Ptr("only"),
		}))
		rf = a.buildResponseFormat()
		props = rf.Schema["properties"].(map[string]any)
		assert.NotContains(t, props, "choice")
	})

	t.Run("choice enum present with N tokens when N>1 branches", func(t *testing.T) {
		a := newAgentNode("a", emit, nil)
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "n1", Description: pointer.Ptr("first"),
		}))
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "n2", Description: pointer.Ptr("second"),
		}))
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "n3", Description: pointer.Ptr("third"),
		}))
		rf := a.buildResponseFormat()
		props := rf.Schema["properties"].(map[string]any)
		choice, ok := props["choice"].(map[string]any)
		require.True(t, ok, "choice property should exist for >1 branches")
		assert.Equal(t, "string", choice["type"])
		enums, _ := choice["enum"].([]string)
		assert.Equal(t, []string{"choice_0", "choice_1", "choice_2"}, enums)
	})
}

func TestAgent_ApplyStructuredOutputs(t *testing.T) {
	emit := workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}

	t.Run("writes answer plus emit-declared output", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		decls := []workflow.OutputDeclaration{
			{Name: "score", DataType: workflow.Int, Mode: workflow.OutputDeclarationModeEmit, Uid: pointer.Ptr("score-uid")},
		}
		a := newAgentNode("a", emit, decls)

		err = a.applyStructuredOutputs(s, map[string]any{
			"answer": "ok",
			"score":  float64(7),
		})
		require.NoError(t, err)

		ans, err := s.Resolve(workflow.Reference{SrcId: "a", VarId: agentAnswerOutID})
		require.NoError(t, err)
		assert.Equal(t, expr.StringVal("ok"), ans)

		sc, err := s.Resolve(workflow.Reference{SrcId: "a", VarId: "score-uid"})
		require.NoError(t, err)
		assert.Equal(t, expr.IntVal(7), sc)
	})

	t.Run("missing declared output errors", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		decls := []workflow.OutputDeclaration{
			{Name: "score", DataType: workflow.Int, Mode: workflow.OutputDeclarationModeEmit, Uid: pointer.Ptr("score-uid")},
		}
		a := newAgentNode("a", emit, decls)

		err = a.applyStructuredOutputs(s, map[string]any{"answer": "ok"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), `missing declared output "score"`)
	})

	t.Run("type-mismatched declared output errors", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		decls := []workflow.OutputDeclaration{
			{Name: "score", DataType: workflow.Int, Mode: workflow.OutputDeclarationModeEmit, Uid: pointer.Ptr("u")},
		}
		a := newAgentNode("a", emit, decls)
		err = a.applyStructuredOutputs(s, map[string]any{"answer": "ok", "score": "not a number"})
		require.Error(t, err)
		assert.Contains(t, err.Error(), "score")
	})

	t.Run("assign-mode declaration writes to target", func(t *testing.T) {
		s, err := engine.NewMainScope([]workflow.Variable{
			{Uid: "label", DataType: workflow.String},
		})
		require.NoError(t, err)
		decls := []workflow.OutputDeclaration{
			{
				Name: "tag", DataType: workflow.String,
				Mode:   workflow.OutputDeclarationModeAssign,
				Target: &workflow.Reference{SrcId: engine.SrcDeclared, VarId: "label"},
			},
		}
		a := newAgentNode("a", emit, decls)

		err = a.applyStructuredOutputs(s, map[string]any{"answer": "x", "tag": "hello"})
		require.NoError(t, err)
		v, err := s.Resolve(workflow.Reference{SrcId: engine.SrcDeclared, VarId: "label"})
		require.NoError(t, err)
		assert.Equal(t, expr.StringVal("hello"), v)
	})

	t.Run("non-string answer falls back to empty string", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		a := newAgentNode("a", emit, nil)

		// answer is a number — code uses comma-ok cast and ignores type mismatch.
		err = a.applyStructuredOutputs(s, map[string]any{"answer": 123})
		require.NoError(t, err)
		v, err := s.Resolve(workflow.Reference{SrcId: "a", VarId: agentAnswerOutID})
		require.NoError(t, err)
		assert.Equal(t, expr.StringVal(""), v)
	})
}

func TestAgent_Setup(t *testing.T) {
	emit := workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}

	t.Run("plain agent: structuredResponse=false, no choice prompt appended", func(t *testing.T) {
		a := newAgentNode("a", emit, nil)
		require.NoError(t, a.Setup(t.Context()))
		assert.False(t, a.structuredResponse)
		assert.NotNil(t, a.agent)
		assert.Nil(t, a.agent.ResponseFormat)
	})

	t.Run("declared outputs flip structuredResponse", func(t *testing.T) {
		decls := []workflow.OutputDeclaration{
			{Name: "n", DataType: workflow.Int, Mode: workflow.OutputDeclarationModeEmit, Uid: pointer.Ptr("u")},
		}
		a := newAgentNode("a", emit, decls)
		require.NoError(t, a.Setup(t.Context()))
		assert.True(t, a.structuredResponse)
		require.NotNil(t, a.agent.ResponseFormat)
	})

	t.Run("multi-branch flips structuredResponse and appends prompt", func(t *testing.T) {
		a := newAgentNode("a", emit, nil)
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "x", Description: pointer.Ptr("path X"),
		}))
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "y", Description: pointer.Ptr("path Y"),
		}))
		require.NoError(t, a.Setup(t.Context()))
		assert.True(t, a.structuredResponse)
		assert.Contains(t, a.agent.Instructions, "choice_0")
		assert.Contains(t, a.agent.Instructions, "path X")
		assert.Contains(t, a.agent.Instructions, "path Y")
	})

	t.Run("multi-branch with missing description fails Setup", func(t *testing.T) {
		a := newAgentNode("a", emit, nil)
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "x", Description: pointer.Ptr("ok"),
		}))
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "y", Description: nil,
		}))
		err := a.Setup(t.Context())
		require.Error(t, err)
		assert.Contains(t, err.Error(), "agent a")
	})
}

func TestAgent_Next(t *testing.T) {
	emit := workflow.OutputBinding{Active: true, Mode: workflow.OutputBindingModeEmit}

	t.Run("zero branches → idle", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		a := newAgentNode("a", emit, nil)
		next, err := a.next(s, "")
		require.NoError(t, err)
		assert.Equal(t, engine.StateIdle, next)
	})

	t.Run("single branch is taken regardless of choice", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		a := newAgentNode("a", emit, nil)
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "only", EdgeType: workflow.AgentChoice,
		}))
		s.SetConversation(llmproxy.InputString("clear me"))

		next, err := a.next(s, "ignored")
		require.NoError(t, err)
		assert.Equal(t, "only", next)
		assert.Empty(t, s.GetConversation()) // AgentChoice cleared it
	})

	t.Run("multi-branch routes via choice token", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		a := newAgentNode("a", emit, nil)
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "first", EdgeType: workflow.AgentChoice, Description: pointer.Ptr("d1"),
		}))
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "second", EdgeType: workflow.AgentChoice, Description: pointer.Ptr("d2"),
		}))

		next, err := a.next(s, "choice_1")
		require.NoError(t, err)
		assert.Equal(t, "second", next)
	})

	t.Run("multi-branch with invalid token errors", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		a := newAgentNode("a", emit, nil)
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "first", Description: pointer.Ptr("d1"),
		}))
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "second", Description: pointer.Ptr("d2"),
		}))

		_, err = a.next(s, "garbage")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "agent a")
	})

	t.Run("transition Apply error is wrapped", func(t *testing.T) {
		s, err := engine.NewMainScope(nil)
		require.NoError(t, err)
		a := newAgentNode("a", emit, nil)
		require.NoError(t, a.AddTransition(engine.PortCtrl, engine.Transition{
			TargetID: "first", EdgeType: workflow.AgentTask, Prompt: nil, // bad: AgentTask requires prompt
		}))

		_, err = a.next(s, "")
		require.Error(t, err)
		assert.Contains(t, err.Error(), "applying transition")
	})
}
