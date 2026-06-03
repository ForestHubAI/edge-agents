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
    // `@foresthubai/workflow-core/diagnostics`) resolve into the same src/ tree.
    alias: {
      "@foresthubai/workflow-builder": path.resolve(__dirname, "../workflow-builder/src"),
      "@foresthubai/workflow-core": path.resolve(__dirname, "../workflow-core/src"),
    },
  },
});
