import { promises as fs } from "node:fs";
import path from "node:path";
import { CURRENT_SCHEMA_VERSION, migrate, readSchemaVersion } from "@foresthubai/workflow-core/migration";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";

/**
 * `fh-workflow update <file.json> [out.json]`
 *
 * Migrates a workflow document up to the current schema version, writing the
 * result in place or to a second path. A no-op when the file is already current
 * and no output path is given.
 */
export async function updateCommand(filePath?: string, outPath?: string): Promise<void> {
  if (!filePath) {
    process.stderr.write("Usage: fh-workflow update <file.json> [out.json]\n");
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), filePath);
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      process.stderr.write(`File not found: ${abs}\n`);
      process.exit(1);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  let migrated: ApiWorkflow;
  try {
    migrated = migrate(parsed);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const from = readSchemaVersion(parsed as Record<string, unknown>);
  const dest = outPath ? path.resolve(process.cwd(), outPath) : abs;

  if (from === CURRENT_SCHEMA_VERSION && dest === abs) {
    process.stdout.write(`✓ ${abs}: already at schemaVersion ${CURRENT_SCHEMA_VERSION}\n`);
    return;
  }

  await fs.writeFile(dest, JSON.stringify(migrated, null, 2) + "\n", "utf-8");
  const where = dest === abs ? "" : ` → ${dest}`;
  process.stdout.write(`✓ ${abs}: schemaVersion ${from} → ${CURRENT_SCHEMA_VERSION}${where}\n`);
}
