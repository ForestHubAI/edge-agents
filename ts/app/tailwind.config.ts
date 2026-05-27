import type { Config } from "tailwindcss";
// Import via the PACKAGE path (not a relative one) so this models exactly how an
// external host consumes the builder. In-repo it resolves through the
// node_modules symlink + the builder's `exports` map; jiti (Tailwind's config
// loader) compiles the shipped .ts preset.
import workflowBuilderPreset from "@foresthubai/workflow-builder/tailwind-preset";

/**
 * The design-system tokens, color mappings, shadows, radii, fonts, animation
 * keyframes and the tailwindcss-animate plugin all live in the builder's preset,
 * kept in lockstep with the tokens declared in
 * @foresthubai/workflow-builder/styles/index.css. This app config only owns what's
 * app-specific: which files Tailwind scans for class names.
 *
 * `content` must include the builder's source so the utility classes its
 * components reference are emitted. In this monorepo we point at the builder's
 * src (the Vite alias resolves the package there for HMR); a published consumer
 * would instead glob `node_modules/@foresthubai/workflow-builder/dist/**\/*.js`.
 */
const config: Config = {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    "../workflow-builder/src/**/*.{ts,tsx}",
  ],
  presets: [workflowBuilderPreset],
};

export default config;
