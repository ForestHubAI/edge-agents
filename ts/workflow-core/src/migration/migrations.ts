/**
 * A single-step upgrade of the persisted workflow format, from `from` to
 * `from + 1`. Operates on the raw parsed document, never the domain types.
 * Forward-only: there is no down-path.
 *
 * A shipped migration is immutable — saved files depend on its exact behaviour.
 * Express the next change as a new migration, never an edit to an old one.
 */
export interface Migration {
  /** Schema version this migration expects as input. Produces `from + 1`. */
  readonly from: number;
  /** Pure transform on the raw document; must not mutate its input. */
  migrate(doc: Record<string, unknown>): Record<string, unknown>;
}

/**
 * Ordered registry of single-step format migrations. To change the format:
 * bump CURRENT_SCHEMA_VERSION, append one migration with `from` set to the
 * previous value, and reconcile serialize/deserialize. {@link migrate} asserts
 * at load that the chain is contiguous over [BASELINE, CURRENT).
 */
export const MIGRATIONS: readonly Migration[] = [
  // First entry will be `{ from: 1, migrate: (doc) => ... }`.
];
