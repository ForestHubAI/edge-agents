// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package linkedmap

// LinkedMap is a map that preserves insertion order of keys.
type LinkedMap[K comparable, V any] struct {
	keys   []K
	values map[K]V
}

// New returns an empty LinkedMap
func New[K comparable, V any]() *LinkedMap[K, V] {
	return &LinkedMap[K, V]{
		keys:   make([]K, 0),
		values: make(map[K]V),
	}
}

// Set adds or updates a key/value pair.
// If the key is new, it preserves insertion order.
func (m *LinkedMap[K, V]) Set(key K, value V) {
	if _, exists := m.values[key]; !exists {
		m.keys = append(m.keys, key)
	}
	m.values[key] = value
}

// Get returns a value and a boolean if found
func (m *LinkedMap[K, V]) Get(key K) (V, bool) {
	val, ok := m.values[key]
	return val, ok
}

// Keys returns keys in insertion order. A copy of the keys slice is returned to prevent external modification.
func (m *LinkedMap[K, V]) Keys() []K {
	return append([]K(nil), m.keys...)
}

// Values returns values in insertion order
func (m *LinkedMap[K, V]) Values() []V {
	out := make([]V, 0, len(m.keys))
	for _, k := range m.keys {
		out = append(out, m.values[k])
	}
	return out
}

// Entries returns slice of key/value pairs in insertion order
func (m *LinkedMap[K, V]) Entries() []struct {
	Key   K
	Value V
} {
	entries := make([]struct {
		Key   K
		Value V
	}, 0, len(m.keys))
	for _, k := range m.keys {
		entries = append(entries, struct {
			Key   K
			Value V
		}{k, m.values[k]})
	}
	return entries
}

// Range iterates over entries in insertion order
func (m *LinkedMap[K, V]) Range(fn func(K, V)) {
	for _, k := range m.keys {
		fn(k, m.values[k])
	}
}

// Len returns number of entries
func (m *LinkedMap[K, V]) Len() int {
	return len(m.keys)
}
