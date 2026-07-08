// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// Domain Model — covers two distinct things that share a picker:
//   1. The STATIC catalog (ModelInfo[]): the set of models the llmproxy already
//      supports. Supplied to the editor as data (props), not declared per-workflow.
//      A node simply stores the chosen catalog ModelID directly.
//   2. DECLARED custom models (Model): self-hosted / custom models the
//      llmproxy doesn't ship. These are channel-like — declared in the workflow,
//      referenced by id from nodes, and mapped to an llmproxy provider at deploy.
//
// A node's `model` field is always just a ModelID string either way; static ids
// resolve via the catalog (no mapping), custom ids via a declared Model.
//
// `type` is the api discriminator; new model families (e.g. future YOLO/ONNX
// variants) register their own definition in ModelRegistry, mirroring nodes.

import type { Schemas } from "../api";

/** A capability a model supports (chat, embedding, vision, ...). From the api. */
export type ModelCapability = Schemas["ModelCapability"];

export type ModelType = "LLMModel";

export const ALL_MODEL_TYPES: ModelType[] = ["LLMModel"];

export interface Model {
  id: string;
  label: string;
  type: ModelType;
  arguments: Record<string, unknown>;
}

/**
 * One entry in the static model catalog handed to the builder via props. The
 * embedder maps the llmproxy's richer ModelInfo down to this minimal shape.
 */
export interface ModelInfo {
  id: string;
  label: string;
  capabilities: ModelCapability[];
  // Catalog provider that serves this model (e.g. "anthropic"). The deploy
  // resolver reads it to emit one ExternalResources provider entry per distinct
  // provider a workflow's Agent nodes reference. Mirrors llmproxy ModelInfo.provider.
  provider: string;
}
