// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { describe, it, expect } from "vitest";
import { migrate, readSchemaVersion } from "./migrate";
import { CURRENT_SCHEMA_VERSION } from "./version";

describe("readSchemaVersion", () => {
  it("reads an explicit integer version", () => {
    expect(readSchemaVersion({ schemaVersion: 3 })).toBe(3);
  });

  it("defaults missing, non-integer, or out-of-range to the baseline", () => {
    expect(readSchemaVersion({})).toBe(1);
    expect(readSchemaVersion({ schemaVersion: 1.5 })).toBe(1);
    expect(readSchemaVersion({ schemaVersion: 0 })).toBe(1);
    expect(readSchemaVersion({ schemaVersion: "2" })).toBe(1);
  });
});

describe("migrate", () => {
  it("stamps the current version on a baseline document", () => {
    const out = migrate({ nodes: [], edges: [] });
    expect(out.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("passes through a document already at the current version", () => {
    const doc = { schemaVersion: CURRENT_SCHEMA_VERSION, nodes: [] };
    expect(migrate(doc).schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("does not mutate its input", () => {
    const doc: Record<string, unknown> = { nodes: [] };
    migrate(doc);
    expect("schemaVersion" in doc).toBe(false);
  });

  it("rejects a document newer than this build supports", () => {
    expect(() => migrate({ schemaVersion: CURRENT_SCHEMA_VERSION + 1 })).toThrow(/newer than this build/);
  });

  it("rejects a non-object document", () => {
    expect(() => migrate(null)).toThrow(/must be a JSON object/);
    expect(() => migrate([])).toThrow(/must be a JSON object/);
    expect(() => migrate(42)).toThrow(/must be a JSON object/);
  });
});
