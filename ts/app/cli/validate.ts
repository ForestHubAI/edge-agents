import { promises as fs } from "node:fs";
import path from "node:path";
import { migrate, validateWorkflow } from "@foresthubai/workflow-core";
import type { ValidationResult, Diagnostic } from "@foresthubai/workflow-core/diagnostics";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";

/**
 * `fh-builder validate <file.json> [--json]`
 *
 * Reads a workflow snapshot, deserializes it to the in-memory shape, runs
 * the headless validator, and prints a report. Exits with code 1 if any
 * errors were found, 0 otherwise.
 *
 * `--json` emits a flat diagnostics array on stdout for machine consumption
 * (used by `fh-agent validate` to merge contract-schema findings into its
 * own report).
 */
export async function validateCommand(filePath?: string, jsonOutput = false): Promise<void> {
  if (!filePath) {
    if (jsonOutput) {
      process.stdout.write(JSON.stringify([{ severity: "error", category: "usage", message: "missing <file.json>" }]));
    } else {
      process.stderr.write("Usage: fh-builder validate <file.json> [--json]\n");
    }
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), filePath);
  let raw: string;
  try {
    raw = await fs.readFile(abs, "utf-8");
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      emitFatal(jsonOutput, `File not found: ${abs}`);
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    emitFatal(jsonOutput, `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }

  let workflow: ApiWorkflow;
  try {
    workflow = migrate(parsed);
  } catch (err) {
    emitFatal(jsonOutput, err instanceof Error ? err.message : String(err));
  }

  const result = validateWorkflow(workflow!);

  if (jsonOutput) {
    process.stdout.write(JSON.stringify(flattenDiagnostics(result), null, 2) + "\n");
  } else {
    printReport(abs, result);
  }

  if (result.totalErrors > 0) process.exit(1);
}

/**
 * Flattens the nested ValidationResult into a single array of diagnostics —
 * the shape `fh-agent validate` expects, identical to its own diagnostic
 * type. Canvas/channel/memory scope is folded into the `location` string.
 */
function flattenDiagnostics(result: ValidationResult): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const canvas of result.canvases) {
    for (const d of canvas.diagnostics) out.push(toFlat(d, `canvas[${canvas.canvasId}]`));
  }
  for (const d of result.channelDiagnostics) out.push(toFlat(d, "channels"));
  for (const d of result.memoryDiagnostics) out.push(toFlat(d, "memory"));
  return out;
}

function toFlat(d: Diagnostic, scope: string): Record<string, unknown> {
  const where: string[] = [];
  if (d.nodeId) where.push(`node:${d.nodeId}`);
  if (d.edgeId) where.push(`edge:${d.edgeId}`);
  if (d.channelId) where.push(`channel:${d.channelId}`);
  if (d.paramId) where.push(`param:${d.paramId}`);
  if (d.outputId) where.push(`output:${d.outputId}`);
  return {
    severity: d.severity,
    category: `workflow:${d.category}`,
    message: d.message,
    location: where.length > 0 ? `${scope}/${where.join(",")}` : scope,
    ...(d.nodeId ? { nodeId: d.nodeId } : {}),
  };
}

function emitFatal(jsonOutput: boolean, msg: string): never {
  if (jsonOutput) {
    process.stdout.write(JSON.stringify([{ severity: "error", category: "workflow:io", message: msg }]) + "\n");
  } else {
    process.stderr.write(msg + "\n");
  }
  process.exit(1);
}

function printReport(file: string, result: ValidationResult): void {
  const out = process.stdout;

  if (result.totalErrors === 0 && result.totalWarnings === 0) {
    out.write(`✓ ${file}: valid\n`);
    return;
  }

  out.write(
    `${file}: ${result.totalErrors} error${pluralize(result.totalErrors)}, ${result.totalWarnings} warning${pluralize(result.totalWarnings)}\n`,
  );

  for (const canvas of result.canvases) {
    if (canvas.diagnostics.length === 0) continue;
    out.write(`\n  canvas "${canvas.canvasId}":\n`);
    for (const d of canvas.diagnostics) printDiagnostic(d, "    ");
  }

  if (result.channelDiagnostics.length > 0) {
    out.write(`\n  channels:\n`);
    for (const d of result.channelDiagnostics) printDiagnostic(d, "    ");
  }

  if (result.memoryDiagnostics.length > 0) {
    out.write(`\n  memory:\n`);
    for (const d of result.memoryDiagnostics) printDiagnostic(d, "    ");
  }
}

function printDiagnostic(d: Diagnostic, indent: string): void {
  const where: string[] = [];
  if (d.nodeId) where.push(`node ${d.nodeId}`);
  if (d.edgeId) where.push(`edge ${d.edgeId}`);
  if (d.channelId) where.push(`channel ${d.channelId}`);
  if (d.paramId) where.push(`param ${d.paramId}`);
  if (d.outputId) where.push(`output ${d.outputId}`);
  const location = where.length > 0 ? ` (${where.join(", ")})` : "";
  const tag = d.severity === "error" ? "✗" : "⚠";
  process.stdout.write(`${indent}${tag} [${d.category}] ${d.message}${location}\n`);
}

function pluralize(n: number): string {
  return n === 1 ? "" : "s";
}
