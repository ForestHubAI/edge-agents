// Package memory manages the engine's local working copy of an agent's
// declared memory files. A configured store holds the durable copy; this
// manager pulls a snapshot at boot, exposes read/append/edit operations
// to LLM agent nodes, and pushes every successful write back through the
// store synchronously. Sync-on-write keeps the durable copy ahead of
// in-memory state in case the engine process is killed without graceful
// shutdown.
package memory

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"

	"github.com/ForestHubAI/fh-core/go/engine"
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
	store engine.MemoryStore
	mu    sync.Mutex
	files map[string]*entry // uid → entry
}

// NewManager constructs a manager that writes its working copy into dir
// and syncs through the given store. The directory is created lazily on
// Restore.
func NewManager(dir string, store engine.MemoryStore) *Manager {
	return &Manager{
		dir:   dir,
		store: store,
		files: make(map[string]*entry),
	}
}

// Restore pulls the full memory snapshot from the store and overwrites
// the local working copy. Called from Builder.Build, so each deploy
// refreshes state (covers boot AND post-rename redeploy).
func (m *Manager) Restore(ctx context.Context) error {
	if m.store == nil {
		// No store configured (local dev / debug). Treat as "no memory".
		m.mu.Lock()
		m.files = make(map[string]*entry)
		m.mu.Unlock()
		return nil
	}
	snapshot, err := m.store.Snapshot(ctx)
	if err != nil {
		return fmt.Errorf("memory: restore: %w", err)
	}

	if err := os.MkdirAll(m.dir, 0o755); err != nil {
		return fmt.Errorf("memory: create dir %s: %w", m.dir, err)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	m.files = make(map[string]*entry, len(snapshot))
	for _, f := range snapshot {
		if !validName.MatchString(f.Label) {
			return fmt.Errorf("memory: invalid file name %q", f.Label)
		}
		m.files[f.Id] = &entry{
			name:         f.Label,
			description:  f.Description,
			content:      f.Content,
			maxSizeBytes: f.MaxSizeBytes,
		}
		if err := os.WriteFile(m.filePath(f.Label), []byte(f.Content), 0o644); err != nil {
			return fmt.Errorf("memory: write %s: %w", f.Label, err)
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

// Append concatenates content to the file identified by uid, persists
// locally, and pushes the new full content through the store. Returns
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

// write is the shared mutation path: lock, transform, size-check, push to
// store, commit local state. Store push happens inside the lock so a
// failed remote write doesn't leave the in-memory copy ahead of the
// durable one.
func (m *Manager) write(ctx context.Context, uid string, transform func(string) (string, error)) error {
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
	if m.store != nil {
		if err := m.store.Upsert(ctx, uid, next); err != nil {
			return fmt.Errorf("memory: push %s: %w", uid, err)
		}
	}
	if err := os.WriteFile(m.filePath(e.name), []byte(next), 0o644); err != nil {
		return fmt.Errorf("memory: local write %s: %w", e.name, err)
	}
	e.content = next
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

func (m *Manager) filePath(name string) string {
	return filepath.Join(m.dir, name+".md")
}
