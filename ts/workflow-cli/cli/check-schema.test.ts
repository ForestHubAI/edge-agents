import { describe, it, expect } from "vitest";
import { validateAgainstContract } from "./check-schema";

// A minimal, schema-valid workflow: all six required top-level fields, one node
// with a correct `type` discriminator. Tests tweak a copy to drive each case.
function validWorkflow() {
  return {
    schemaVersion: 1,
    nodes: [
      {
        id: "t1",
        type: "Ticker",
        position: { x: 0, y: 0 },
        arguments: { intervalValue: 15, intervalUnit: "seconds" },
      },
    ],
    edges: [],
    functions: [],
    declaredVariables: [],
    channels: [],
    memory: [],
    models: [],
  };
}

describe("validateAgainstContract", () => {
  it("accepts a schema-valid workflow", () => {
    const { ok, errors } = validateAgainstContract(validWorkflow());
    expect(ok).toBe(true);
    expect(errors).toEqual([]);
  });

  it("rejects a missing required top-level field", () => {
    const wf = validWorkflow();
    delete (wf as Record<string, unknown>).channels;

    const { ok, errors } = validateAgainstContract(wf);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.keyword === "required" && e.params.missingProperty === "channels")).toBe(true);
  });

  it("rejects a missing required node argument", () => {
    const wf = validWorkflow();
    wf.nodes[0]!.arguments = {} as never; // Ticker requires `intervalUnit`

    const { ok, errors } = validateAgainstContract(wf);
    expect(ok).toBe(false);
    expect(errors.some((e) => e.params.missingProperty === "intervalUnit")).toBe(true);
  });

  it("rejects an unknown node type with a precise discriminator error, not a 21-way pile", () => {
    const wf = validWorkflow();
    wf.nodes[0]!.type = "Bogus";

    const { ok, errors } = validateAgainstContract(wf);
    expect(ok).toBe(false);
    // Exactly one discriminator error pointing at the offending node — proof the
    // `type` tag routed validation instead of trying all 21 branches.
    expect(errors).toHaveLength(1);
    expect(errors[0]!.keyword).toBe("discriminator");
    expect(errors[0]!.instancePath).toBe("/nodes/0");
  });
});
