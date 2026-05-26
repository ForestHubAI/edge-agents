/**
 * sync-translations audit — the deterministic half of the /sync-translations command.
 *
 * Node/edge/channel/memory/model DESCRIPTIONS live in code (English), and the
 * workflow-builder renders them through getNodeDescription / getParamDescription /
 * getEdgeDescription (workflow-builder/src/utils/translation.ts), which translate a
 * convention key with the English code value as `defaultValue`. So a non-English
 * locale that omits such a key isn't broken — it just shows English. This script
 * imports the registries, derives the FULL set of expected description keys, and
 * diffs them against each locale so you can see exactly which descriptions are still
 * untranslated (and which locale description keys have gone stale).
 *
 * It also does plain en↔locale key parity for the non-description ("general UI")
 * keys in both i18n trees — the part that IS a hard error when it drifts.
 *
 * Run from ts/:  npx tsx ../.claude/scripts/sync-translations.ts
 * Pure read-only. Imports workflow-core source directly (relative paths), so it
 * needs no build and no path-alias resolution.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

import { NodeRegistry } from "../../ts/workflow-core/src/node/index.ts";
import { EDGE_DEFINITIONS } from "../../ts/workflow-core/src/edge/index.ts";
import { CHANNEL_DEFINITION } from "../../ts/workflow-core/src/channel/index.ts";
import { MemoryRegistry } from "../../ts/workflow-core/src/memory/index.ts";
import { ModelRegistry } from "../../ts/workflow-core/src/model/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const tsRoot = join(here, "..", "..", "ts");
const builderLocales = join(tsRoot, "workflow-builder", "src", "i18n", "locales");
const appLocales = join(tsRoot, "app", "src", "i18n", "locales");

// A locale key counts as a code-defined description override if it sits in one of
// these namespaces and ends in `.description`. Everything else is "general UI".
const DESC_RE = /^(nodes|edges|channels|memory|models)\..*\.description$/;

type Expected = { key: string; source: string; origin: string };

/** The full set of description keys the builder *could* translate, with English source text. */
function expectedDescriptionKeys(): Expected[] {
  const out: Expected[] = [];
  const seen = new Set<string>();
  const add = (key: string, source: string, origin: string) => {
    if (!source) return; // getParamDescription returns "" for empty descriptions — no key emitted
    if (seen.has(key)) return; // flat namespaces (channels/memory/models) can collide on param id
    seen.add(key);
    out.push({ key, source, origin });
  };

  for (const def of NodeRegistry.getAll()) {
    add(`nodes.${def.type}.description`, def.description, `node ${def.type}`);
    for (const p of def.parameters) add(`nodes.${def.type}.params.${p.id}.description`, p.description, `node ${def.type} · param ${p.id}`);
  }
  for (const [type, def] of Object.entries(EDGE_DEFINITIONS)) {
    add(`edges.${type}.description`, def.description, `edge ${type}`);
    for (const p of def.parameters) add(`edges.${type}.params.${p.id}.description`, p.description, `edge ${type} · param ${p.id}`);
  }
  // channels/memory/models use a flat (type-less) prefix in the builder panels.
  for (const p of CHANNEL_DEFINITION.parameters) add(`channels.params.${p.id}.description`, p.description, `channel · param ${p.id}`);
  for (const def of MemoryRegistry.getAll()) for (const p of def.parameters) add(`memory.params.${p.id}.description`, p.description, `memory ${def.type} · param ${p.id}`);
  for (const def of ModelRegistry.getAll()) for (const p of def.parameters) add(`models.params.${p.id}.description`, p.description, `model ${def.type} · param ${p.id}`);

  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Flatten a nested locale object to dot-path leaf keys. */
function leafKeys(obj: unknown, prefix = "", acc = new Set<string>()): Set<string> {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) leafKeys(v, prefix ? `${prefix}.${k}` : k, acc);
  } else {
    acc.add(prefix);
  }
  return acc;
}

function loadLocales(dir: string): Map<string, Set<string>> {
  const locales = new Map<string, Set<string>>();
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".json")) continue;
    const name = basename(file, ".json");
    locales.set(name, leafKeys(JSON.parse(readFileSync(join(dir, file), "utf8"))));
  }
  return locales;
}

const sorted = (s: Iterable<string>) => [...s].sort();

let issues = 0;
const log = (s = "") => process.stdout.write(s + "\n");
const h = (s: string) => log(`\n${"=".repeat(s.length)}\n${s}\n${"=".repeat(s.length)}`);

// ── workflow-builder: description coverage ──────────────────────────────────
h("workflow-builder — code-defined description coverage");
const expected = expectedDescriptionKeys();
const expectedKeys = new Set(expected.map((e) => e.key));
const builder = loadLocales(builderLocales);
log(`Expected description keys derived from registries: ${expected.length}`);
log(`Locales: ${sorted(builder.keys()).join(", ")}`);

for (const [locale, keys] of [...builder].filter(([l]) => l !== "en")) {
  const untranslated = expected.filter((e) => !keys.has(e.key));
  const stale = sorted(keys).filter((k) => DESC_RE.test(k) && !expectedKeys.has(k));
  log(`\n[${locale}]`);
  if (untranslated.length === 0) log("  ✓ every code description is translated");
  else {
    issues += untranslated.length;
    log(`  ⚠ untranslated — falls back to English (${untranslated.length}):`);
    for (const e of untranslated) log(`     ${e.key}\n        ${e.origin} → "${e.source}"`);
  }
  if (stale.length) {
    issues += stale.length;
    log(`  ⚠ stale description keys — no matching code definition (${stale.length}):`);
    for (const k of stale) log(`     ${k}`);
  }
}

// ── general UI key parity (both trees) ──────────────────────────────────────
function parity(label: string, dir: string) {
  h(`${label} — general UI key parity (non-description)`);
  const locales = loadLocales(dir);
  const en = locales.get("en");
  if (!en) {
    log("  (no en.json — skipped)");
    return;
  }
  const general = (keys: Set<string>) => new Set(sorted(keys).filter((k) => !DESC_RE.test(k)));
  const enGeneral = general(en);
  log(`en general keys: ${enGeneral.size}`);
  for (const [locale, keys] of [...locales].filter(([l]) => l !== "en")) {
    const loc = general(keys);
    const missing = sorted(enGeneral).filter((k) => !loc.has(k)); // in en, not here → MUST add
    const extra = sorted(loc).filter((k) => !enGeneral.has(k)); // here, not en → stale or add to en
    log(`\n[${locale}]`);
    if (!missing.length && !extra.length) log("  ✓ in sync with en");
    if (missing.length) {
      issues += missing.length;
      log(`  ⚠ missing (present in en, absent here) — ${missing.length}:`);
      for (const k of missing) log(`     ${k}`);
    }
    if (extra.length) {
      issues += extra.length;
      log(`  ⚠ extra (here, not in en) — likely stale or belongs in en — ${extra.length}:`);
      for (const k of extra) log(`     ${k}`);
    }
  }
}
parity("workflow-builder", builderLocales);
parity("app", appLocales);

h("summary");
log(issues === 0 ? "✓ no issues" : `⚠ ${issues} issue(s) — see above`);
process.exit(issues === 0 ? 0 : 1);
