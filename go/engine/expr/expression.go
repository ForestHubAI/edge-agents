// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package expr

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
)

var placeholderRE = regexp.MustCompile(`\$\{\}`)
var castOverrideRE = regexp.MustCompile(`\b(int|float|bool|str)\(\$\{\}\)`)

// Eval evaluates an workflowapi.Expression against resolved references,
// returning a typed Value.
func Eval(expr workflowapi.Expression, resolve VarResolver) (Value, error) {
	plCount := len(placeholderRE.FindAllStringIndex(expr.Expression, -1))
	refCount := len(expr.References)
	if plCount != refCount {
		return Value{}, fmt.Errorf(
			"expression placeholders (%d) do not match references (%d)",
			plCount, refCount,
		)
	}

	refs := make([]Value, refCount)
	for i, ref := range expr.References {
		v, err := resolve.Resolve(ref)
		if err != nil {
			return Value{}, err
		}
		// An image has no text or scalar form; using one in an expression
		// would silently coerce the frame to an empty/zero value.
		if v.Type == workflowapi.Image {
			return Value{}, fmt.Errorf("an image value cannot be used in an expression")
		}
		refs[i] = v
	}

	if expr.DataType == workflowapi.String {
		return evalStringExpr(expr.Expression, refs)
	}
	return evalCodeExpr(expr.Expression, expr.DataType, refs)
}

// EvalString is a convenience that evaluates and returns a string.
func EvalString(expr workflowapi.Expression, resolve VarResolver) (string, error) {
	v, err := Eval(expr, resolve)
	if err != nil {
		return "", err
	}
	return v.AsString(), nil
}

// EvalBool evaluates and returns a bool.
func EvalBool(expr workflowapi.Expression, resolve VarResolver) (bool, error) {
	v, err := Eval(expr, resolve)
	if err != nil {
		return false, err
	}
	return v.AsBool(), nil
}

// evalStringExpr handles string-type expressions with interpolation.
func evalStringExpr(expression string, refs []Value) (Value, error) {
	if expression == "" && len(refs) == 0 {
		return StringVal(""), nil
	}
	if len(refs) == 0 {
		return StringVal(expression), nil
	}

	expression, refs = applyCastsInString(expression, refs)

	if expression == "${}" && len(refs) == 1 && refs[0].Type == workflowapi.String {
		return refs[0], nil
	}

	var b strings.Builder
	parts := placeholderRE.Split(expression, -1)
	for i, part := range parts {
		b.WriteString(part)
		if i < len(refs) {
			b.WriteString(refs[i].AsString())
		}
	}
	return StringVal(b.String()), nil
}

// applyCastsInString processes cast overrides like int(${}) in string
// expressions, applying the cast to the corresponding ref value and
// stripping the cast syntax from the expression.
func applyCastsInString(expression string, refs []Value) (string, []Value) {
	result := make([]Value, len(refs))
	copy(result, refs)

	for {
		loc := castOverrideRE.FindStringSubmatchIndex(expression)
		if loc == nil {
			break
		}
		castName := expression[loc[2]:loc[3]]
		plIdx := len(placeholderRE.FindAllStringIndex(expression[:loc[0]], -1))
		targetType := castNameToDataType(castName)
		result[plIdx] = result[plIdx].Cast(targetType)
		expression = expression[:loc[0]] + "${}" + expression[loc[1]:]
	}
	return expression, result
}

// evalCodeExpr handles non-string expressions (arithmetic, comparison, boolean).
func evalCodeExpr(expression string, targetType workflowapi.DataType, refs []Value) (Value, error) {
	expression, refs = applyCastsInCode(expression, refs)

	if expression == "${}" && len(refs) == 1 {
		return refs[0].Cast(targetType), nil
	}

	idx := 0
	resolved := placeholderRE.ReplaceAllStringFunc(expression, func(_ string) string {
		v := refs[idx]
		idx++
		return valueToLiteral(v)
	})
	resolved = strings.TrimSpace(resolved)

	return parseAndEval(resolved, targetType)
}

// applyCastsInCode processes cast functions in non-string expressions.
func applyCastsInCode(expression string, refs []Value) (string, []Value) {
	result := make([]Value, len(refs))
	copy(result, refs)

	for {
		loc := castOverrideRE.FindStringSubmatchIndex(expression)
		if loc == nil {
			break
		}
		castName := expression[loc[2]:loc[3]]
		plIdx := len(placeholderRE.FindAllStringIndex(expression[:loc[0]], -1))
		targetType := castNameToDataType(castName)
		result[plIdx] = result[plIdx].Cast(targetType)
		expression = expression[:loc[0]] + "${}" + expression[loc[1]:]
	}
	return expression, result
}

func valueToLiteral(v Value) string {
	switch v.Type {
	case workflowapi.Int:
		return strconv.FormatInt(v.AsInt(), 10)
	case workflowapi.Float:
		return strconv.FormatFloat(v.AsFloat(), 'f', -1, 64)
	case workflowapi.Bool:
		if v.AsBool() {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%q", v.AsString())
	}
}

func castNameToDataType(name string) workflowapi.DataType {
	switch name {
	case "int":
		return workflowapi.Int
	case "float":
		return workflowapi.Float
	case "bool":
		return workflowapi.Bool
	case "str":
		return workflowapi.String
	default:
		return workflowapi.String
	}
}
