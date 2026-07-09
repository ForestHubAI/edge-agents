// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package expr

import (
	"fmt"
	"strconv"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
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
	Type workflowapi.DataType
	Raw  any // int64, float64, bool, string, or []byte (image)
}

func IntVal(v int64) Value     { return Value{Type: workflowapi.Int, Raw: v} }
func FloatVal(v float64) Value { return Value{Type: workflowapi.Float, Raw: v} }
func BoolVal(v bool) Value     { return Value{Type: workflowapi.Bool, Raw: v} }
func StringVal(v string) Value { return Value{Type: workflowapi.String, Raw: v} }

// ImageVal wraps an encoded frame blob (e.g. JPEG bytes). It is an opaque
// value — there is no Cast/AsX path into or out of it beyond AsImage.
func ImageVal(v []byte) Value { return Value{Type: workflowapi.Image, Raw: v} }

// ZeroValue returns the zero value for a given data type.
func ZeroValue(dt workflowapi.DataType) Value {
	switch dt {
	case workflowapi.Int:
		return IntVal(0)
	case workflowapi.Float:
		return FloatVal(0)
	case workflowapi.Bool:
		return BoolVal(false)
	case workflowapi.Image:
		return ImageVal(nil)
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

// AsImage returns the raw image bytes, or an error if the value is not an image.
func (v Value) AsImage() ([]byte, error) {
	if v.Type != workflowapi.Image {
		return nil, fmt.Errorf("cannot read %s as image", v.Type)
	}
	b, _ := v.Raw.([]byte)
	return b, nil
}

// Cast converts a value to the target data type.
func (v Value) Cast(target workflowapi.DataType) Value {
	if v.Type == target {
		return v
	}
	switch target {
	case workflowapi.Int:
		return IntVal(v.AsInt())
	case workflowapi.Float:
		return FloatVal(v.AsFloat())
	case workflowapi.Bool:
		return BoolVal(v.AsBool())
	case workflowapi.String:
		return StringVal(v.AsString())
	default:
		return v
	}
}

// Coerce converts any into a typed Value of the declared data type. Nil is
// treated as absence and returns the zero value without error; any other
// concrete type that doesn't match dt returns a non-nil error.
func Coerce(dt workflowapi.DataType, raw any) (Value, error) {
	if raw == nil {
		return ZeroValue(dt), nil
	}
	switch dt {
	case workflowapi.Int:
		switch v := raw.(type) {
		case float64:
			return IntVal(int64(v)), nil
		case int64:
			return IntVal(v), nil
		}
	case workflowapi.Float:
		switch v := raw.(type) {
		case float64:
			return FloatVal(v), nil
		case int64:
			return FloatVal(float64(v)), nil
		}
	case workflowapi.Bool:
		if b, ok := raw.(bool); ok {
			return BoolVal(b), nil
		}
	case workflowapi.String:
		if s, ok := raw.(string); ok {
			return StringVal(s), nil
		}
	}
	return Value{}, fmt.Errorf("cannot coerce %T to %s", raw, dt)
}
