// Reads and validates user-authored custom components. A component is a folder
// holding a component.json (-> DeployComponent, merged verbatim into the spec
// alongside the first-party engine/llama). Validation runs against the contract
// itself, so the allowed shape never drifts from deployment.yaml.

import { promises as fs } from "node:fs";
import path from "node:path";

import { input, password } from "@inquirer/prompts";
import Ajv, { type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

import { loadContractDocument, openApiToJsonSchema } from "../contract";
import type { DeploymentSchemas } from "@foresthubai/workflow-core/api";

type DeployComponent = DeploymentSchemas["DeployComponent"];

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

// Validates each parsed component.json against the contract, collecting every
// failure as "<source>: <path> <message>" before throwing — the same all-at-once
// style as assertDeployable. Narrows to DeployComponent once the shape is proven.
export function parseDeployComponents(raw: { source: string; data: unknown }[]): DeployComponent[] {
  const validate = compileDeployComponentValidator();
  const errors: string[] = [];

  for (const { source, data } of raw) {
    if (!validate(data)) {
      for (const e of validate.errors ?? []) {
        const p = e.params as Record<string, unknown>;
        // Name the offending key for the two errors where it's the whole point:
        // an unknown/typo'd property and a missing required one.
        const which = p.additionalProperty ?? p.missingProperty;
        const detail = typeof which === "string" ? ` "${which}"` : "";
        errors.push(`${source}: ${e.instancePath || "/"} ${e.message ?? "invalid"}${detail}`);
      }
    }
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
