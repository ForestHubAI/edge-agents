import { promises as fs } from "node:fs";
import path from "node:path";
import Ajv, { type ValidateFunction, type ErrorObject } from "ajv";
import addFormats from "ajv-formats";

import { loadContractDocument, openApiToJsonSchema } from "./contract";

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

  // Each contract document is registered under its file name, so $refs between
  // them ("llmproxy.yaml#/...") resolve exactly as written, and internal
  // #/components/... refs get a base to resolve against.
  const workflow = openApiToJsonSchema(loadContractDocument("workflow.yaml")) as Record<
    string,
    unknown
  >;
  workflow.$id = "workflow.yaml";
  const llmproxy = openApiToJsonSchema(loadContractDocument("llmproxy.yaml")) as Record<
    string,
    unknown
  >;
  llmproxy.$id = "llmproxy.yaml";

  const ajv = new Ajv({ discriminator: true, strict: false, allErrors: true });
  addFormats(ajv); // teaches Ajv the OpenAPI formats (int32, int64, date-time, ...) so they're truly checked
  ajv.addSchema(workflow);
  ajv.addSchema(llmproxy);

  cachedValidator = ajv.compile({ $ref: "workflow.yaml#/components/schemas/Workflow" });
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
