// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

/**
 * Persisted-format version this build reads and writes. A plain monotonic
 * integer, decoupled from the contract/package semver. Bump only when the
 * serialized {@link ApiWorkflow} shape changes, adding a matching migration.
 */
export const CURRENT_SCHEMA_VERSION = 1;

/** Version assumed for documents that carry no `schemaVersion`. */
export const BASELINE_SCHEMA_VERSION = 1;
