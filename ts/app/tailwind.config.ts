import type { Config } from "tailwindcss";
import workflowBuilderPreset from "../workflow-builder/tailwind-preset";

/**
 * The design-system tokens, color mappings, shadows, radii, animation
 * keyframes and the tailwindcss-animate plugin all live in the builder's
 * preset (../workflow-builder/tailwind-preset.ts), kept in lockstep with the
 * tokens declared in @foresthub/workflow-builder/src/styles/index.css. This
 * app config only owns what's app-specific: which files Tailwind scans for
 * class names.
 *
 * `content` must include the builder's source so the utility classes its
 * components reference are emitted. We point at source (not dist) because the
 * vite alias resolves the package to ../workflow-builder/src for HMR.
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
