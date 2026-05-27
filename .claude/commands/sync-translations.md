# Sync Translations

Audit the i18n trees for translation completeness across all locales. The hard,
error-prone part — which node/param/edge/channel/memory/model descriptions still lack
translations — is derived deterministically by a script; the rest are agent checks.

## Two i18n trees

Both i18next, `en` is the source of truth, fallback `en`. Locales are discovered from
the `locales/` dirs (today: `en`, `de`).

- **`ts/workflow-builder/src/i18n/locales/*.json`** — the builder's private instance:
  canvas/panel/dialog UI **plus** the optional description overrides (below).
- **`ts/app/src/i18n/locales/*.json`** — the host app's UI (toolbar, status, dialogs).

## What makes this repo different: descriptions live in code

Node/edge/channel/memory/model **descriptions** are authored in English in the
definitions under `ts/workflow-core/src/{node,edge,channel,memory,model}/`, not in
`en.json`. The builder renders them through `ts/workflow-builder/src/utils/translation.ts`:

- `getNodeDescription` → `nodes.<type>.description`
- `getParamDescription` → `<prefix>.params.<paramId>.description`, where prefix is
  `nodes.<type>`, `edges.<type>`, `channels`, `memory`, or `models`
- `getEdgeDescription` → `edges.<type>.description`

Each call passes the English code value as i18next `defaultValue`. **Consequence:** a
non-`en` locale that omits a description key is *not* an error — it renders English.
These keys are therefore **absent from `en.json` on purpose** and **optional overrides
in other locales**. Surfacing which are still untranslated is the main job here.
**Labels, categories, port names, and selection option labels are NOT translated** —
they stay raw English code values; don't flag them.

General-UI keys (everything not matching
`^(nodes|edges|channels|memory|models)\..*\.description$`) are the opposite: they
**must** be in `en.json` and **must** reach parity in every other locale.

## 1. Run the deterministic audit (descriptions + key parity)

From `ts/`:

```
npx tsx ../.claude/scripts/sync-translations.ts
```

It imports the registries directly and reports, per non-`en` locale:

- **Untranslated descriptions** — code description keys missing from the locale (with
  the English source text to translate from).
- **Stale description keys** — `*.description` keys in the locale with no matching code
  definition (a renamed/removed node, param, etc.).
- **General-UI key parity** — keys in `en` missing from the locale (MUST add) and keys
  in the locale absent from `en` (stale, or belong in `en`), for both trees.

Exit code is `1` when it finds anything, `0` when clean. Trust this output for the
parity/description checks — don't re-derive it by hand.

## 2. Validate t() key usage (agent check)

The script can't see runtime usage. Search `ts/workflow-builder/src` and `ts/app/src`
(`.ts`/`.tsx`) for translation keys and confirm each resolves:

- Direct: `` t("…") ``, `t('…')`, `` t(`…`) `` — for builder keys check
  `workflow-builder/.../en.json`; for app keys check `app/.../en.json`.
- Indirect: string literals later passed to `t()` (`labelKey: "…"`, `key: "…"`, arrays
  of keys). Look for `namespace.keyName`-shaped literals.
- Template literals: extract the static prefix; a dynamic tail
  (`` t(`nodes.${type}.description`) ``) is expected — don't flag it, but note the
  dynamic namespace so step 4 doesn't false-positive on it.

Do **not** flag the description-convention keys as "missing from en.json" — they
resolve via `defaultValue` by design (see above).

## 3. Hardcoded user-visible strings (agent check)

Scan builder panels/dialogs/toolbars (and app UI) for user-visible strings that bypass
`t()`: JSX text, `placeholder`/`title`/`aria-label`/`alt`, toast/dialog titles and
descriptions, error messages shown to users.

**Not findings:** `className`/`id`/`data-*`/`role`, import paths, type/variable names,
`console.*`, test files, single-word enum/identifier values. **And per the convention
above:** node/edge/param *descriptions*, labels, categories, port names, and option
labels rendered in builder definitions are intentionally raw English — not findings.
General UI chrome in builder panels (button text, headings, placeholders, messages)
*should* use `t()` — flag those.

## 4. Unused keys (agent check, report only)

For each leaf key in each `en.json`, search its tree's `src/` for a reference (full
dot-path, or final segment in a `t()` call). Account for dynamic construction from step
2 — don't flag a key reachable by a `` t(`prefix.${x}`) `` pattern. Report
zero-reference keys as *potentially* unused. **Do not auto-delete** — dynamic usage is
easy to miss.

## Output

```
## Translation Sync Results
### 1. Descriptions & key parity   (from sync-translations.ts)
### 2. t() usage                   ✅ all resolve  | ⚠ <key> in <file:line>
### 3. Hardcoded strings           ✅ none | ⚠ <file:line> "<text>" → suggest <key>
### 4. Unused keys                 ✅ all referenced | ⚠ <key> (verify dynamic use)
```

## Apply fixes

After reporting, with the user's go-ahead:

- **Untranslated descriptions** (step 1): add the convention key to the non-`en`
  locale with a real translation of the English source. This is the point of a sync —
  a fully-translated locale should have them. Never add them to `en.json`.
- **Missing general keys** (step 1): add to the lagging locale, properly translated
  (German for `de.json`).
- **Stale keys** (step 1): remove from the locale, or — if a general key is genuinely
  used — add it to `en.json` instead.
- **Missing t() keys** (step 2): add to all locales; prefer refactoring indirect
  `labelKey`-style usage to direct `t()` calls.
- **Hardcoded strings** (step 3): wrap in `t()` and add the key to every locale.

Then re-run the script to confirm it's clean, and from `ts/` run
`npm run typecheck && npm run lint`. (JSON-only edits won't break the build, but any
code refactor from steps 2–3 must.)
