import type { Plugin } from "vite";
import path from "node:path";
import { handleFileRequest } from "../server/fileBridge";

export interface FileBridgeOptions {
  /**
   * Directories under which read/write is permitted. Any path outside these
   * roots returns 403. Defaults to `[process.cwd()]`. The CLI passes the bound
   * file's directory so the bridge is locked to that one file.
   */
  allowedRoots?: string[];
}

/**
 * Vite dev plugin: exposes the {@link handleFileRequest} bridge on the dev
 * server so the SPA can read/write a real file on disk. The handler is shared
 * with the standalone static server — this is just the Vite adapter, which only
 * runs under `vite dev`.
 */
export function fileBridge(options: FileBridgeOptions = {}): Plugin {
  const allowedRoots = (options.allowedRoots ?? [process.cwd()]).map((p) => path.resolve(p));

  return {
    name: "fh-file-bridge",
    configureServer(server) {
      // Generic middleware (not mounted at "/api/file") so the handler sees the
      // full url and parses requests exactly as the static server does.
      server.middlewares.use((req, res, next) => {
        void handleFileRequest(req, res, allowedRoots).then((handled) => {
          if (!handled) next();
        });
      });
    },
  };
}
