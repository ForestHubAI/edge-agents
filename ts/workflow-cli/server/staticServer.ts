import { createServer } from "node:http";
import { promises as fs } from "node:fs";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { handleFileRequest } from "./fileBridge";

export interface StaticServerOptions {
  /** Directory of the prebuilt SPA (index.html + assets/…). */
  spaRoot: string;
  /** Directories the `/api/file` bridge may read/write. */
  allowedRoots: string[];
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

/**
 * Serve the prebuilt builder SPA plus the `/api/file` bridge from a plain Node
 * server — the installed (no-Vite) counterpart to the dev server. Binds an
 * ephemeral port on 127.0.0.1 and resolves with the chosen port.
 *
 * Request order: bridge first (so `/api/file` round-trips to disk), then static
 * assets, then an SPA fallback to `index.html`. Genuinely-missing `/assets/*`
 * 404 rather than falling back, so a bad asset never gets served as HTML.
 */
export async function startStaticServer(opts: StaticServerOptions): Promise<{ port: number }> {
  const spaRoot = path.resolve(opts.spaRoot);
  const indexHtml = path.join(spaRoot, "index.html");

  const server = createServer((req, res) => {
    void (async () => {
      if (await handleFileRequest(req, res, opts.allowedRoots)) return;

      const url = new URL(req.url ?? "/", "http://localhost");
      const pathname = decodeURIComponent(url.pathname);

      // Resolve under spaRoot; reject any traversal escape.
      const target = path.resolve(spaRoot, "." + pathname);
      const rel = path.relative(spaRoot, target);
      if (rel.startsWith("..") || path.isAbsolute(rel)) {
        res.statusCode = 403;
        res.end("forbidden");
        return;
      }

      const isAssetPath = pathname.startsWith("/assets/");
      const served = await serveFile(res, pathname === "/" ? indexHtml : target);
      if (served) return;

      // Real asset misses are 404s; anything else is an SPA route → index.html.
      if (isAssetPath) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      if (!(await serveFile(res, indexHtml))) {
        res.statusCode = 404;
        res.end("not found");
      }
    })();
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port });
    });
  });
}

/** Write `file` to the response with a guessed content type. Returns false if it doesn't exist. */
async function serveFile(res: ServerResponseLike, file: string): Promise<boolean> {
  try {
    const content = await fs.readFile(file);
    res.setHeader("Content-Type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    res.end(content);
    return true;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return false;
    res.statusCode = 500;
    res.end((err as NodeJS.ErrnoException).code ?? "read failed");
    return true;
  }
}

// Minimal structural type so this helper isn't tied to the full http types.
type ServerResponseLike = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: unknown): void;
};
