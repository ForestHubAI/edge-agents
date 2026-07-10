// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { describe, it, expect, vi, beforeEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The custom-components loop prompts interactively; mock the prompt lib. The
// non-interactive resolveComponentEnv tests below never reach these.
vi.mock("@inquirer/prompts", () => ({
  confirm: vi.fn(),
  input: vi.fn(),
  password: vi.fn(),
}));

import { confirm, input } from "@inquirer/prompts";
import {
  parseDeployComponents,
  parseEnvExample,
  promptCustomComponents,
  resolveComponentEnv,
  validateComponent,
} from "./components";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");

const ok = (data: unknown) => parseDeployComponents([{ source: "test", data }]);

describe("parseDeployComponents", () => {
  it("accepts a minimal valid component", () => {
    expect(ok({ name: "grafana", image: "grafana/grafana:11.3.0" })).toHaveLength(1);
  });

  it("rejects a missing required field, naming it", () => {
    expect(() => ok({ name: "a" })).toThrow(/image/);
    expect(() => ok({ image: "b" })).toThrow(/name/);
  });

  it("rejects a wrong type (ports must be an array)", () => {
    expect(() => ok({ name: "a", image: "b", ports: "3000:3000" })).toThrow(/ports/);
  });

  it("rejects an unknown or misspelled key, naming it", () => {
    expect(() => ok({ name: "a", image: "b", dvices: [] })).toThrow(/dvices/);
    expect(() => ok({ name: "a", image: "b", testing: true })).toThrow(/testing/);
  });

  it("leaves the config blob's own keys free", () => {
    expect(ok({ name: "a", image: "b", config: { anything: { deeply: 1 }, x: "y" } })).toHaveLength(1);
  });

  it("accepts a valid pull policy and rejects an out-of-enum one", () => {
    expect(ok({ name: "a", image: "b", pull: "never" })).toHaveLength(1);
    expect(() => ok({ name: "a", image: "b", pull: "sometimes" })).toThrow(/pull/);
  });

  it("collects errors across every component before throwing", () => {
    let message = "";
    try {
      parseDeployComponents([
        { source: "one", data: { name: "a" } },
        { source: "two", data: { image: "b", bogus: 1 } },
      ]);
    } catch (err) {
      message = err instanceof Error ? err.message : String(err);
    }
    expect(message).toContain("one");
    expect(message).toContain("two");
  });

  it("validates the bundled grafana example (self-test)", async () => {
    const raw = await fs.readFile(path.join(repoRoot, "components/grafana/component.json"), "utf-8");
    expect(ok(JSON.parse(raw))).toHaveLength(1);
  });
});

describe("validateComponent", () => {
  it("returns no errors for a valid component", () => {
    expect(validateComponent({ name: "a", image: "b" })).toEqual([]);
  });
  it("names a missing required field", () => {
    expect(validateComponent({ name: "a" }).join(" ")).toMatch(/image/);
  });
  it("names an unknown key", () => {
    expect(validateComponent({ name: "a", image: "b", oops: 1 }).join(" ")).toMatch(/oops/);
  });
});

describe("promptCustomComponents", () => {
  beforeEach(() => vi.resetAllMocks());

  const withDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhcomp-"));
    try {
      await fn(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };
  const quiet = () => vi.spyOn(process.stdout, "write").mockReturnValue(true);

  it("adds nothing when the operator declines the gate", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    const out = quiet();
    const result = await promptCustomComponents([]);
    out.mockRestore();
    expect(result).toEqual({ components: [], env: {} });
  });

  it("keeps a preloaded component and resolves its env", async () => {
    vi.mocked(confirm).mockResolvedValue(false);
    await withDir(async (dir) => {
      await fs.writeFile(path.join(dir, "grafana.env.example"), "GF_USER=admin\n");
      const out = quiet();
      const result = await promptCustomComponents([{ component: { name: "grafana", image: "g" }, dir }]);
      out.mockRestore();
      expect(result.components).toEqual([{ name: "grafana", image: "g" }]);
      expect(result.env.grafana).toContain("GF_USER=admin");
    });
  });

  it("adds a component entered in the loop", async () => {
    await withDir(async (dir) => {
      await fs.writeFile(path.join(dir, "component.json"), JSON.stringify({ name: "extra", image: "e" }));
      vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(input).mockResolvedValue(dir);
      const out = quiet();
      const result = await promptCustomComponents([]);
      out.mockRestore();
      expect(result.components).toEqual([{ name: "extra", image: "e" }]);
    });
  });

  it("validates the entered folder at the prompt (path, contract, dedup)", async () => {
    await withDir(async (dir) => {
      await fs.writeFile(path.join(dir, "component.json"), JSON.stringify({ name: "extra", image: "e" }));
      vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
      vi.mocked(input).mockResolvedValue(dir);
      const out = quiet();
      await promptCustomComponents([]);
      out.mockRestore();

      // Pull the recorded folder-prompt validator and exercise its branches. "extra"
      // is in the seen set now, so re-entering the same folder is rejected.
      const arg = vi.mocked(input).mock.calls[0]?.[0] as { validate: (v: string) => Promise<string | boolean> };
      expect(await arg.validate("")).toMatch(/enter a folder/);
      expect(await arg.validate(path.join(dir, "nope"))).toMatch(/folder not found/);
      expect(await arg.validate(dir)).toMatch(/already added/);
    });
  });
});

describe("parseEnvExample", () => {
  it("splits lines into ordered kv and comment entries", () => {
    const entries = parseEnvExample("# header\nA=1\nB=\n\nC=hi there");
    expect(entries).toEqual([
      { kind: "comment", text: "# header" },
      { kind: "kv", key: "A", value: "1" },
      { kind: "kv", key: "B", value: "" },
      { kind: "comment", text: "" },
      { kind: "kv", key: "C", value: "hi there" },
    ]);
  });
});

describe("resolveComponentEnv (non-interactive)", () => {
  const withDir = async (fn: (dir: string) => Promise<void>) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "fhcomp-"));
    try {
      await fn(dir);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  };

  it("takes filled values, stubs empty ones, keeps comments and a header", async () => {
    await withDir(async (dir) => {
      await fs.writeFile(path.join(dir, "grafana.env.example"), "# note\nGF_USER=admin\nGF_PASSWORD=\n");
      const text = await resolveComponentEnv(dir, "grafana", { interactive: false });
      expect(text).not.toBeNull();
      expect(text).toContain("# note");
      expect(text).toContain("GF_USER=admin");
      expect(text).toContain("GF_PASSWORD=");
      expect(text).toContain("Auto-generated");
    });
  });

  it("returns null when the component ships no env example", async () => {
    await withDir(async (dir) => {
      expect(await resolveComponentEnv(dir, "grafana", { interactive: false })).toBeNull();
    });
  });
});
