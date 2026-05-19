package schemautil

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type SimpleStruct struct {
	Name string `json:"name"`
	Age  int    `json:"age"`
}

type NestedStruct struct {
	User   SimpleStruct `json:"user"`
	Active bool         `json:"active"`
}

func TestToStrictJSONSchema(t *testing.T) {
	t.Run("simple struct", func(t *testing.T) {
		schema, err := ToStrictJSONSchema[SimpleStruct]()
		require.NoError(t, err)
		assert.Equal(t, "object", schema["type"])
		props, ok := schema["properties"].(map[string]any)
		assert.True(t, ok)
		assert.Contains(t, props, "name")
		assert.Contains(t, props, "age")
		required, ok := schema["required"].([]any)
		require.True(t, ok)
		assert.ElementsMatch(t, []any{"name", "age"}, required)
	})

	t.Run("nested struct", func(t *testing.T) {
		schema, err := ToStrictJSONSchema[NestedStruct]()
		require.NoError(t, err)
		assert.Equal(t, "object", schema["type"])
		props, ok := schema["properties"].(map[string]any)
		assert.True(t, ok)
		assert.Contains(t, props, "user")
		assert.Contains(t, props, "active")
		// Check required fields at top level
		required, ok := schema["required"].([]any)
		require.True(t, ok)
		assert.ElementsMatch(t, []any{"user", "active"}, required)
		// Check nested user struct $ref
		require.Contains(t, props["user"], "$ref")
		assert.Equal(t, "#/$defs/SimpleStruct", props["user"].(map[string]any)["$ref"])
		// Check $defs contains SimpleStruct with correct required
		defs, ok := schema["$defs"].(map[string]any)
		require.True(t, ok)
		simpleStructDef, ok := defs["SimpleStruct"].(map[string]any)
		require.True(t, ok)
		nestedRequired, ok := simpleStructDef["required"].([]any)
		require.True(t, ok)
		assert.ElementsMatch(t, []any{"name", "age"}, nestedRequired)
	})

	t.Run("anonymous empty struct", func(t *testing.T) {
		schema, err := ToStrictJSONSchema[struct{}]()
		require.NoError(t, err)
		assert.Equal(t, "object", schema["type"])
		props, ok := schema["properties"].(map[string]any)
		assert.True(t, ok)
		assert.Empty(t, props)
	})

	t.Run("anonymous inner struct", func(t *testing.T) {
		type Outer struct {
			Inner struct {
				Foo string `json:"foo"`
				Bar int    `json:"bar"`
			} `json:"inner"`
		}
		schema, err := ToStrictJSONSchema[Outer]()
		require.NoError(t, err)
		assert.Equal(t, "object", schema["type"])
		props, ok := schema["properties"].(map[string]any)
		assert.True(t, ok)
		assert.Contains(t, props, "inner")
		innerProps, ok := props["inner"].(map[string]any)
		assert.True(t, ok)
		assert.Equal(t, "object", innerProps["type"])
		innerFields, ok := innerProps["properties"].(map[string]any)
		assert.True(t, ok)
		assert.Contains(t, innerFields, "foo")
		assert.Contains(t, innerFields, "bar")
	})

	t.Run("int type fails", func(t *testing.T) {
		_, err := ToStrictJSONSchema[int]()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "type must be struct")
	})

	t.Run("string type fails", func(t *testing.T) {
		_, err := ToStrictJSONSchema[string]()
		assert.Error(t, err)
		assert.Contains(t, err.Error(), "type must be struct")
	})

	t.Run("additional properties on struct fails", func(t *testing.T) {
		type S struct {
			Foo map[string]string `json:"foo"`
		}
		_, err := ToStrictJSONSchema[S]()
		assert.ErrorIs(t, err, ErrAdditionalProperties)
	})

	t.Run("struct with field default null is removed", func(t *testing.T) {
		type S struct {
			Foo *string `json:"foo" default:"null"`
		}
		schema, err := ToStrictJSONSchema[S]()
		require.NoError(t, err)
		props, ok := schema["properties"].(map[string]any)
		assert.True(t, ok)
		foo, ok := props["foo"].(map[string]any)
		assert.True(t, ok)
		_, hasDefault := foo["default"]
		assert.False(t, hasDefault)
	})
	t.Run("oneOf is converted to anyOf", func(t *testing.T) {
		schema := map[string]any{
			"oneOf": []any{
				map[string]any{"type": "string"},
				map[string]any{"type": "integer"},
			},
		}
		result, err := EnsureStrictness(schema)
		require.NoError(t, err)
		assert.NotContains(t, result, "oneOf")
		assert.Contains(t, result, "anyOf")
		anyOf, ok := result["anyOf"].([]any)
		require.True(t, ok)
		assert.Len(t, anyOf, 2)
	})

	t.Run("oneOf with nested objects applies strictness", func(t *testing.T) {
		schema := map[string]any{
			"oneOf": []any{
				map[string]any{
					"type": "object",
					"properties": map[string]any{
						"name": map[string]any{"type": "string"},
					},
				},
				map[string]any{"type": "null"},
			},
		}
		result, err := EnsureStrictness(schema)
		require.NoError(t, err)
		assert.NotContains(t, result, "oneOf")
		anyOf, ok := result["anyOf"].([]any)
		require.True(t, ok)
		// Check that the object variant has additionalProperties: false and required
		objVariant := anyOf[0].(map[string]any)
		assert.Equal(t, false, objVariant["additionalProperties"])
		required, ok := objVariant["required"].([]any)
		require.True(t, ok)
		assert.ElementsMatch(t, []any{"name"}, required)
	})

	t.Run("existing anyOf is preserved", func(t *testing.T) {
		schema := map[string]any{
			"anyOf": []any{
				map[string]any{"type": "string"},
				map[string]any{"type": "number"},
			},
		}
		result, err := EnsureStrictness(schema)
		require.NoError(t, err)
		assert.Contains(t, result, "anyOf")
		anyOf, ok := result["anyOf"].([]any)
		require.True(t, ok)
		assert.Len(t, anyOf, 2)
	})
}
