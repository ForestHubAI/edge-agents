# Expression Code Generation Reference

Expressions use `${}` placeholders for variable references and support C-style operators.
The frontend validates types; the backend must emit valid C/C++ code.

## Implicit Type Conversions

These are allowed without cast functions and should be handled transparently in codegen:

| From | To | C codegen |
|---|---|---|
| `int` | `float` | implicit (C handles it) |
| `float` | `int` | `(int)value` (truncation) |
| any | `string` | `sprintf(buf, format, value)` — format by source type: `%d` (int), `%f` (float), `%s` (string), `%d` with `(int)value` (bool) |

`bool` is strict — no implicit conversion to/from `bool`.

## Cast Functions

The frontend expression syntax uses function-call notation. The backend must translate these to valid C.

| Expression syntax | C output | Notes |
|---|---|---|
| `int(expr)` | `(int)(expr)` | Works for float, bool |
| `int(stringExpr)` | `atoi(expr)` | String to int |
| `float(expr)` | `(float)(expr)` | Works for int, bool |
| `float(stringExpr)` | `atof(expr)` | String to float |
| `bool(expr)` | `(bool)(expr)` | Numeric: 0 = false, nonzero = true |
| `bool(stringExpr)` | Implementation-defined | e.g. `strcmp(expr, "true") == 0` or `atoi(expr) != 0` |
| `str(expr)` | `sprintf(buf, format, expr)` | Format by source type (see above) |

## Operators

Standard C operators are supported. Type rules enforced by the frontend:

- **Arithmetic** (`+`, `-`, `*`, `/`): numeric operands, result promoted to `float` if either operand is `float`
- **Modulo** (`%`): `int` operands only, result `int`
- **Comparison** (`<`, `>`, `<=`, `>=`): numeric operands, result `bool`
- **Equality** (`==`, `!=`): same-type operands (numeric types can mix), result `bool`
- **Logical** (`&&`, `||`): `bool` operands only, result `bool`
- **Bitwise** (`&`, `|`, `^`, `<<`, `>>`): `int` operands only, result `int`
- **Unary** (`!`): `bool` only. (`-`, `+`): numeric only. (`~`): `int` only.
- **String concatenation** (`+`): if either operand is `string`, result is `string` (emit `sprintf`/`strcat`)
- **Ternary** (`? :`): condition must be `bool`, branches must match types (numeric promotion allowed)
