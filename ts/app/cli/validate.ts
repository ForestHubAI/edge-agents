import { promises as fs } from "node:fs";
import path from "node:path";
// Relative-path imports into workflow-core/src because workflow-core's
// own dist/ is currently partial (TS errors elsewhere block its build).
// tsx loads the .ts source directly at runtime.
import { deserialize } from "../../workflow-core/src/workflow/serialization";
import { validateWorkflowState } from "../../workflow-core/src/diagnostics/diagnostics";
import type { Diagnostic } from "../../workflow-core/src/diagnostics/diagnostics";
import type { Schemas } from "../../workflow-core/src/api";

/**
 * `fh-builder validate <file.json>`
 *
 * Reads a workflow snapshot, deserializes it to the in-memory shape, runs
 * the headless validator, and prints a report. Exits with code 1 if any
 * errors were found, 0 otherwise.
 */
export async function validateCommand(filePath?: string): Promise<void> {
  if (!filePath) {
    process.stderr.write("Usage: fh-builder validate <file.json>\n");
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

  let workflow: Schemas["Workflow"];
  try {
    workflow = JSON.parse(raw);
  } catch (err) {
    process.stderr.write(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const state = deserialize(workflow);
  const result = validateWorkflowState(state);

  printReport(abs, result);

  if (result.totalErrors > 0) process.exit(1);
}

function printReport(
  file: string,
  result: { totalErrors: number; totalWarnings: number; canvases: Array<{ canvasId: string; diagnostics: Diagnostic[] }>; channelDiagnostics: Diagnostic[] },
): void {
  const out = process.stdout;

  if (result.totalErrors === 0 && result.totalWarnings === 0) {
    out.write(`✓ ${file}: valid\n`);
    return;
  }

  out.write(`${file}: ${result.totalErrors} error${pluralize(result.totalErrors)}, ${result.totalWarnings} warning${pluralize(result.totalWarnings)}\n`);

  for (const canvas of result.canvases) {
    if (canvas.diagnostics.length === 0) continue;
    out.write(`\n  canvas "${canvas.canvasId}":\n`);
    for (const d of canvas.diagnostics) printDiagnostic(d, "    ");
  }

  if (result.channelDiagnostics.length > 0) {
    out.write(`\n  channels:\n`);
    for (const d of result.channelDiagnostics) printDiagnostic(d, "    ");
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
