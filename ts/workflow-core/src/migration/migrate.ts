import type { ApiWorkflow } from "../workflow/Workflow";
import { MIGRATIONS, type Migration } from "./migrations";
import { BASELINE_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION } from "./version";

/**
 * Index the registry by `from` and assert it forms a contiguous chain over
 * [BASELINE_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION). A gap or duplicate is a
 * programming error, so it throws at module load rather than on first use.
 */
function buildChain(migrations: readonly Migration[]): ReadonlyMap<number, Migration> {
  const byFrom = new Map<number, Migration>();
  for (const m of migrations) {
    if (!Number.isInteger(m.from) || m.from < BASELINE_SCHEMA_VERSION || m.from >= CURRENT_SCHEMA_VERSION) {
      throw new Error(`[migration] from must be an integer in [${BASELINE_SCHEMA_VERSION}, ${CURRENT_SCHEMA_VERSION}), got ${m.from}`);
    }
    if (byFrom.has(m.from)) {
      throw new Error(`[migration] duplicate migration from ${m.from}`);
    }
    byFrom.set(m.from, m);
  }
  for (let v = BASELINE_SCHEMA_VERSION; v < CURRENT_SCHEMA_VERSION; v++) {
    if (!byFrom.has(v)) throw new Error(`[migration] missing migration from ${v} -> ${v + 1}`);
  }
  return byFrom;
}

const CHAIN = buildChain(MIGRATIONS);

/** Read the schema version, defaulting absent/invalid to the baseline. */
export function readSchemaVersion(doc: Record<string, unknown>): number {
  const v = doc.schemaVersion;
  return typeof v === "number" && Number.isInteger(v) && v >= BASELINE_SCHEMA_VERSION ? v : BASELINE_SCHEMA_VERSION;
}

/**
 * Upgrade a raw, parsed workflow document to CURRENT_SCHEMA_VERSION and return
 * it as the current {@link ApiWorkflow}, ready for `deserialize`. Runs on
 * untyped JSON so each migration stays pinned to the shape it was written for.
 * Throws on a non-object, or a version newer than this build supports.
 */
export function migrate(raw: unknown): ApiWorkflow {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("[migration] workflow document must be a JSON object");
  }
  let doc: Record<string, unknown> = { ...(raw as Record<string, unknown>) };

  const version = readSchemaVersion(doc);
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new Error(`[migration] schemaVersion ${version} is newer than this build supports (${CURRENT_SCHEMA_VERSION})`);
  }

  for (let v = version; v < CURRENT_SCHEMA_VERSION; v++) {
    doc = CHAIN.get(v)!.migrate(doc); // non-null: buildChain covers every v in range
  }

  doc.schemaVersion = CURRENT_SCHEMA_VERSION;
  return doc as ApiWorkflow;
}
