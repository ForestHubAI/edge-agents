// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  COMPONENT_CONFIG_PATH,
  COMPONENT_SECRETS_PATH,
  COMPONENT_WORKSPACE_PATH,
  ENGINE_COMPONENT_NAME,
  CAMERA_COMPONENT_NAME,
  ML_COMPONENT_NAME,
  LLAMA_COMPONENT_NAME,
  LLAMA_COMPONENT_PORT,
  CAMERA_COMPONENT_PORT,
  ML_COMPONENT_PORT,
} from "@foresthubai/workflow-core/deploy";

// Drift guard: the workflow-core path + identity constants must equal
// contract/component-constants.json — the language-neutral source of truth shared
// with the Go and Python twins. Editing one side without the JSON turns this red.
// Lives here (not in node-free workflow-core) because it reads the file from disk.
const here = dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(readFileSync(join(here, "..", "..", "..", "..", "contract", "component-constants.json"), "utf8")) as {
  paths: { configFile: string; secretsFile: string; workspace: string };
  components: {
    engine: { name: string };
    camera: { name: string; port: number };
    mlInference: { name: string; port: number };
    llama: { name: string; port: number };
  };
};

describe("component-constants contract", () => {
  it("config path matches the contract", () => {
    expect(COMPONENT_CONFIG_PATH).toBe(contract.paths.configFile);
  });
  it("secrets path matches the contract", () => {
    expect(COMPONENT_SECRETS_PATH).toBe(contract.paths.secretsFile);
  });
  it("workspace path matches the contract", () => {
    expect(COMPONENT_WORKSPACE_PATH).toBe(contract.paths.workspace);
  });
  it("engine identity matches the contract", () => {
    expect(ENGINE_COMPONENT_NAME).toBe(contract.components.engine.name);
  });
  it("camera identity matches the contract", () => {
    expect(CAMERA_COMPONENT_NAME).toBe(contract.components.camera.name);
  });
  it("ml-inference identity matches the contract", () => {
    expect(ML_COMPONENT_NAME).toBe(contract.components.mlInference.name);
  });
  it("llama-server identity matches the contract", () => {
    expect(LLAMA_COMPONENT_NAME).toBe(contract.components.llama.name);
  });
  it("llama-server port matches the contract", () => {
    expect(LLAMA_COMPONENT_PORT).toBe(contract.components.llama.port);
  });
  it("camera port matches the contract", () => {
    expect(CAMERA_COMPONENT_PORT).toBe(contract.components.camera.port);
  });
  it("ml-inference port matches the contract", () => {
    expect(ML_COMPONENT_PORT).toBe(contract.components.mlInference.port);
  });
});
