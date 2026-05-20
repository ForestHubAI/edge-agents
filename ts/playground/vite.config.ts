import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileBridge } from "./plugins/filebridge";

export default defineConfig({
  plugins: [
    react(),
    // Lets the SPA read/write a single workflow file on disk through
    // /api/file?path=… . The CLI (pass 2) will pass a tighter allowedRoots.
    fileBridge({
      allowedRoots: [
        process.env.FH_BUILDER_ALLOW_ROOT
          ? path.resolve(process.env.FH_BUILDER_ALLOW_ROOT)
          : path.resolve(__dirname, ".."),
      ],
    }),
  ],
  server: {
    port: 5173,
    open: true,
  },
  resolve: {
    // Use source directly so we get HMR on workspace package edits and don't
    // depend on dist/ being built. Subpath imports (e.g.
    // `@foresthub/workflow-core/diagnostics`) resolve into the same src/ tree.
    alias: {
      "@foresthub/visual-builder": path.resolve(__dirname, "../visual-builder/src"),
      "@foresthub/workflow-core": path.resolve(__dirname, "../workflow-core/src"),
      // TODO: implement stubs
      // Stubs for embedder-provided hooks that visual-builder unfortunately
      // still imports via `@/hooks/...`. Replaced by a proper injection point
      // when useDynamicSelectionOptions is refactored.
      "@/hooks/useRagCollections": path.resolve(__dirname, "src/stubs/useRagCollections.ts"),
      "@/hooks/useAvailableProviders": path.resolve(__dirname, "src/stubs/useAvailableProviders.ts"),
    },
  },
});
