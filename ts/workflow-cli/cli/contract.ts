// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import yaml from "js-yaml";

// The installed CLI bundle ships the contract files as siblings (copied in by
// build-cli.mjs); prefer them. In-repo (tsx) those siblings don't exist, so fall
// back to the contract in the source tree: cli -> app -> ts -> repo root, then
// into contract/.
const here = path.dirname(fileURLToPath(import.meta.url));
export const CONTRACT_DIR = existsSync(path.join(here, "workflow.yaml"))
  ? here
  : path.resolve(here, "../../../contract");

export function loadContractDocument(fileName: string): Record<string, unknown> {
  return yaml.load(readFileSync(path.join(CONTRACT_DIR, fileName), "utf-8")) as Record<
    string,
    unknown
  >;
}

// Normalises the two OpenAPI 3.0 constructs Ajv can't consume directly, everywhere
// they occur in the tree. Schema-agnostic: it reshapes keywords, never named schemas.
//   1. `nullable: true`        -> JSON Schema `type: [..., "null"]`
//   2. `discriminator.mapping` -> dropped (Ajv supports only `propertyName`; the
//      variant is selected from each branch's `type` tag, so mapping is redundant).
export function openApiToJsonSchema(value: unknown): unknown {
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
