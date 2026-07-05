// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { accessSync } from "node:fs";
import { resolveOpenMode } from "./buildmode";
import { startStaticServer } from "../server/staticServer";

/**
 * `fh-workflow open [file.json] [--static|--dev]`
 *
 * Launches the workflow builder in the browser. Two strategies (see
 * {@link resolveOpenMode}):
 *
 * - DEV (in-repo): spawn the Vite dev server against source, with HMR.
 * - STATIC (installed): serve the prebuilt SPA from a plain HTTP server.
 *
 * Either way, when a file is given it's pre-loaded and Save round-trips back to
 * it through the `/api/file` bridge, whose read/write is locked to that file's
 * directory.
 */
export async function openCommand(args: string[]): Promise<void> {
  const filePath = args.find((a) => !a.startsWith("-"));
  const mode = resolveOpenMode(args, process.env);

  let resolvedFile: string | undefined;
  let allowRoot: string | undefined;
  if (filePath) {
    resolvedFile = path.resolve(process.cwd(), filePath);
    allowRoot = path.dirname(resolvedFile);
  }

  if (mode === "static") {
    await openStatic(resolvedFile, allowRoot);
  } else {
    await openDev(resolvedFile, allowRoot);
  }
}

/**
 * STATIC: serve the bundled SPA (`<pkg>/dist`, a sibling of this file's `dist-cli`)
 * plus the file bridge from a Node HTTP server on an ephemeral port, then open
 * the browser. No Vite, no source.
 */
async function openStatic(resolvedFile?: string, allowRoot?: string): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const spaRoot = path.resolve(here, "..", "dist");
  if (!tryAccess(path.join(spaRoot, "index.html"))) {
    process.stderr.write(`Built SPA not found at ${spaRoot}. This package is missing its bundled assets.\n`);
    process.exit(1);
  }

  const allowedRoots = [allowRoot ?? process.cwd()];
  const { port } = await startStaticServer({ spaRoot, allowedRoots });
  const url = resolvedFile
    ? `http://localhost:${port}/?file=${encodeURIComponent(resolvedFile)}`
    : `http://localhost:${port}/`;

  process.stdout.write(`\nfh-workflow running at ${url}\n`);
  if (resolvedFile) process.stdout.write(`Bound to ${resolvedFile}\n`);
  process.stdout.write("Press Ctrl+C to stop.\n\n");
  openInBrowser(url);

  // The listening server keeps the event loop alive; block until Ctrl+C.
  await new Promise<never>(() => {});
}

/**
 * DEV: spawn Vite as a child process (NOT via createServer in-process — Vite's
 * config loader fights with the tsx loader powering this CLI), wait for the dev
 * server, then open the browser. Narrows the bridge's allowlist to the bound
 * file's directory via FH_BUILDER_ALLOW_ROOT.
 */
async function openDev(resolvedFile?: string, allowRoot?: string): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const appRoot = path.resolve(here, "..");

  const env: NodeJS.ProcessEnv = { ...process.env };
  if (allowRoot) env.FH_BUILDER_ALLOW_ROOT = allowRoot;

  const port = 5173;
  const url = resolvedFile
    ? `http://localhost:${port}/?file=${encodeURIComponent(resolvedFile)}`
    : `http://localhost:${port}/`;

  const viteBin = locateViteBin(appRoot);
  // --no-open: this CLI is the sole opener — it builds the `?file=` URL and
  // opens it below. Without this, vite.config's `server.open: true` would also
  // open a tab, at the bare URL (no ?file=), so you'd get two tabs and the
  // wrong one focused. (CLI flag overrides config; `dev` still auto-opens.)
  const vite = spawn(viteBin, ["--port", String(port), "--host", "127.0.0.1", "--strictPort", "--no-open"], {
    cwd: appRoot,
    env,
    stdio: "inherit",
    shell: process.platform === "win32", // .cmd shims need a shell on Windows
  });

  vite.on("error", (err) => {
    process.stderr.write(`Failed to start vite: ${err.message}\n`);
    process.exit(1);
  });

  // Poll until the port answers, then open the browser. Bounded so we don't
  // hang forever if vite never starts.
  void (async () => {
    const ok = await waitForPort(port, 15000);
    if (!ok) {
      process.stderr.write("Vite didn't come up within 15s.\n");
      return;
    }
    process.stdout.write(`\nfh-workflow running at ${url}\n`);
    if (resolvedFile) process.stdout.write(`Bound to ${resolvedFile}\n`);
    process.stdout.write("Press Ctrl+C to stop.\n\n");
    openInBrowser(url);
  })();

  // Keep our process alive until vite exits (stdio is inherited, so Ctrl+C
  // goes straight to vite which then exits, then we exit).
  await new Promise<void>((resolve) => {
    vite.on("exit", (code) => {
      process.exit(code ?? 0);
      resolve();
    });
  });
}

function locateViteBin(appRoot: string): string {
  const cmd = process.platform === "win32" ? "vite.cmd" : "vite";
  // Hoisted to the workspace root in npm workspaces; check both.
  const local = path.resolve(appRoot, "node_modules", ".bin", cmd);
  const hoisted = path.resolve(appRoot, "..", "node_modules", ".bin", cmd);
  return tryAccess(local) ? local : hoisted;
}

function tryAccess(p: string): boolean {
  try {
    accessSync(p);
    return true;
  } catch {
    return false;
  }
}

async function waitForPort(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { method: "HEAD" });
      // Any HTTP response means vite's listening.
      if (res) return true;
    } catch {
      // Connection refused — keep waiting.
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  return false;
}

function openInBrowser(url: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    // `start` is a cmd builtin; the empty first arg is the window title slot,
    // which start would otherwise grab from a quoted URL.
    spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  const command = platform === "darwin" ? "open" : "xdg-open";
  spawn(command, [url], { detached: true, stdio: "ignore" }).unref();
}
