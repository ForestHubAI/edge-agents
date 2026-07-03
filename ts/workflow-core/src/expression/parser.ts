import jsep from "jsep";
import type { DataType } from "../api";
import { ResolvedExpr } from "./types";

export interface ParseResult {
  isValid: boolean;
  inferredType: DataType | null;
  errors: string[];
}

// Map of placeholder names to their types (populated from variables)
type TypeContext = Map<string, DataType>;

/**
 * Parse and validate an expression against C-style type rules.
 * Replaces ${} placeholders with temporary identifiers, parses with jsep,
 * infers types from the AST, and validates against the expected type.
 */
export function parseExpression(expr: ResolvedExpr): ParseResult {
  // Handle early returns
  if (!expr.expression.trim()) {
    return { isValid: false, inferredType: null, errors: ["Expression is empty"] };
  }
  if (expr.variables.some((v) => v === null)) {
    return { isValid: false, inferredType: null, errors: ["Expression contains stale variable references"] };
  }

  const errors: string[] = [];

  // 1. Build type context from variables
  const typeContext: TypeContext = new Map();

  // Replace ${} placeholders with temp identifiers for jsep
  let parsableExpr = expr.expression;

  // Count placeholders in expression
  const placeholderCount = (expr.expression.match(/\$\{\}/g) || []).length;

  if (placeholderCount !== expr.variables.length) {
    errors.push(`Placeholder count (${placeholderCount}) doesn't match reference count (${expr.variables.length})`);
    return { isValid: false, inferredType: null, errors };
  }

  expr.variables.forEach((variable, i) => {
    const placeholder = `__var${i}__`;
    parsableExpr = parsableExpr.replace("${}", placeholder);

    if (variable) {
      typeContext.set(placeholder, variable.dataType);
    } else {
      // Stale reference - variable was deleted
      errors.push(`Referenced variable at position ${i + 1} not found`);
    }
  });

  // If we have stale/null variables, don't proceed with parsing
  if (errors.length > 0) {
    return { isValid: false, inferredType: null, errors };
  }

  // 2. For string-type expressions, auto-wrap bare text as string literals
  //    so users don't need to type quotes. E.g. `hello __var0__` → `"hello " + __var0__`
  if (expr.expectedType === "string") {
    parsableExpr = wrapStringTemplate(parsableExpr);
  }

  // 3. Parse with jsep
  let ast: jsep.Expression;
  try {
    ast = jsep(parsableExpr);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { isValid: false, inferredType: null, errors: [`Parse error: ${message}`] };
  }

  // 4. Infer type by walking AST
  const inferredType = inferType(ast, typeContext, errors);

  // 5. Check against expected type
  if (inferredType && expr.expectedType !== inferredType) {
    // Allow implicit conversions (int → float, etc.)
    if (!isCompatible(inferredType, expr.expectedType)) {
      errors.push(`Type mismatch: expression evaluates to '${inferredType}', expected '${expr.expectedType}'`);
    }
  }

  return {
    isValid: errors.length === 0 && inferredType !== null,
    inferredType,
    errors,
  };
}

/**
 * Recursively infer the type of an AST node
 */
function inferType(node: jsep.Expression, ctx: TypeContext, errors: string[]): DataType | null {
  switch (node.type) {
    case "Literal":
      return inferLiteralType(node as jsep.Literal);

    case "Identifier": {
      const name = (node as jsep.Identifier).name;
      const type = ctx.get(name);
      if (!type) {
        // Check if it's a placeholder variable that's missing
        if (name.startsWith("__var") && name.endsWith("__")) {
          errors.push(`Missing type for variable reference`);
        } else {
          errors.push(`Unknown identifier: '${name}'`);
        }
      }
      return type ?? null;
    }

    case "BinaryExpression":
      return inferBinaryType(node as jsep.BinaryExpression, ctx, errors);

    case "UnaryExpression":
      return inferUnaryType(node as jsep.UnaryExpression, ctx, errors);

    case "ConditionalExpression": {
      // Ternary: condition ? consequent : alternate
      const cond = node as jsep.ConditionalExpression;
      const condType = inferType(cond.test, ctx, errors);
      if (condType !== "bool") {
        errors.push("Ternary condition must be boolean");
      }
      const consType = inferType(cond.consequent, ctx, errors);
      const altType = inferType(cond.alternate, ctx, errors);
      if (consType && altType && consType !== altType) {
        // Allow numeric promotion
        if (isNumeric(consType) && isNumeric(altType)) {
          return "float";
        }
        errors.push(`Ternary branches must have same type (got '${consType}' and '${altType}')`);
      }
      return consType;
    }

    case "MemberExpression": {
      // For now, we don't support member expressions in C code generation
      errors.push("Member expressions (e.g., obj.property) are not supported");
      return null;
    }

    case "CallExpression": {
      return inferCallType(node as jsep.CallExpression, ctx, errors);
    }

    default:
      errors.push(`Unsupported expression type: ${node.type}`);
      return null;
  }
}

/**
 * Infer the type of a literal value
 */
function inferLiteralType(node: jsep.Literal): DataType {
  const value = node.value;

  if (typeof value === "boolean") return "bool";

  if (typeof value === "number") {
    // Check if it's an integer or float
    return Number.isInteger(value) ? "int" : "float";
  }

  if (typeof value === "string") return "string";

  // null/undefined - default to int
  return "int";
}

/**
 * Infer the result type of a binary operation
 */
function inferBinaryType(node: jsep.BinaryExpression, ctx: TypeContext, errors: string[]): DataType | null {
  const leftType = inferType(node.left, ctx, errors);
  const rightType = inferType(node.right, ctx, errors);
  const op = node.operator;

  // If either operand failed to type, propagate null
  if (!leftType || !rightType) return null;

  // String concatenation: string + any → string. An image has no text form,
  // so it cannot be concatenated even though the other operand is a string.
  if (op === "+" && (leftType === "string" || rightType === "string")) {
    if (leftType === "image" || rightType === "image") {
      errors.push("An image value cannot be used in a string expression");
      return null;
    }
    return "string";
  }

  // Arithmetic operators: int/float → int/float (promote to float if either is float)
  if (["+", "-", "*", "/"].includes(op)) {
    if (!isNumeric(leftType) || !isNumeric(rightType)) {
      errors.push(`Operator '${op}' requires numeric operands (got '${leftType}' and '${rightType}')`);
      return null;
    }
    return leftType === "float" || rightType === "float" ? "float" : "int";
  }

  // Modulo: int only
  if (op === "%") {
    if (leftType !== "int" || rightType !== "int") {
      errors.push(`Operator '%' requires integer operands (got '${leftType}' and '${rightType}')`);
      return null;
    }
    return "int";
  }

  // Comparison operators: numeric → bool
  if (["<", ">", "<=", ">="].includes(op)) {
    if (!isNumeric(leftType) || !isNumeric(rightType)) {
      errors.push(`Operator '${op}' requires numeric operands (got '${leftType}' and '${rightType}')`);
    }
    return "bool";
  }

  // Equality operators: any → bool (but types should match)
  if (["==", "!="].includes(op)) {
    if (leftType !== rightType && !(isNumeric(leftType) && isNumeric(rightType))) {
      errors.push(`Comparing incompatible types: '${leftType}' and '${rightType}'`);
    }
    return "bool";
  }

  // Logical operators: bool → bool
  if (["&&", "||"].includes(op)) {
    if (leftType !== "bool" || rightType !== "bool") {
      errors.push(`Operator '${op}' requires boolean operands (got '${leftType}' and '${rightType}')`);
    }
    return "bool";
  }

  // Bitwise operators: int → int
  if (["&", "|", "^", "<<", ">>"].includes(op)) {
    if (leftType !== "int" || rightType !== "int") {
      errors.push(`Bitwise operator '${op}' requires integer operands (got '${leftType}' and '${rightType}')`);
      return null;
    }
    return "int";
  }

  errors.push(`Unknown operator: '${op}'`);
  return null;
}

/**
 * Infer the result type of a unary operation
 */
function inferUnaryType(node: jsep.UnaryExpression, ctx: TypeContext, errors: string[]): DataType | null {
  const argType = inferType(node.argument, ctx, errors);

  if (!argType) return null;

  // Logical NOT: bool → bool
  if (node.operator === "!") {
    if (argType !== "bool") {
      errors.push(`Logical NOT '!' requires boolean operand (got '${argType}')`);
    }
    return "bool";
  }

  // Unary plus/minus: numeric → same type
  if (node.operator === "-" || node.operator === "+") {
    if (!isNumeric(argType)) {
      errors.push(`Unary '${node.operator}' requires numeric operand (got '${argType}')`);
    }
    return argType;
  }

  // Bitwise NOT: int → int
  if (node.operator === "~") {
    if (argType !== "int") {
      errors.push(`Bitwise NOT '~' requires integer operand (got '${argType}')`);
    }
    return "int";
  }

  errors.push(`Unknown unary operator: '${node.operator}'`);
  return argType;
}

/** Cast functions: expression syntax uses int(), float(), bool(), str()
 * which the code generator translates to C casts / conversion calls.
 */
const CAST_FUNCTIONS: Record<string, DataType> = {
  int: "int",
  float: "float",
  bool: "bool",
  str: "string",
};

/**
 * Infer the result type of a cast function call, e.g. int(expr), str(expr).
 * Any type can be cast to any other type — it's the user's explicit intent.
 */
function inferCallType(node: jsep.CallExpression, ctx: TypeContext, errors: string[]): DataType | null {
  const callee = node.callee;
  if (callee.type !== "Identifier") {
    errors.push("Only cast functions are supported (int, float, bool, str)");
    return null;
  }

  const name = (callee as jsep.Identifier).name;
  const targetType = CAST_FUNCTIONS[name];
  if (!targetType) {
    errors.push(`Unknown function '${name}'. Available cast functions: int(), float(), bool(), str()`);
    return null;
  }

  if (node.arguments.length !== 1) {
    errors.push(`${name}() expects exactly 1 argument, got ${node.arguments.length}`);
    return null;
  }

  // Validate the argument expression (ensure it type-checks). Length checked as 1 above.
  inferType(node.arguments[0]!, ctx, errors);

  return targetType;
}

/**
 * Check if a type is numeric (int or float)
 */
function isNumeric(type: DataType | null): boolean {
  return type === "int" || type === "float";
}

/**
 * Check if a type can be implicitly converted to another.
 * - int ↔ float: both directions (truncation for float→int, common in embedded)
 * - any → string: allowed (format strings)
 * - bool is strict: requires explicit cast to/from bool
 */
function isCompatible(from: DataType, to: DataType): boolean {
  if (from === to) return true;
  if (isNumeric(from) && isNumeric(to)) return true;
  // An image is opaque binary with no text form; it is only compatible with an
  // image sink (handled by from === to above), never the string catch-all.
  if (from === "image") return false;
  if (to === "string") return true;
  return false;
}

/**
 * Wrap bare text in a string-type expression into quoted string literals for jsep.
 * Splits by variable placeholders (__varN__), quotes text segments, joins with +.
 * E.g. `hello __var0__` → `"hello " + __var0__`
 */
function wrapStringTemplate(expr: string): string {
  // Split by __varN__ placeholders but keep them as delimiters
  const parts = expr.split(/(__var\d+__)/);
  const segments: string[] = [];

  for (const part of parts) {
    if (/^__var\d+__$/.test(part)) {
      segments.push(part);
    } else if (part !== "") {
      const escaped = part.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      segments.push(`"${escaped}"`);
    }
  }

  return segments.join(" + ");
}
