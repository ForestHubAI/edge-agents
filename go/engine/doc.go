// Package engine is the ForestHub workflow runtime.
//
// SCAFFOLD ONLY. The engine + llmproxy source is migrated here from
// fh-backend in the sequenced order we agreed:
//
//  1. interface refactor in fh-backend (MemoryStore / Retriever / LogSink /
//     ControlPlane) — proven under fh-backend's existing tests, IN PLACE.
//  2. repoint type usage onto github.com/ForestHubAI/forge/go/contract.
//  3. only then: history-preserving move of the code into this package.
//
// The engine depends on ./../contract for wire types and on its own
// capability interfaces — never on a concrete fh-backend HTTP client. The
// closed fh-backend becomes one implementation of those interfaces and
// imports this package as a library (e.g. to run a workflow for local
// debug) without an import cycle.
package engine
