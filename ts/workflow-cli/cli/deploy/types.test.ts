import { describe, it, expect } from "vitest";
import { ggufNameError } from "./types";

describe("ggufNameError", () => {
  it("accepts a plain .gguf filename, trimmed and case-insensitive", () => {
    expect(ggufNameError("model.gguf")).toBeNull();
    expect(ggufNameError("  Model.GGUF  ")).toBeNull();
  });

  it("rejects an empty or missing name", () => {
    expect(ggufNameError("")).toMatch(/required/);
    expect(ggufNameError("   ")).toMatch(/required/);
    expect(ggufNameError(undefined)).toMatch(/required/);
  });

  it("rejects a non-.gguf extension", () => {
    expect(ggufNameError("asdasds")).toMatch(/\.gguf/);
    expect(ggufNameError("model.bin")).toMatch(/\.gguf/);
  });

  it("rejects a path — only a bare filename belongs in ./models/", () => {
    expect(ggufNameError("sub/model.gguf")).toMatch(/path/);
  });
});
