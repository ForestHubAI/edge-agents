// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package memory manages the engine's local copy of an agent's declared
// memory files. The device filesystem is the sole source of truth: the
// manager owns a directory of <uid>.json records, reads them at boot, and
// writes through to disk on every successful mutation. Memory is
// device-storage-only — there is no remote mirror.
package memory

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/ForestHubAI/edge-agents/go/api/workflow"
)

// ErrFileNotFound is returned when the LLM references a memory file that
// isn't declared for this agent.
var ErrFileNotFound = errors.New("memory file not found")

// ErrEditNoMatch is returned by Edit when the supplied old_string isn't
// present in the file. The LLM is expected to recover by re-reading.
var ErrEditNoMatch = errors.New("memory edit: old_string not found in file")

// ErrSizeExceeded is returned when an append/edit would push the file
// past its declared maxSizeBytes cap.
var ErrSizeExceeded = errors.New("memory write would exceed max size")

// validName limits memory file names to a conservative identifier subset.
// The workflow editor produces well-formed names; this is defense in depth
// against a malicious workflow JSON trying to path-escape via the name.
var validName = regexp.MustCompile(`^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$`)

// Card is the metadata used to render an entry in the auto-injected memory
// index in the LLM agent's system prompt. Size is in bytes; the LLM treats
// it as a hint, not a hard contract.
type Card struct {
	UID         string
	Name        string
	Description string
	SizeBytes   int
}

// entry holds the runtime state of one memory file. Keyed by uid (stable);
// name changes on rename but uid does not.
type entry struct {
	name         string
	description  string
	content      string
	maxSizeBytes *int
}

// Manager is the engine-side memory subsystem. One instance per engine
// process. Files are keyed internally by uid (stable across renames); the
// LLM-facing tool layer resolves human names to uids via Card.
type Manager struct {
	dir   string
	mu    sync.Mutex
	files map[string]*entry // uid → entry
}

// NewManager constructs a manager whose durable copy lives in dir. The
// directory is created lazily on Reconcile.
func NewManager(dir string) *Manager {
	return &Manager{
		dir:   dir,
		files: make(map[string]*entry),
	}
}

// Reconcile converges the working copy to the files declared by the workflow.
// Called from Builder.Build at boot. The device filesystem wins: for each
// declared file an existing local copy is kept as-is (preserving the
// agent's accumulated edits from prior runs). Files with no local copy are
// seeded from the declared content carried in the workflow. Declared metadata
// (name, description, size cap) is always authoritative; only content is
// preserved across restarts. ctx is unused today, kept for a future device→cloud
// backup push.
func (m *Manager) Reconcile(_ context.Context, declared []workflow.MemoryFile) error {
	local, err := m.readLocal()
	if err != nil {
		return fmt.Errorf("memory: read local: %w", err)
	}

	if err := os.MkdirAll(m.dir, 0o755); err != nil {
		return fmt.Errorf("memory: create dir %s: %w", m.dir, err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.files = make(map[string]*entry, len(declared))
	for _, d := range declared {
		if !validName.MatchString(d.Label) {
			return fmt.Errorf("memory: invalid file name %q", d.Label)
		}
		// Content precedence: a local edit wins; otherwise the declared seed
		// from the workflow.
		content := d.Content
		if c, ok := local[d.Id]; ok {
			content = c
		}
		e := &entry{
			name:         d.Label,
			description:  d.Description,
			content:      content,
			maxSizeBytes: d.MaxSizeBytes,
		}
		m.files[d.Id] = e
		if err := m.persist(d.Id, e); err != nil {
			return fmt.Errorf("memory: write %s: %w", d.Label, err)
		}
	}
	return nil
}

// Card returns the metadata for the file identified by uid. Tool builders
// use this to translate refs into LLM-facing enums and index cards.
func (m *Manager) Card(uid string) (Card, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.files[uid]
	if !ok {
		return Card{}, fmt.Errorf("%w: %s", ErrFileNotFound, uid)
	}
	return Card{
		UID:         uid,
		Name:        e.name,
		Description: e.description,
		SizeBytes:   len(e.content),
	}, nil
}

// Read returns the current content of the file identified by uid.
func (m *Manager) Read(uid string) (string, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	e, ok := m.files[uid]
	if !ok {
		return "", fmt.Errorf("%w: %s", ErrFileNotFound, uid)
	}
	return e.content, nil
}

// Append concatenates content to the file identified by uid, persists it
// locally, and mirrors the new full content best-effort. Returns
// ErrSizeExceeded if the result would exceed the declared cap.
func (m *Manager) Append(ctx context.Context, uid, content string) error {
	return m.write(ctx, uid, func(cur string) (string, error) {
		return cur + content, nil
	})
}

// Edit performs a single find/replace against the file identified by uid.
// Returns ErrEditNoMatch if oldStr isn't present. First match only,
// matching Claude Code's Edit semantics.
func (m *Manager) Edit(ctx context.Context, uid, oldStr, newStr string) error {
	if oldStr == "" {
		return fmt.Errorf("memory edit: old_string must not be empty")
	}
	return m.write(ctx, uid, func(cur string) (string, error) {
		before, after, ok := strings.Cut(cur, oldStr)
		if !ok {
			return "", ErrEditNoMatch
		}
		return before + newStr + after, nil
	})
}

// write is the shared mutation path: lock, transform, size-check, persist
// locally, commit in-memory. The device write is the source of truth — if it
// fails the mutation fails and nothing is committed. ctx is unused today,
// kept for a future device→cloud backup push.
func (m *Manager) write(_ context.Context, uid string, transform func(string) (string, error)) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	e, ok := m.files[uid]
	if !ok {
		return fmt.Errorf("%w: %s", ErrFileNotFound, uid)
	}
	next, err := transform(e.content)
	if err != nil {
		return err
	}
	if e.maxSizeBytes != nil && len(next) > *e.maxSizeBytes {
		return ErrSizeExceeded
	}
	committed := e.content
	e.content = next
	if err := m.persist(uid, e); err != nil {
		e.content = committed // roll back in-memory on local write failure
		return fmt.Errorf("memory: local write %s: %w", e.name, err)
	}
	return nil
}

// UIDs returns every declared memory file's uid. Used by ValidateRefs to
// detect refs that don't match any current declaration.
func (m *Manager) UIDs() []string {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]string, 0, len(m.files))
	for k := range m.files {
		out = append(out, k)
	}
	return out
}

// readLocal loads every <uid>.json record from the durable directory. A
// missing dir is "no local copy yet" (cold start), not an error.
func (m *Manager) readLocal() (map[string]string, error) {
	entries, err := os.ReadDir(m.dir)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	out := make(map[string]string)
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".json" {
			continue
		}
		b, err := os.ReadFile(filepath.Join(m.dir, e.Name()))
		if err != nil {
			return nil, err
		}
		var mf workflow.MemoryFile
		if err := json.Unmarshal(b, &mf); err != nil {
			return nil, err
		}
		out[mf.Id] = mf.Content
	}
	return out, nil
}

// persist writes one entry to its <uid>.json record. The full record is
// stored so the working copy is self-describing and can be read back at
// boot without a remote. Caller holds m.mu.
func (m *Manager) persist(uid string, e *entry) error {
	mf := workflow.MemoryFile{
		Id:           uid,
		Label:        e.name,
		Description:  e.description,
		Content:      e.content,
		MaxSizeBytes: e.maxSizeBytes,
		Type:         workflow.MemoryFileTypeMemoryFile,
	}
	b, err := json.Marshal(mf)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(m.dir, uid+".json"), b, 0o644)
}
