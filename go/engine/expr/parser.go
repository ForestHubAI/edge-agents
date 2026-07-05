// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package expr

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
)

// parseAndEval evaluates a simple expression string with literals
// and operators. Supports: +, -, *, /, %, ==, !=, <, >, <=, >=, &&, ||, !
func parseAndEval(expr string, targetType workflow.DataType) (Value, error) {
	p := &parser{input: expr, pos: 0}
	val, err := p.parseOr()
	if err != nil {
		return Value{}, fmt.Errorf("evaluating %q: %w", expr, err)
	}
	return val.Cast(targetType), nil
}

// Minimal recursive-descent expression parser/evaluator.
type parser struct {
	input string
	pos   int
}

func (p *parser) skipWhitespace() {
	for p.pos < len(p.input) && (p.input[p.pos] == ' ' || p.input[p.pos] == '\t') {
		p.pos++
	}
}

func (p *parser) peek() byte {
	p.skipWhitespace()
	if p.pos >= len(p.input) {
		return 0
	}
	return p.input[p.pos]
}

func (p *parser) peekTwo() string {
	p.skipWhitespace()
	if p.pos+1 >= len(p.input) {
		if p.pos < len(p.input) {
			return string(p.input[p.pos])
		}
		return ""
	}
	return p.input[p.pos : p.pos+2]
}

func (p *parser) parseOr() (Value, error) {
	left, err := p.parseAnd()
	if err != nil {
		return Value{}, err
	}
	for p.peekTwo() == "||" {
		p.pos += 2
		right, err := p.parseAnd()
		if err != nil {
			return Value{}, err
		}
		left = BoolVal(left.AsBool() || right.AsBool())
	}
	return left, nil
}

func (p *parser) parseAnd() (Value, error) {
	left, err := p.parseEquality()
	if err != nil {
		return Value{}, err
	}
	for p.peekTwo() == "&&" {
		p.pos += 2
		right, err := p.parseEquality()
		if err != nil {
			return Value{}, err
		}
		left = BoolVal(left.AsBool() && right.AsBool())
	}
	return left, nil
}

func (p *parser) parseEquality() (Value, error) {
	left, err := p.parseComparison()
	if err != nil {
		return Value{}, err
	}
	for {
		op := p.peekTwo()
		if op != "==" && op != "!=" {
			break
		}
		p.pos += 2
		right, err := p.parseComparison()
		if err != nil {
			return Value{}, err
		}
		if op == "==" {
			left = BoolVal(compareValues(left, right) == 0)
		} else {
			left = BoolVal(compareValues(left, right) != 0)
		}
	}
	return left, nil
}

func (p *parser) parseComparison() (Value, error) {
	left, err := p.parseAddSub()
	if err != nil {
		return Value{}, err
	}
	for {
		op := p.peekTwo()
		switch op {
		case "<=":
			p.pos += 2
			right, err := p.parseAddSub()
			if err != nil {
				return Value{}, err
			}
			left = BoolVal(compareValues(left, right) <= 0)
		case ">=":
			p.pos += 2
			right, err := p.parseAddSub()
			if err != nil {
				return Value{}, err
			}
			left = BoolVal(compareValues(left, right) >= 0)
		default:
			ch := p.peek()
			if ch == '<' {
				p.pos++
				right, err := p.parseAddSub()
				if err != nil {
					return Value{}, err
				}
				left = BoolVal(compareValues(left, right) < 0)
			} else if ch == '>' {
				p.pos++
				right, err := p.parseAddSub()
				if err != nil {
					return Value{}, err
				}
				left = BoolVal(compareValues(left, right) > 0)
			} else {
				return left, nil
			}
		}
	}
}

func (p *parser) parseAddSub() (Value, error) {
	left, err := p.parseMulDiv()
	if err != nil {
		return Value{}, err
	}
	for {
		ch := p.peek()
		if ch != '+' && ch != '-' {
			break
		}
		p.pos++
		right, err := p.parseMulDiv()
		if err != nil {
			return Value{}, err
		}
		if left.Type == workflow.Float || right.Type == workflow.Float {
			if ch == '+' {
				left = FloatVal(left.AsFloat() + right.AsFloat())
			} else {
				left = FloatVal(left.AsFloat() - right.AsFloat())
			}
		} else {
			if ch == '+' {
				left = IntVal(left.AsInt() + right.AsInt())
			} else {
				left = IntVal(left.AsInt() - right.AsInt())
			}
		}
	}
	return left, nil
}

func (p *parser) parseMulDiv() (Value, error) {
	left, err := p.parseUnary()
	if err != nil {
		return Value{}, err
	}
	for {
		ch := p.peek()
		if ch != '*' && ch != '/' && ch != '%' {
			break
		}
		p.pos++
		right, err := p.parseUnary()
		if err != nil {
			return Value{}, err
		}
		if left.Type == workflow.Float || right.Type == workflow.Float {
			switch ch {
			case '*':
				left = FloatVal(left.AsFloat() * right.AsFloat())
			case '/':
				d := right.AsFloat()
				if d == 0 {
					return Value{}, fmt.Errorf("division by zero")
				}
				left = FloatVal(left.AsFloat() / d)
			case '%':
				d := right.AsInt()
				if d == 0 {
					return Value{}, fmt.Errorf("modulo by zero")
				}
				left = IntVal(left.AsInt() % d)
			}
		} else {
			switch ch {
			case '*':
				left = IntVal(left.AsInt() * right.AsInt())
			case '/':
				d := right.AsInt()
				if d == 0 {
					return Value{}, fmt.Errorf("division by zero")
				}
				left = IntVal(left.AsInt() / d)
			case '%':
				d := right.AsInt()
				if d == 0 {
					return Value{}, fmt.Errorf("modulo by zero")
				}
				left = IntVal(left.AsInt() % d)
			}
		}
	}
	return left, nil
}

func (p *parser) parseUnary() (Value, error) {
	ch := p.peek()
	if ch == '!' {
		p.pos++
		val, err := p.parseUnary()
		if err != nil {
			return Value{}, err
		}
		return BoolVal(!val.AsBool()), nil
	}
	if ch == '-' {
		// Check it's not a two-char operator
		if p.pos+1 < len(p.input) && p.input[p.pos+1] >= '0' && p.input[p.pos+1] <= '9' {
			return p.parseAtom()
		}
		p.pos++
		val, err := p.parseUnary()
		if err != nil {
			return Value{}, err
		}
		if val.Type == workflow.Float {
			return FloatVal(-val.AsFloat()), nil
		}
		return IntVal(-val.AsInt()), nil
	}
	return p.parseAtom()
}

func (p *parser) parseAtom() (Value, error) {
	p.skipWhitespace()
	if p.pos >= len(p.input) {
		return Value{}, fmt.Errorf("unexpected end of expression")
	}

	// Parenthesized sub-expression
	if p.input[p.pos] == '(' {
		p.pos++
		val, err := p.parseOr()
		if err != nil {
			return Value{}, err
		}
		p.skipWhitespace()
		if p.pos < len(p.input) && p.input[p.pos] == ')' {
			p.pos++
		}
		return val, nil
	}

	// String literal
	if p.input[p.pos] == '"' {
		return p.parseStringLiteral()
	}

	// Boolean literals
	if strings.HasPrefix(p.input[p.pos:], "true") && !isIdentChar(p.safeCharAt(p.pos+4)) {
		p.pos += 4
		return BoolVal(true), nil
	}
	if strings.HasPrefix(p.input[p.pos:], "false") && !isIdentChar(p.safeCharAt(p.pos+5)) {
		p.pos += 5
		return BoolVal(false), nil
	}

	// Numeric literal (int or float)
	return p.parseNumber()
}

func (p *parser) parseStringLiteral() (Value, error) {
	p.pos++ // skip opening "
	var b strings.Builder
	for p.pos < len(p.input) {
		ch := p.input[p.pos]
		if ch == '"' {
			p.pos++
			return StringVal(b.String()), nil
		}
		if ch == '\\' && p.pos+1 < len(p.input) {
			p.pos++
			switch p.input[p.pos] {
			case 'n':
				b.WriteByte('\n')
			case 't':
				b.WriteByte('\t')
			case '"':
				b.WriteByte('"')
			case '\\':
				b.WriteByte('\\')
			default:
				b.WriteByte(p.input[p.pos])
			}
			p.pos++
			continue
		}
		b.WriteByte(ch)
		p.pos++
	}
	return StringVal(b.String()), nil
}

func (p *parser) parseNumber() (Value, error) {
	start := p.pos
	if p.pos < len(p.input) && (p.input[p.pos] == '-' || p.input[p.pos] == '+') {
		p.pos++
	}
	if p.pos >= len(p.input) || (p.input[p.pos] < '0' || p.input[p.pos] > '9') {
		return Value{}, fmt.Errorf("expected number at position %d in %q", start, p.input)
	}
	isFloat := false
	for p.pos < len(p.input) {
		ch := p.input[p.pos]
		if ch >= '0' && ch <= '9' {
			p.pos++
		} else if ch == '.' && !isFloat {
			isFloat = true
			p.pos++
		} else if ch == 'f' && p.pos+1 <= len(p.input) {
			// trailing 'f' for float literal compatibility with C++ expressions
			p.pos++
			isFloat = true
			break
		} else {
			break
		}
	}
	lit := p.input[start:p.pos]
	lit = strings.TrimSuffix(lit, "f")
	if isFloat {
		f, err := strconv.ParseFloat(lit, 64)
		if err != nil {
			return Value{}, fmt.Errorf("invalid float %q: %w", lit, err)
		}
		return FloatVal(f), nil
	}
	n, err := strconv.ParseInt(lit, 10, 64)
	if err != nil {
		return Value{}, fmt.Errorf("invalid int %q: %w", lit, err)
	}
	return IntVal(n), nil
}

func (p *parser) safeCharAt(pos int) byte {
	if pos >= len(p.input) {
		return 0
	}
	return p.input[pos]
}

func isIdentChar(ch byte) bool {
	return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || ch == '_'
}

func compareValues(a, b Value) int {
	if a.Type == workflow.String || b.Type == workflow.String {
		as, bs := a.AsString(), b.AsString()
		if as < bs {
			return -1
		}
		if as > bs {
			return 1
		}
		return 0
	}
	af, bf := a.AsFloat(), b.AsFloat()
	if af < bf {
		return -1
	}
	if af > bf {
		return 1
	}
	return 0
}
