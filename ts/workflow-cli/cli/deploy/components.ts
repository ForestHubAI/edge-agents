// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Reads and validates user-authored custom components. A component is a folder
// holding a component.json (-> DeployComponent, merged verbatim into the spec
// alongside the first-party engine/llama). Validation runs against the contract
// itself, so the allowed shape never drifts from deployment.yaml.

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import { confirm, input, password } from "@inquirer/prompts";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

import { loadContractDocument, openApiToJsonSchema } from "../contract";
import type { DeploymentSchemas } from "./api";

export type DeployComponent = DeploymentSchemas["DeployComponent"];

// A validated custom component paired with the folder it came from. The folder is
// kept because the <name>.env.example lives next to the component.json and is read
// in a later step.
export interface LoadedComponent {
  component: DeployComponent;
  dir: string;
}

// Reads and parses <dir>/component.json. Throws a path-tagged error on a missing
// file or malformed JSON, for the caller to turn into a clean exit.
export async function readComponentJson(dir: string): Promise<unknown> {
  const file = path.join(dir, "component.json");
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`custom component: no component.json in ${dir}`, { cause: err });
    }
    throw err;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`${file}: invalid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }
}

let cachedValidator: ValidateFunction | undefined;

// Compiles a validator for DeployComponent straight from deployment.yaml. The raw
// contract carries no `additionalProperties: false`, so a typo'd or stray key
// (`dvices`, `testing`) would pass and render a broken compose. We inject it
// shallowly on the DeployComponent node only — the allowed keys still come from
// the contract (zero-drift), while `config` keeps its open `additionalProperties`.
function compileDeployComponentValidator(): ValidateFunction {
  if (cachedValidator) return cachedValidator;

  const deployment = openApiToJsonSchema(loadContractDocument("deployment.yaml")) as Record<
    string,
    unknown
  >;
  deployment.$id = "deployment.yaml";

  const schemas = (deployment.components as Record<string, unknown>).schemas as Record<
    string,
    Record<string, unknown>
  >;
  schemas.DeployComponent.additionalProperties = false;

  const ajv = new Ajv({ strict: false, allErrors: true });
  addFormats(ajv);
  ajv.addSchema(deployment);

  cachedValidator = ajv.compile({ $ref: "deployment.yaml#/components/schemas/DeployComponent" });
  return cachedValidator;
}

// Validates one parsed component.json against the contract, returning a message
// per failure (empty array = valid). The shared single-item check behind both the
// batch parse and the interactive folder prompt, so both reject the same shapes.
export function validateComponent(data: unknown): string[] {
  const validate = compileDeployComponentValidator();
  if (validate(data)) return [];
  return (validate.errors ?? []).map((e) => {
    const p = e.params as Record<string, unknown>;
    // Name the offending key for the two errors where it's the whole point:
    // an unknown/typo'd property and a missing required one.
    const which = p.additionalProperty ?? p.missingProperty;
    const detail = typeof which === "string" ? ` "${which}"` : "";
    return `${e.instancePath || "/"} ${e.message ?? "invalid"}${detail}`;
  });
}

// Validates each parsed component.json against the contract, collecting every
// failure as "<source>: <message>" before throwing — the same all-at-once style as
// assertDeployable. Narrows to DeployComponent once the shape is proven.
export function parseDeployComponents(raw: { source: string; data: unknown }[]): DeployComponent[] {
  const errors: string[] = [];
  for (const { source, data } of raw) {
    for (const message of validateComponent(data)) errors.push(`${source}: ${message}`);
  }
  if (errors.length > 0) {
    throw new Error(`invalid custom component(s):\n  - ${errors.join("\n  - ")}`);
  }
  return raw.map((r) => r.data as DeployComponent);
}

// One line of a <name>.env.example: a KEY=value assignment, or anything else
// (comment, blank) passed through verbatim so the generated file keeps its shape.
type EnvEntry = { kind: "kv"; key: string; value: string } | { kind: "comment"; text: string };

export function parseEnvExample(text: string): EnvEntry[] {
  return text.split("\n").map((line) => {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line);
    return m ? { kind: "kv", key: m[1] ?? "", value: m[2] ?? "" } : { kind: "comment", text: line };
  });
}

// Keys whose value is likely a secret — masked when prompted, never echoed.
const SECRET_HINT = /password|secret|key|token/i;

// Turns a component's <name>.env.example into its <name>.env text: filled keys
// are taken as-is, empty ones are prompted at a terminal (masked for secrets) or
// left as a stub otherwise. Returns null when the component ships no example.
export async function resolveComponentEnv(
  dir: string,
  name: string,
  opts: { interactive: boolean },
): Promise<string | null> {
  const file = path.join(dir, `${name}.env.example`);
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }

  const lines: string[] = [];
  for (const e of parseEnvExample(raw)) {
    if (e.kind === "comment") {
      lines.push(e.text);
    } else if (e.value !== "" || !opts.interactive) {
      lines.push(`${e.key}=${e.value}`);
    } else {
      const value = SECRET_HINT.test(e.key)
        ? await password({ message: `${name}: ${e.key}`, mask: "*" })
        : await input({ message: `${name}: ${e.key}` });
      lines.push(`${e.key}=${value}`);
    }
  }

  const header =
    `# Auto-generated by \`fh-workflow deploy\` from ${name}.env.example.\n` +
    `# Loaded into the ${name} container via compose env_file; chmod 600 if it holds\n` +
    `# secrets, and fill any empty values before \`up\`.\n`;
  return `${header}\n${lines.join("\n")}\n`;
}

// The interactive custom-components section of the wizard. Components supplied via
// --component arrive pre-validated and are shown as already added; a yes/no loop
// (default no) adds any more, each entered folder validated against the contract
// right at the prompt and deduped on name (the resolver re-checks the full set).
// Each component's <name>.env is resolved as it is added, so the operator answers
// a component's env right after picking it — never a second batch pass.
export async function promptCustomComponents(
  preloaded: LoadedComponent[],
): Promise<{ components: DeployComponent[]; env: Record<string, string> }> {
  const components: DeployComponent[] = [];
  const env: Record<string, string> = {};
  const seen = new Set<string>();

  // Take in a component: record it, then turn its env.example into env text.
  const add = async (loaded: LoadedComponent): Promise<void> => {
    seen.add(loaded.component.name);
    components.push(loaded.component);
    const text = await resolveComponentEnv(loaded.dir, loaded.component.name, { interactive: true });
    if (text !== null) env[loaded.component.name] = text;
  };

  if (preloaded.length > 0) {
    process.stdout.write(`  Already added: ${preloaded.map((c) => c.component.name).join(", ")}\n`);
  }
  for (const loaded of preloaded) await add(loaded);

  while (
    await confirm({
      message: components.length === 0 ? "Add a custom component?" : "Add another custom component?",
      default: false,
    })
  ) {
    const dir = (
      await input({
        message: "Custom component folder",
        // Full inline validation: path, component.json presence, contract shape,
        // and a name not already taken — the same checks the batch path runs, so
        // a bad folder is rejected here instead of failing late in the build.
        validate: async (v) => {
          const t = v.trim();
          if (!t) return "enter a folder path";
          if (!existsSync(t)) return `folder not found: ${t}`;
          if (!existsSync(path.join(t, "component.json"))) return `no component.json in ${t}`;
          let data: unknown;
          try {
            data = await readComponentJson(t);
          } catch (err) {
            return err instanceof Error ? err.message : String(err);
          }
          const errors = validateComponent(data);
          if (errors.length > 0) return errors.join("; ");
          const name = (data as DeployComponent).name;
          return seen.has(name) ? `"${name}" already added` : true;
        },
      })
    ).trim();

    // The prompt's validator proved the shape; re-read for the typed value.
    await add({ component: (await readComponentJson(dir)) as DeployComponent, dir });
  }

  return { components, env };
}
