import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Build output + generated contract types.
  { ignores: ["**/dist/**", "**/dist-cli/**", "workflow-core/src/api/workflow.ts"] },

  // Base: JS + TS recommended for all TS across the workspace.
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off", // TS resolves identifiers; avoids globals false positives
      "@typescript-eslint/no-unused-vars": "off",
    },
  },

  // React component code: hooks rules + browser globals.
  {
    files: ["workflow-builder/**/*.{ts,tsx}", "workflow-cli/src/**/*.{ts,tsx}"],
    languageOptions: { globals: globals.browser },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // The Vite app only: Fast Refresh hygiene.
  {
    files: ["workflow-cli/src/**/*.{ts,tsx}"],
    plugins: { "react-refresh": reactRefresh },
    rules: { "react-refresh/only-export-components": ["warn", { allowConstantExport: true }] },
  },

  // Node-side tooling: CLI, plugins, config files, ESM scripts.
  {
    files: ["**/cli/**/*.{ts,mjs}", "**/plugins/**/*.ts", "**/*.config.{ts,js,mjs}", "**/*.mjs"],
    languageOptions: { globals: globals.node },
  },
);
