// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package expr

import (
	"fmt"
	"strconv"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
)

// Value is the runtime representation of a typed workflow variable.
//
// The workflow has its own type system (int / float / bool / string) that
// Go's compiler knows nothing about. Value bridges the two: Type carries
// the declared workflow type, Raw holds the actual storage. Type mismatches
// are caught at runtime by Cast / AsX, not at compile time.
//
// This is the standard interpreter pattern — the hosted language's type
// system lives in the interpreter's data structures rather than in the
// host language's compiler.
type Value struct {
	Type workflow.DataType
	Raw  any // int64, float64, bool, or string
}

func IntVal(v int64) Value     { return Value{Type: workflow.Int, Raw: v} }
func FloatVal(v float64) Value { return Value{Type: workflow.Float, Raw: v} }
func BoolVal(v bool) Value     { return Value{Type: workflow.Bool, Raw: v} }
func StringVal(v string) Value { return Value{Type: workflow.String, Raw: v} }

// ZeroValue returns the zero value for a given data type.
func ZeroValue(dt workflow.DataType) Value {
	switch dt {
	case workflow.Int:
		return IntVal(0)
	case workflow.Float:
		return FloatVal(0)
	case workflow.Bool:
		return BoolVal(false)
	default:
		return StringVal("")
	}
}

func (v Value) AsInt() int64 {
	switch r := v.Raw.(type) {
	case int64:
		return r
	case float64:
		return int64(r)
	case bool:
		if r {
			return 1
		}
		return 0
	case string:
		n, _ := strconv.ParseInt(r, 10, 64)
		return n
	default:
		return 0
	}
}

func (v Value) AsFloat() float64 {
	switch r := v.Raw.(type) {
	case float64:
		return r
	case int64:
		return float64(r)
	case bool:
		if r {
			return 1
		}
		return 0
	case string:
		f, _ := strconv.ParseFloat(r, 64)
		return f
	default:
		return 0
	}
}

func (v Value) AsBool() bool {
	switch r := v.Raw.(type) {
	case bool:
		return r
	case int64:
		return r != 0
	case float64:
		return r != 0
	case string:
		return r != "" && r != "0" && r != "false"
	default:
		return false
	}
}

func (v Value) AsString() string {
	switch r := v.Raw.(type) {
	case string:
		return r
	case int64:
		return strconv.FormatInt(r, 10)
	case float64:
		return strconv.FormatFloat(r, 'f', -1, 64)
	case bool:
		if r {
			return "true"
		}
		return "false"
	default:
		return ""
	}
}

// Cast converts a value to the target data type.
func (v Value) Cast(target workflow.DataType) Value {
	if v.Type == target {
		return v
	}
	switch target {
	case workflow.Int:
		return IntVal(v.AsInt())
	case workflow.Float:
		return FloatVal(v.AsFloat())
	case workflow.Bool:
		return BoolVal(v.AsBool())
	case workflow.String:
		return StringVal(v.AsString())
	default:
		return v
	}
}

// Coerce converts any into a typed Value of the declared data type. Nil is
// treated as absence and returns the zero value without error; any other
// concrete type that doesn't match dt returns a non-nil error.
func Coerce(dt workflow.DataType, raw any) (Value, error) {
	if raw == nil {
		return ZeroValue(dt), nil
	}
	switch dt {
	case workflow.Int:
		switch v := raw.(type) {
		case float64:
			return IntVal(int64(v)), nil
		case int64:
			return IntVal(v), nil
		}
	case workflow.Float:
		switch v := raw.(type) {
		case float64:
			return FloatVal(v), nil
		case int64:
			return FloatVal(float64(v)), nil
		}
	case workflow.Bool:
		if b, ok := raw.(bool); ok {
			return BoolVal(b), nil
		}
	case workflow.String:
		if s, ok := raw.(string); ok {
			return StringVal(s), nil
		}
	}
	return Value{}, fmt.Errorf("cannot coerce %T to %s", raw, dt)
}
