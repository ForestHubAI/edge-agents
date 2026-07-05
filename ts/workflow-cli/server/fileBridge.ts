// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

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
 * Only loopback traffic is accepted: a non-loopback Host defeats DNS rebinding,
 * a non-loopback Origin defeats CSRF from other pages in the same browser, and
 * POST (the one write method browsers send without a preflight) is not offered.
 */

/** True if `target` resolves inside one of `roots` (no `..` escape). */
export function isAllowed(target: string, roots: string[]): boolean {
  const abs = path.resolve(target);
  return roots.some((root) => {
    const rel = path.relative(path.resolve(root), abs);
    return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
  });
}

/** True if a Host header or URL hostname is a loopback name ("localhost", "127.0.0.1", "[::1]"), with or without port. */
function isLoopbackHost(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "[::1]";
}

/**
 * True if the request is plainly same-machine browser traffic (or a
 * non-browser client like curl, which sends no Origin). The server binds
 * 127.0.0.1, so a non-loopback Host means the browser was lured here through a
 * DNS name the attacker controls (DNS rebinding); a present-but-non-loopback
 * Origin means another site's page is driving the request (CSRF).
 */
export function isTrustedRequest(req: IncomingMessage): boolean {
  if (!isLoopbackHost(req.headers.host)) return false;
  const origin = req.headers.origin;
  if (origin === undefined) return true;
  try {
    return isLoopbackHost(new URL(origin).host);
  } catch {
    return false;
  }
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

  if (!isTrustedRequest(req)) {
    res.statusCode = 403;
    res.end("forbidden: non-local request");
    return true;
  }

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

    if (req.method === "PUT") {
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
