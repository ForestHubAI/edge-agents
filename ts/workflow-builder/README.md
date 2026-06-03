# @foresthubai/workflow-builder

The ForestHub workflow **canvas/editor** — a reusable React component library. It
renders the visual builder (node graph, panels, dialogs) and pairs with the
headless [`@foresthubai/workflow-core`](../workflow-core) for the model, serialization
and validation. Core owns the data; this package owns the UI.

## Requirements

- **React 18** (peer dependency).
- **Tailwind CSS 3** (peer dependency). This package is consumed the Tailwind way —
  it ships design tokens + a Tailwind preset, not a prebuilt stylesheet. A host that
  doesn't use Tailwind can't consume it as-is. This is the single supported path.

## Setup

Four steps in the host app:

```ts
// 1. Import the design-system tokens + builder CSS layers, once, at your entry.
import "@foresthubai/workflow-builder/styles/index.css";

// 2. Adopt the Tailwind preset (tokens → utilities, fonts, animations, plugin).
//    tailwind.config.ts:
import workflowBuilderPreset from "@foresthubai/workflow-builder/tailwind-preset";
export default {
  presets: [workflowBuilderPreset],
  content: [
    "./src/**/*.{ts,tsx}",
    // 3. Scan the builder so the utility classes its components use are emitted.
    "./node_modules/@foresthubai/workflow-builder/dist/**/*.js",
  ],
};
```

```tsx
// 4. Render it inside a HEIGHT-CONSTRAINED container — the builder fills h-full/
//    w-full and never assumes the viewport.
import { WorkflowBuilder } from "@foresthubai/workflow-builder";

<div style={{ height: "100vh" }}>
  <WorkflowBuilder models={models} language="en" onChange={...} onError={...} />
</div>
```

## Ownership rules

The builder is a guest in your app. It dresses **itself** and speaks **its own**
language, but it never reaches into things the host owns.

### Styles

- **The builder owns its base look** (font, text color, its panels/canvas/nodes)
  and ships the design tokens as **defaults** on `:root` (dark) and `.light`.
- **The host owns the page.** The builder does **not** style `<body>` — no page
  background, no page font, no `overscroll-behavior`. The host provides page chrome.
  (The builder's translucent "glass" surfaces blur whatever's behind them, so give
  the area a backdrop if you want the glass to read its best.)
- **The host drives color mode** by toggling a `.light` class on an ancestor
  (typically `<html>`). Default — no class — is dark.
- **The host themes by overriding tokens.** Redeclare the CSS variables. The
  contract: values are **HSL channels** (`262 83% 58%`, not `#hex`/`hsl()`); override
  in **both** `:root` and `.light`; override at **`:root`/`html`, not a nested
  wrapper** — Radix dialogs/menus/tooltips/selects portal to `<body>`, outside the
  builder root, so a scoped override won't reach them. See
  [`workflow-cli/src/theme-overrides.css`](../workflow-cli/src/theme-overrides.css) for a worked example.

### Translations

- **The builder owns its strings** (ships `en` + `de`) in a **private** i18next
  instance, served only through its own `I18nextProvider`. It deliberately does
  **not** register with react-i18next's global default (no `initReactI18next`, hence
  no `setI18n`) — that default is a single library-wide pointer with last-init-wins
  semantics, and a guest component must not own it. So the builder never collides
  with the host's i18next.
- **No host i18n setup is required.** A host with no i18next, or one using
  react-i18next its own way (with or without an `<I18nextProvider>`), both work
  unchanged — the builder's instance is reachable only inside its own subtree and
  leaves the host's `useTranslation()` untouched.
- **The host drives locale** via the `language` prop. The builder follows it and
  never auto-detects (no `LanguageDetector`, no localStorage writes).

## What the builder relies on from the host

- React 18; Tailwind with the preset adopted and the builder in `content`.
- A **sized parent** container (the builder fills it; it never sizes the viewport).
- **Page chrome** (background/page font) — the builder no longer provides it.
- A **`.light`** class on an ancestor for light mode (default dark).
- The **`language`** prop for locale.
- The **`models`** catalog, `onChange` / `onError` (and other) callbacks, and the
  imperative **ref handle** (`loadWorkflow` / `exportWorkflow` / `clear` / `validate`
  / undo-redo / selection / `setDebugPhase`). See `WorkflowBuilderProps` and
  `WorkflowBuilderHandle` in [`src/WorkflowBuilder.tsx`](./src/WorkflowBuilder.tsx).
