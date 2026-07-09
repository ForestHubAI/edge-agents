// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { handleFileRequest, isAllowed, isTrustedRequest } from "./fileBridge";

function makeReq(opts: {
  method: string;
  url: string;
  host?: string | null; // null = no Host header at all
  origin?: string;
  body?: string;
}): IncomingMessage {
  const req = Readable.from(opts.body === undefined ? [] : [Buffer.from(opts.body)]) as IncomingMessage;
  req.method = opts.method;
  req.url = opts.url;
  req.headers = {
    ...(opts.host !== null && { host: opts.host ?? "localhost:5173" }),
    ...(opts.origin !== undefined && { origin: opts.origin }),
  };
  return req;
}

function makeRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: unknown) {
      if (chunk !== undefined) this.body = String(chunk);
    },
  };
  return res as typeof res & ServerResponse;
}

describe("isTrustedRequest", () => {
  const trusted = [
    { host: "localhost:5173" },
    { host: "127.0.0.1:8080" },
    { host: "[::1]:8080" },
    { host: "localhost:5173", origin: "http://localhost:5173" },
    { host: "localhost:5173", origin: "http://127.0.0.1:5173" },
  ];
  it.each(trusted)("accepts loopback traffic %o", (headers) => {
    expect(isTrustedRequest(makeReq({ method: "GET", url: "/api/file", ...headers }))).toBe(true);
  });

  const untrusted = [
    { host: "attacker.example:5173" }, // DNS rebinding: name resolves to 127.0.0.1
    { host: "localhost.evil.com:5173" },
    { host: "localhost:5173", origin: "https://evil.example" }, // CSRF from another site
    { host: "localhost:5173", origin: "null" },
    { host: null },
  ];
  it.each(untrusted)("rejects non-local traffic %o", (headers) => {
    expect(isTrustedRequest(makeReq({ method: "GET", url: "/api/file", ...headers }))).toBe(false);
  });
});

describe("handleFileRequest", () => {
  let root: string;
  let file: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "fh-bridge-"));
    file = path.join(root, "wf.json");
    await writeFile(file, '{"a":1}');
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const fileUrl = () => `/api/file?path=${encodeURIComponent(file)}`;

  it("ignores non-bridge paths", async () => {
    const res = makeRes();
    expect(await handleFileRequest(makeReq({ method: "GET", url: "/assets/x.js" }), res, [root])).toBe(false);
  });

  it("round-trips GET and PUT for a local request", async () => {
    const getRes = makeRes();
    await handleFileRequest(makeReq({ method: "GET", url: fileUrl() }), getRes, [root]);
    expect(getRes.body).toBe('{"a":1}');

    const putRes = makeRes();
    await handleFileRequest(makeReq({ method: "PUT", url: fileUrl(), body: '{"a":2}' }), putRes, [root]);
    expect(putRes.statusCode).toBe(204);
    expect(await readFile(file, "utf-8")).toBe('{"a":2}');
  });

  it("rejects a rebound Host with 403 before touching the path", async () => {
    const res = makeRes();
    await handleFileRequest(makeReq({ method: "GET", url: fileUrl(), host: "evil.example:80" }), res, [root]);
    expect(res.statusCode).toBe(403);
  });

  it("rejects a cross-origin PUT with 403 and leaves the file untouched", async () => {
    const res = makeRes();
    await handleFileRequest(
      makeReq({ method: "PUT", url: fileUrl(), origin: "https://evil.example", body: "clobbered" }),
      res,
      [root],
    );
    expect(res.statusCode).toBe(403);
    expect(await readFile(file, "utf-8")).toBe('{"a":1}');
  });

  it("does not accept POST (browser no-preflight write)", async () => {
    const res = makeRes();
    await handleFileRequest(makeReq({ method: "POST", url: fileUrl(), body: "clobbered" }), res, [root]);
    expect(res.statusCode).toBe(405);
    expect(await readFile(file, "utf-8")).toBe('{"a":1}');
  });

  it("rejects paths outside allowedRoots with 403", async () => {
    const outside = path.join(tmpdir(), "fh-bridge-outside.json");
    const res = makeRes();
    await handleFileRequest(
      makeReq({ method: "PUT", url: `/api/file?path=${encodeURIComponent(outside)}`, body: "x" }),
      res,
      [root],
    );
    expect(res.statusCode).toBe(403);
  });
});

describe("isAllowed", () => {
  it("blocks .. traversal escapes", () => {
    expect(isAllowed("/tmp/root/../etc/passwd", ["/tmp/root"])).toBe(false);
    expect(isAllowed("/tmp/root/sub/wf.json", ["/tmp/root"])).toBe(true);
  });
});
