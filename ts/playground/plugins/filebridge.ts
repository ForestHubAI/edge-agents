import type { Plugin } from "vite";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface FileBridgeOptions {
  /**
   * Directories under which read/write is permitted. Any path outside these
   * roots returns 403. Defaults to `[process.cwd()]`. The CLI (pass 2) will
   * pass the specific file's directory here so the bridge is locked down to
   * that one file.
   */
  allowedRoots?: string[];
}

/**
 * Vite plugin: serves `/api/file?path=…` from the dev server so the playground
 * SPA can read and overwrite a real file on disk.
 *
 *   GET  /api/file?path=foo.json  → 200 {file contents}  | 404 if missing
 *   PUT  /api/file?path=foo.json  → 204 (body written verbatim)
 *
 * Paths must resolve under one of {@link FileBridgeOptions.allowedRoots};
 * otherwise the bridge returns 403. This is the only thing standing between
 * a stray browser tab and arbitrary local-file overwrites while the dev
 * server runs.
 */
export function fileBridge(options: FileBridgeOptions = {}): Plugin {
  const allowedRoots = (options.allowedRoots ?? [process.cwd()]).map((p) =>
    path.resolve(p),
  );

  function isAllowed(target: string): boolean {
    const abs = path.resolve(target);
    return allowedRoots.some((root) => {
      const rel = path.relative(root, abs);
      return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
    });
  }

  return {
    name: "fh-file-bridge",
    configureServer(server) {
      server.middlewares.use("/api/file", async (req, res) => {
        try {
          const url = new URL(req.url ?? "", "http://localhost");
          const filePath = url.searchParams.get("path");
          if (!filePath) {
            res.statusCode = 400;
            res.end("missing ?path=");
            return;
          }
          const abs = path.resolve(filePath);
          if (!isAllowed(abs)) {
            res.statusCode = 403;
            res.end(`path not under an allowed root: ${abs}`);
            return;
          }

          if (req.method === "GET") {
            try {
              const content = await fs.readFile(abs, "utf-8");
              res.setHeader("Content-Type", "application/json");
              res.end(content);
            } catch (err: unknown) {
              const code = (err as NodeJS.ErrnoException).code;
              res.statusCode = code === "ENOENT" ? 404 : 500;
              res.end(code ?? "read failed");
            }
            return;
          }

          if (req.method === "PUT" || req.method === "POST") {
            const chunks: Buffer[] = [];
            for await (const chunk of req) chunks.push(chunk as Buffer);
            const body = Buffer.concat(chunks).toString("utf-8");
            await fs.writeFile(abs, body, "utf-8");
            res.statusCode = 204;
            res.end();
            return;
          }

          res.statusCode = 405;
          res.setHeader("Allow", "GET, PUT");
          res.end("method not allowed");
        } catch (err: unknown) {
          res.statusCode = 500;
          res.end(err instanceof Error ? err.message : String(err));
        }
      });
    },
  };
}
