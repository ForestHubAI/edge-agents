// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package expr

import (
	"testing"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// mockResolver is a test double for VarResolver backed by a flat map.
type mockResolver map[string]Value

func (m mockResolver) Resolve(ref workflowapi.Reference) (Value, error) {
	v, ok := m[ref.SrcId+":"+ref.VarId]
	if !ok {
		return Value{}, assert.AnError
	}
	return v, nil
}

func TestEval_StringInterpolation(t *testing.T) {
	resolve := mockResolver{
		"node1:out-0": FloatVal(23.5),
	}

	v, err := Eval(workflowapi.Expression{
		Expression: "Temperature is ${} degrees",
		DataType:   workflowapi.String,
		References: []workflowapi.Reference{{SrcId: "node1", VarId: "out-0"}},
	}, resolve)
	require.NoError(t, err)
	assert.Equal(t, "Temperature is 23.5 degrees", v.AsString())
}

func TestEval_StringPassthrough(t *testing.T) {
	resolve := mockResolver{
		"node1:out-0": StringVal("hello"),
	}

	v, err := Eval(workflowapi.Expression{
		Expression: "${}",
		DataType:   workflowapi.String,
		References: []workflowapi.Reference{{SrcId: "node1", VarId: "out-0"}},
	}, resolve)
	require.NoError(t, err)
	assert.Equal(t, StringVal("hello"), v)
}

func TestEval_EmptyString(t *testing.T) {
	v, err := Eval(workflowapi.Expression{
		Expression: "",
		DataType:   workflowapi.String,
		References: nil,
	}, nil)
	require.NoError(t, err)
	assert.Equal(t, StringVal(""), v)
}

func TestEval_LiteralString(t *testing.T) {
	v, err := Eval(workflowapi.Expression{
		Expression: "hello world",
		DataType:   workflowapi.String,
		References: nil,
	}, nil)
	require.NoError(t, err)
	assert.Equal(t, StringVal("hello world"), v)
}

func TestEval_Arithmetic(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": IntVal(10),
		"n2:out-0": IntVal(3),
	}

	tests := []struct {
		name string
		expr string
		dt   workflowapi.DataType
		refs []workflowapi.Reference
		want Value
	}{
		{
			"addition",
			"${} + ${}",
			workflowapi.Int,
			[]workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}, {SrcId: "n2", VarId: "out-0"}},
			IntVal(13),
		},
		{
			"subtraction",
			"${} - ${}",
			workflowapi.Int,
			[]workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}, {SrcId: "n2", VarId: "out-0"}},
			IntVal(7),
		},
		{
			"multiplication",
			"${} * ${}",
			workflowapi.Int,
			[]workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}, {SrcId: "n2", VarId: "out-0"}},
			IntVal(30),
		},
		{
			"division",
			"${} / ${}",
			workflowapi.Int,
			[]workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}, {SrcId: "n2", VarId: "out-0"}},
			IntVal(3),
		},
		{
			"modulo",
			"${} % ${}",
			workflowapi.Int,
			[]workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}, {SrcId: "n2", VarId: "out-0"}},
			IntVal(1),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, err := Eval(workflowapi.Expression{
				Expression: tt.expr,
				DataType:   tt.dt,
				References: tt.refs,
			}, resolve)
			require.NoError(t, err)
			assert.Equal(t, tt.want, v)
		})
	}
}

func TestEval_Comparison(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": IntVal(10),
		"n2:out-0": IntVal(3),
	}
	refs := []workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}, {SrcId: "n2", VarId: "out-0"}}

	tests := []struct {
		name string
		expr string
		want bool
	}{
		{"greater than", "${} > ${}", true},
		{"less than", "${} < ${}", false},
		{"equal", "${} == ${}", false},
		{"not equal", "${} != ${}", true},
		{"greater or equal", "${} >= ${}", true},
		{"less or equal", "${} <= ${}", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, err := Eval(workflowapi.Expression{
				Expression: tt.expr,
				DataType:   workflowapi.Bool,
				References: refs,
			}, resolve)
			require.NoError(t, err)
			assert.Equal(t, tt.want, v.AsBool())
		})
	}
}

func TestEval_Boolean(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": BoolVal(true),
		"n2:out-0": BoolVal(false),
	}
	refs := []workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}, {SrcId: "n2", VarId: "out-0"}}

	v, err := Eval(workflowapi.Expression{
		Expression: "${} && ${}",
		DataType:   workflowapi.Bool,
		References: refs,
	}, resolve)
	require.NoError(t, err)
	assert.False(t, v.AsBool())

	v, err = Eval(workflowapi.Expression{
		Expression: "${} || ${}",
		DataType:   workflowapi.Bool,
		References: refs,
	}, resolve)
	require.NoError(t, err)
	assert.True(t, v.AsBool())
}

func TestEval_Negation(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": BoolVal(true),
	}

	v, err := Eval(workflowapi.Expression{
		Expression: "!${}",
		DataType:   workflowapi.Bool,
		References: []workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}},
	}, resolve)
	require.NoError(t, err)
	assert.False(t, v.AsBool())
}

func TestEval_SingleRefPassthrough(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": IntVal(42),
	}

	v, err := Eval(workflowapi.Expression{
		Expression: "${}",
		DataType:   workflowapi.Int,
		References: []workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}},
	}, resolve)
	require.NoError(t, err)
	assert.Equal(t, IntVal(42), v)
}

func TestEval_CastInString(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": StringVal("42"),
	}

	v, err := Eval(workflowapi.Expression{
		Expression: "Value is int(${}) ok",
		DataType:   workflowapi.String,
		References: []workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}},
	}, resolve)
	require.NoError(t, err)
	assert.Equal(t, "Value is 42 ok", v.AsString())
}

func TestEval_CastInCode(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": StringVal("42"),
	}

	v, err := Eval(workflowapi.Expression{
		Expression: "int(${})",
		DataType:   workflowapi.Int,
		References: []workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}},
	}, resolve)
	require.NoError(t, err)
	assert.Equal(t, IntVal(42), v)
}

func TestEval_PlaceholderMismatch(t *testing.T) {
	_, err := Eval(workflowapi.Expression{
		Expression: "${} + ${}",
		DataType:   workflowapi.Int,
		References: []workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}},
	}, nil)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "do not match")
}

func TestEval_FloatArithmetic(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": FloatVal(1.5),
		"n2:out-0": IntVal(2),
	}

	v, err := Eval(workflowapi.Expression{
		Expression: "${} + ${}",
		DataType:   workflowapi.Float,
		References: []workflowapi.Reference{
			{SrcId: "n1", VarId: "out-0"},
			{SrcId: "n2", VarId: "out-0"},
		},
	}, resolve)
	require.NoError(t, err)
	assert.Equal(t, FloatVal(3.5), v)
}

func TestEval_ComparisonWithLiteral(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": IntVal(25),
	}

	v, err := Eval(workflowapi.Expression{
		Expression: "${} > 10",
		DataType:   workflowapi.Bool,
		References: []workflowapi.Reference{{SrcId: "n1", VarId: "out-0"}},
	}, resolve)
	require.NoError(t, err)
	assert.True(t, v.AsBool())
}

func TestEval_MultipleInterpolation(t *testing.T) {
	resolve := mockResolver{
		"n1:out-0": StringVal("Alice"),
		"n2:out-0": IntVal(30),
	}

	v, err := Eval(workflowapi.Expression{
		Expression: "Name: ${}, Age: ${}",
		DataType:   workflowapi.String,
		References: []workflowapi.Reference{
			{SrcId: "n1", VarId: "out-0"},
			{SrcId: "n2", VarId: "out-0"},
		},
	}, resolve)
	require.NoError(t, err)
	assert.Equal(t, "Name: Alice, Age: 30", v.AsString())
}
