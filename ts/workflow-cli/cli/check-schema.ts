import { existsSync, readFileSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import addFormats from "ajv-formats";
import yaml from "js-yaml";

// The installed CLI bundle ships the contract as a sibling `workflow.yaml`
// (copied in by build-cli.mjs); prefer it. In-repo (tsx) that sibling doesn't
// exist, so fall back to the contract in the source tree: cli -> app -> ts ->
// repo root, then into contract/.
const here = path.dirname(fileURLToPath(import.meta.url));
const bundledContract = path.join(here, "workflow.yaml");
const CONTRACT_PATH = existsSync(bundledContract)
  ? bundledContract
  : path.resolve(here, "../../../contract/workflow.yaml");

function loadContractDocument(): Record<string, unknown> {
  return yaml.load(readFileSync(CONTRACT_PATH, "utf-8")) as Record<string, unknown>;
}

// Normalises the two OpenAPI 3.0 constructs Ajv can't consume directly, everywhere
// they occur in the tree. Schema-agnostic: it reshapes keywords, never named schemas.
//   1. `nullable: true`        -> JSON Schema `type: [..., "null"]`
//   2. `discriminator.mapping` -> dropped (Ajv supports only `propertyName`; the
//      variant is selected from each branch's `type` tag, so mapping is redundant).
function openApiToJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(openApiToJsonSchema);
  if (value === null || typeof value !== "object") return value;

  const node = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node)) {
    if (key === "nullable") continue; // dropped; folded into `type` below
    out[key] = openApiToJsonSchema(child);
  }

  if (node.nullable === true) {
    const t = out.type;
    if (typeof t === "string") out.type = [t, "null"];
    else if (Array.isArray(t) && !t.includes("null")) out.type = [...t, "null"];
  }

  const disc = out.discriminator;
  if (disc !== null && typeof disc === "object") {
    delete (disc as Record<string, unknown>).mapping;
  }

  return out;
}

// Compiled lazily and memoised — the contract is read and Ajv set up once per process.
let cachedValidator: ValidateFunction | undefined;

/**
 * Compiles a validator for the `Workflow` schema straight from `contract/workflow.yaml`.
 *
 * `discriminator: true` applies to every `oneOf`+`discriminator` union in the
 * contract (Node, Channel, Memory, Model): Ajv reads the variant's `type` tag and
 * checks only that branch, yielding a precise error instead of "matched 0 of N
 * schemas". `strict: false` tolerates the OpenAPI-only keywords we don't transform
 * away (e.g. `discriminator.mapping`, `description`).
 */
export function compileWorkflowValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;

  const contract = openApiToJsonSchema(loadContractDocument()) as Record<string, unknown>;
  contract.$id = "workflow-contract"; // gives internal #/components/... refs a base to resolve against

  const ajv = new Ajv({ discriminator: true, strict: false, allErrors: true });
  addFormats(ajv); // teaches Ajv the OpenAPI formats (int32, int64, date-time, ...) so they're truly checked
  ajv.addSchema(contract);

  cachedValidator = ajv.compile({ $ref: "workflow-contract#/components/schemas/Workflow" });
  return cachedValidator;
}

export interface SchemaCheckResult {
  ok: boolean;
  errors: ErrorObject[];
}

/**
 * Structurally validates a parsed workflow object against the contract. Side-effect
 * free (no I/O, no process.exit) so it can be unit-tested directly; the CLI wrapper
 * below adds file reading and exit codes.
 */
export function validateAgainstContract(data: unknown): SchemaCheckResult {
  const validate = compileWorkflowValidator();
  const ok = validate(data);
  return { ok, errors: ok ? [] : (validate.errors ?? []) };
}

/**
 * `fh-workflow check-schema <file.json>`
 *
 * Structural gate: checks the raw JSON against the contract before the semantic
 * `validate` command runs. Reads the file relative to cwd, validates it, prints a
 * path-based report, and exits 1 on any mismatch, 0 otherwise. No migrate() — this
 * checks the file as written against the current contract.
 */
export async function checkSchemaCommand(filePath?: string): Promise<void> {
  if (!filePath) {
    process.stderr.write("Usage: fh-workflow check-schema <file.json>\n");
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

  const { ok, errors } = validateAgainstContract(parsed);
  if (ok) {
    process.stdout.write(`✓ ${abs}: schema valid\n`);
    return;
  }

  printSchemaReport(abs, errors);
  process.exit(1);
}

function printSchemaReport(file: string, errors: ErrorObject[]): void {
  const out = process.stdout;
  out.write(`${file}: ${errors.length} schema error${errors.length === 1 ? "" : "s"}\n`);
  for (const e of errors) {
    const where = e.instancePath || "/";
    out.write(`  ✗ [${e.keyword}] ${where} ${e.message ?? ""}${describeParams(e)}\n`);
  }
}

// Surfaces the one detail from each error's `params` that makes it actionable.
function describeParams(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  if ("missingProperty" in p) return ` (missing: ${String(p.missingProperty)})`;
  if ("additionalProperty" in p) return ` (unexpected: ${String(p.additionalProperty)})`;
  if ("allowedValues" in p) return ` (allowed: ${(p.allowedValues as unknown[]).join(", ")})`;
  if ("tagValue" in p) return ` (got: ${String(p.tagValue)})`;
  return "";
}
