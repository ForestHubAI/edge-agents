import { promises as fs } from "node:fs";
import path from "node:path";
import { migrate, validateWorkflow } from "@foresthubai/workflow-core";
import type { ValidationResult, Diagnostic } from "@foresthubai/workflow-core/diagnostics";
import type { ApiWorkflow } from "@foresthubai/workflow-core/workflow";

/**
 * `fh-workflow validate <file.json>`
 *
 * Reads a workflow snapshot, deserializes it to the in-memory shape, runs
 * the headless validator, and prints a report. Exits with code 1 if any
 * errors were found, 0 otherwise.
 */
export async function validateCommand(filePath?: string): Promise<void> {
  if (!filePath) {
    process.stderr.write("Usage: fh-workflow validate <file.json>\n");
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

  let workflow: ApiWorkflow;
  try {
    workflow = migrate(parsed);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  }

  const result = validateWorkflow(workflow);

  printReport(abs, result);

  if (result.totalErrors > 0) process.exit(1);
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
