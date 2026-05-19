package expr

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"fh-backend/pkg/api"
)

var placeholderRE = regexp.MustCompile(`\$\{\}`)
var castOverrideRE = regexp.MustCompile(`\b(int|float|bool|str)\(\$\{\}\)`)

// Eval evaluates an api.Expression against resolved references,
// returning a typed Value.
func Eval(expr api.Expression, resolve VarResolver) (Value, error) {
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
		refs[i] = v
	}

	if expr.DataType == api.String {
		return evalStringExpr(expr.Expression, refs)
	}
	return evalCodeExpr(expr.Expression, expr.DataType, refs)
}

// EvalString is a convenience that evaluates and returns a string.
func EvalString(expr api.Expression, resolve VarResolver) (string, error) {
	v, err := Eval(expr, resolve)
	if err != nil {
		return "", err
	}
	return v.AsString(), nil
}

// EvalBool evaluates and returns a bool.
func EvalBool(expr api.Expression, resolve VarResolver) (bool, error) {
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

	if expression == "${}" && len(refs) == 1 && refs[0].Type == api.String {
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
func evalCodeExpr(expression string, targetType api.DataType, refs []Value) (Value, error) {
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
	case api.Int:
		return strconv.FormatInt(v.AsInt(), 10)
	case api.Float:
		return strconv.FormatFloat(v.AsFloat(), 'f', -1, 64)
	case api.Bool:
		if v.AsBool() {
			return "true"
		}
		return "false"
	default:
		return fmt.Sprintf("%q", v.AsString())
	}
}

func castNameToDataType(name string) api.DataType {
	switch name {
	case "int":
		return api.Int
	case "float":
		return api.Float
	case "bool":
		return api.Bool
	case "str":
		return api.String
	default:
		return api.String
	}
}
