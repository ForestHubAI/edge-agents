import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { accessSync } from "node:fs";

/**
 * `fh-builder open [file.json]`
 *
 * Launches Vite as a child process (NOT via createServer in-process) so
 * Vite's config loader doesn't fight with tsx's loader, which is what's
 * powering this CLI. Then waits for the dev server to be ready and opens
 * the default browser.
 *
 * When a file is given, the bridge's allowlist is narrowed to just that
 * file's directory via FH_BUILDER_ALLOW_ROOT.
 */
export async function openCommand(filePath?: string): Promise<void> {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const playgroundRoot = path.resolve(__dirname, "..");

  const env: NodeJS.ProcessEnv = { ...process.env };
  let resolvedFile: string | undefined;
  if (filePath) {
    resolvedFile = path.resolve(process.cwd(), filePath);
    env.FH_BUILDER_ALLOW_ROOT = path.dirname(resolvedFile);
  }

  const port = 5173;
  const url = resolvedFile
    ? `http://localhost:${port}/?file=${encodeURIComponent(resolvedFile)}`
    : `http://localhost:${port}/`;

  const viteBin = locateViteBin(playgroundRoot);
  const vite = spawn(viteBin, ["--port", String(port), "--host", "127.0.0.1", "--strictPort"], {
    cwd: playgroundRoot,
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
    process.stdout.write(`\nfh-builder running at ${url}\n`);
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

function locateViteBin(playgroundRoot: string): string {
  const cmd = process.platform === "win32" ? "vite.cmd" : "vite";
  // Hoisted to the workspace root in npm workspaces; check both.
  const local = path.resolve(playgroundRoot, "node_modules", ".bin", cmd);
  const hoisted = path.resolve(playgroundRoot, "..", "node_modules", ".bin", cmd);
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
