import type { IncomingMessage, ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * The disk read/write the workflow SPA needs, factored out of any server. Both
 * the Vite dev plugin (`plugins/filebridge.ts`) and the standalone static server
 * (`server/staticServer.ts`) drive the SAME handler, so the security boundary —
 * the {@link isAllowed} traversal guard — lives in exactly one place.
 *
 *   GET  /api/file?path=foo.json  → 200 {contents} | 404 if missing
 *   PUT  /api/file?path=foo.json  → 204 (body written verbatim)
 *
 * Paths must resolve under one of `allowedRoots`; anything else returns 403.
 */

/** True if `target` resolves inside one of `roots` (no `..` escape). */
export function isAllowed(target: string, roots: string[]): boolean {
  const abs = path.resolve(target);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), abs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

/**
 * Handle an `/api/file` request. Returns `true` if it took ownership of the
 * response (any `/api/file` request, handled or rejected), `false` to let the
 * caller fall through — so the static server can serve SPA assets on every other
 * path. Reads `?path=` from the FULL url and checks the pathname itself, so the
 * dev (mounted) and static (unmounted) servers parse requests identically.
 */
export async function handleFileRequest(
  req: IncomingMessage,
  res: ServerResponse,
  allowedRoots: string[],
): Promise<boolean> {
  const url = new URL(req.url ?? "", "http://localhost");
  if (url.pathname !== "/api/file") return false;

  try {
    const filePath = url.searchParams.get("path");
    if (!filePath) {
      res.statusCode = 400;
      res.end("missing ?path=");
      return true;
    }
    const abs = path.resolve(filePath);
    if (!isAllowed(abs, allowedRoots)) {
      res.statusCode = 403;
      res.end(`path not under an allowed root: ${abs}`);
      return true;
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
      return true;
    }

    if (req.method === "PUT" || req.method === "POST") {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks).toString("utf-8");
      await fs.writeFile(abs, body, "utf-8");
      res.statusCode = 204;
      res.end();
      return true;
    }

    res.statusCode = 405;
    res.setHeader("Allow", "GET, PUT");
    res.end("method not allowed");
    return true;
  } catch (err: unknown) {
    res.statusCode = 500;
    res.end(err instanceof Error ? err.message : String(err));
    return true;
  }
}
