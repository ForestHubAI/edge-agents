// Copyright 2025 The NLP Odyssey Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Package schemautil provides utilities for generating and manipulating JSON schemas with OpenAI's constraints.
package schemautil

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"reflect"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/invopop/jsonschema"
)

// ErrAdditionalProperties is returned when additionalProperties is set for object types.
var ErrAdditionalProperties = errors.New("additionalProperties not allowed for object types")

// ToStrictJSONSchema generates a strict JSON schema for the given type T.
func ToStrictJSONSchema[T any]() (map[string]any, error) {
	reflector := &jsonschema.Reflector{
		ExpandedStruct:             true,  // Inline embedded structs instead of using $ref for them.
		RequiredFromJSONSchemaTags: false, // Do not use the "required" JSON Schema tag to determine required fields.
		AllowAdditionalProperties:  false, // Sets additionalProperties: false on all objects.
	}

	var zero T
	t := reflect.TypeOf(zero)
	if t.Kind() != reflect.Struct {
		return nil, fmt.Errorf("type must be struct for JSON schema generation, got '%s'", t.Kind().String())
	}
	if t.Name() == "" && t.NumField() == 0 {
		// Avoid panic in jsonschema when reflecting on anonymous empty struct
		return newEmptyJSONSchema(), nil
	}
	// Reflect and marshal to bytes
	s := reflector.Reflect(&zero)
	b, err := json.Marshal(s)
	if err != nil {
		return nil, err
	}
	// Unmarshal back to map[string]any
	var schema map[string]any
	err = json.Unmarshal(b, &schema)
	if err != nil {
		return nil, err
	}
	// Ensure OpenAI schema constraints
	return EnsureStrictness(schema)
}

func newEmptyJSONSchema() map[string]any {
	return map[string]any{
		"type":                 "object",
		"additionalProperties": false,
		"properties":           map[string]any{},
		"required":             []string{},
	}
}

// StrictObject builds a strict JSON object schema from the given properties.
// All properties are marked required and additionalProperties is disallowed,
// matching the constraints OpenAI structured outputs / tool calling expects.
// Use this when the property set is known only at runtime; for static Go
// types prefer ToStrictJSONSchema.
func StrictObject(properties map[string]any) map[string]any {
	required := make([]string, 0, len(properties))
	for k := range properties {
		required = append(required, k)
	}
	sort.Strings(required)
	return map[string]any{
		"type":                 "object",
		"properties":           properties,
		"required":             required,
		"additionalProperties": false,
	}
}

// EnsureStrictness mutates the given JSON schema to ensure it conforms
// to the `strict` standard that the OpenAI API expects for function/tool calling.
//
// This function enforces the following rules recursively throughout the schema:
//
//  1. Objects (`type: "object"`):
//     - Ensures `additionalProperties: false` is set, disallowing extra fields.
//     - Ensures all defined properties are listed in the `required` array.
//     - Recursively applies strictness to all properties.
//
//  2. Arrays (`type: "array"`):
//     - Recursively applies strictness to the `items` schema.
//
//  3. Unions (`anyOf`):
//     - Converts `oneOf` to `anyOf` as OpenAI does not support `oneOf`, see
//     https://community.openai.com/t/oneof-allof-usage-has-problems-with-strict-mode/966047
//     - Recursively applies strictness to each variant.
//
//  4. Intersections (`allOf`):
//     - If only one variant, inlines it into the parent schema.
//     - Otherwise, recursively applies strictness to each variant.
//
//  5. Definitions (`$defs` or `definitions`):
//     - Recursively applies strictness to all subschemas in definitions.
//
//  6. `$ref` handling:
//     - If a schema contains a `$ref` **and** other properties, the `$ref` is "unraveled":
//     - The referenced schema is resolved and merged in, with local properties taking precedence.
//     - The `$ref` key is removed.
//     - The merged schema is recursively made strict.
//     - If a schema is just `{"$ref": ...}` (no other keys), it is left as-is.
//
//  7. Defaults:
//     - Removes `default: null` as it has no meaningful distinction for OpenAI.
//
//  8. Defensive fallback:
//     - If the schema is empty, returns a minimal empty object schema.
//
// This ensures the resulting schema is as strict and explicit as possible, matching OpenAI's requirements
// (see https://platform.openai.com/docs/guides/structured-outputs?type-restrictions=number-restrictions).
//
// Returns the strictified schema or an error if the schema cannot be made strict.
func EnsureStrictness(schema map[string]any) (map[string]any, error) {
	if len(schema) == 0 {
		return newEmptyJSONSchema(), nil
	}
	return ensureStrictness(schema, nil, schema)
}

func ensureStrictness(rawJSONSchema any, path []string, root map[string]any) (map[string]any, error) {
	jsonSchema, ok := rawJSONSchema.(map[string]any)
	if !ok {
		return nil, fmt.Errorf("expected %#v to be a map[string]any, path=%+v", rawJSONSchema, path)
	}

	for _, defKey := range []string{"$defs", "definitions"} {
		if defs, ok := jsonSchema[defKey].(map[string]any); ok {
			for defName, defSchema := range defs {
				_, err := ensureStrictness(defSchema, slices.Concat(path, []string{defKey, defName}), root)
				if err != nil {
					return nil, err
				}
			}
		}
	}

	additionalProperties, hasAdditionalProperties := jsonSchema["additionalProperties"]

	if typ, _ := jsonSchema["type"].(string); typ == "object" {
		if !hasAdditionalProperties {
			jsonSchema["additionalProperties"] = false
		} else if additionalProperties != false && !reflect.DeepEqual(additionalProperties, map[string]any{"not": map[string]any{}}) {
			return nil, ErrAdditionalProperties
		}
	}

	// object types
	// { 'type': 'object', 'properties': { 'a':  {...} } }
	if properties, ok := jsonSchema["properties"].(map[string]any); ok {
		keys := slices.Collect(maps.Keys(properties))
		sort.Strings(keys) // Sort for deterministic results, especially in tests

		// For consistency, prefer []any to []string and empty slice over nil
		required := make([]any, len(keys))
		for i, k := range keys {
			required[i] = k
		}
		jsonSchema["required"] = required

		newProperties := make(map[string]any, len(properties))
		for key, propSchema := range properties {
			var err error
			newProperties[key], err = ensureStrictness(propSchema, slices.Concat(path, []string{"properties", key}), root)
			if err != nil {
				return nil, err
			}
		}
		jsonSchema["properties"] = newProperties
	}

	//arrays
	// { 'type': 'array', 'items': {...} }
	if items, ok := jsonSchema["items"].(map[string]any); ok {
		var err error
		jsonSchema["items"], err = ensureStrictness(items, slices.Concat(path, []string{"items"}), root)
		if err != nil {
			return nil, err
		}
	}

	// unions (oneOf) - OpenAI doesn't support oneOf, convert to anyOf
	if oneOf, ok := jsonSchema["oneOf"]; ok {
		delete(jsonSchema, "oneOf")
		jsonSchema["anyOf"] = oneOf
	}

	// unions (anyOf)
	if anyOf, ok := jsonSchema["anyOf"].([]any); ok {
		newAnyOf := make([]any, len(anyOf))
		for i, variant := range anyOf {
			var err error
			newAnyOf[i], err = ensureStrictness(variant, slices.Concat(path, []string{"anyOf", strconv.FormatInt(int64(i), 10)}), root)
			if err != nil {
				return nil, err
			}
		}
		jsonSchema["anyOf"] = newAnyOf
	}

	// intersections
	if allOf, ok := jsonSchema["allOf"].([]any); ok {
		if len(allOf) == 1 {
			result, err := ensureStrictness(allOf[0], slices.Concat(path, []string{"allOf", "0"}), root)
			if err != nil {
				return nil, err
			}
			delete(jsonSchema, "allOf")
			maps.Copy(jsonSchema, result)
		} else {
			newAllOf := make([]any, len(allOf))
			for i, variant := range allOf {
				var err error
				newAllOf[i], err = ensureStrictness(variant, slices.Concat(path, []string{"allOf", strconv.FormatInt(int64(i), 10)}), root)
				if err != nil {
					return nil, err
				}
			}
			jsonSchema["allOf"] = newAllOf
		}
	}

	// strip `nil` defaults as there's no meaningful distinction here
	// the schema will still be `nullable` and the model will default
	// to using `nil` anyway
	if d, ok := jsonSchema["default"]; ok && d == nil {
		delete(jsonSchema, "default")
	}

	// we can't use `$ref`s if there are other properties defined, e.g.
	// `{"$ref": "...", "description": "my description"}`
	// so we unravel the ref
	// `{"type": "string", "description": "my description"}`
	if rawRef, ok := jsonSchema["$ref"]; ok && len(jsonSchema) > 1 {
		ref, ok := rawRef.(string)
		if !ok {
			return nil, fmt.Errorf("received non-string $ref: %#v", rawRef)
		}
		resolved, err := resolveJONSchemaRef(root, ref)
		if err != nil {
			return nil, err
		}

		delete(jsonSchema, "$ref")
		// properties from the json schema take priority over the ones on the `$ref`
		for k, v := range resolved {
			if _, ok := jsonSchema[k]; !ok {
				jsonSchema[k] = v
			}
		}
		// Since the schema expanded from `$ref` might not have `additionalProperties: false` applied
		// we call `ensureStrictJSONSchema` again to fix the inlined schema and ensure it's valid
		return ensureStrictness(jsonSchema, path, root)
	}

	return jsonSchema, nil
}

func resolveJONSchemaRef(root map[string]any, ref string) (map[string]any, error) {
	if !strings.HasPrefix(ref, "#/") {
		return nil, fmt.Errorf("unexpected $ref format: expected `#/` prefix in $ref value %q", ref)
	}

	path := strings.Split(ref[2:], "/")
	resolved := root

	for _, key := range path {
		var ok bool
		resolved, ok = resolved[key].(map[string]any)
		if !ok {
			return nil, fmt.Errorf("encountered non-dictionary entry while resolving $ref %q: %#v", ref, resolved)
		}
	}

	return resolved, nil
}
