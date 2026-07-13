// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// Stage 0 of the deployment pipeline (docs/deployment-pipeline.md): extract the
// binding SURFACE a workflow demands — which resource ids must be bound, and of
// what kind — from the workflow content alone. This is the language-neutral
// requirement analysis every deploy path (OSS CLI, backend) shares.

import type { Workflow } from "../workflow";

// The binding kind a workflow resource must be bound with — the discriminator of
// the deployment api's ResourceBindingRequest.
//
// CROSS-LANGUAGE SEAM: these string values MUST match the backend's
// deploy.BindingRequirement constants (fh-backend deploy.WorkflowBindingRequirements),
// which are themselves the ResourceBindingRequest discriminators
// ("hardware"/"mqtt"/"camera"/"declaredModel"/"mlInference"/"catalogModel"/"rag").
// A value that drifts here silently disagrees with the backend about what a
// workflow needs bound.
//
// One deliberate asymmetry with the backend today: "rag" is absent. OSS is behind
// on retrieval — it does not yet extract a VectorDatabase memory resource as a
// requirement (the backend emits "rag"). A standalone engine has no retriever, so
// such a workflow is refused at deploy; add "rag" here when the OSS engine gains a
// retrieval backing.
export type BindingKind = "hardware" | "mqtt" | "camera" | "declaredModel" | "mlInference" | "catalogModel";

// Drift sentinel: a new ChannelType breaks compilation here until it is
// classified in workflowBindingRequirements' channel switch.
function assertNeverChannel(t: never): never {
  throw new Error(`unhandled channel type: ${String(t)}`);
}

// Drift sentinel: a new ModelType breaks compilation here until it is classified
// in workflowBindingRequirements' model switch.
function assertNeverModel(t: never): never {
  throw new Error(`unhandled model type: ${String(t)}`);
}

// workflowBindingRequirements returns the resources a deploy must bind, keyed by
// workflow logical id — the binding surface. The TS twin of the backend's
// deploy.WorkflowBindingRequirements: both must derive the SAME id->kind map from
// the same workflow, or an OSS deploy and a backend deploy disagree about what
// needs binding.
//
// The surface is neither the declared set nor a subset of it:
//  - LOG channels and MemoryFile bind nothing — declared, but out.
//  - referenced catalog models bind a provider yet are node references, not
//    declarations — undeclared, but in.
//
// Pure — reads workflow content alone: no operator input, no model catalog.
export function workflowBindingRequirements(workflow: Workflow): Record<string, BindingKind> {
  const reqs: Record<string, BindingKind> = {};

  for (const channel of Object.values(workflow.channels)) {
    switch (channel.type) {
      case "GPIOIN":
      case "GPIOOUT":
      case "ADC":
      case "DAC":
      case "PWM":
      case "UART":
        reqs[channel.id] = "hardware";
        break;
      case "MQTT":
        reqs[channel.id] = "mqtt";
        break;
      case "CAMERA":
        reqs[channel.id] = "camera";
        break;
      case "LOG":
        // Resolves to the ambient engine logger — no platform resource to bind.
        break;
      default:
        return assertNeverChannel(channel.type);
    }
  }

  // Every declared model needs a source binding, but of a different kind by family:
  // an LLMModel binds a model source ("declaredModel"); an MLModel is served by an
  // ml-inference component ("mlInference"). Mirrors the backend's workflowModelIDs
  // split — both sides must agree on which kind each declared model gets.
  for (const model of Object.values(workflow.models)) {
    switch (model.type) {
      case "LLMModel":
        reqs[model.id] = "declaredModel";
        break;
      case "MLModel":
        reqs[model.id] = "mlInference";
        break;
      default:
        return assertNeverModel(model.type);
    }
  }

  // Catalog models: referenced by an Agent node but not declared. Keyed by model
  // id (canonical, matching the backend surface) — not collapsed to providers
  // here. getReferencedCatalogModelIds already excludes declared ids, so this
  // never overwrites a declaredModel entry.
  for (const id of getReferencedCatalogModelIds(workflow)) reqs[id] = "catalogModel";

  return reqs;
}

/**
 * Model ids that Agent nodes reference but the workflow does not declare in
 * `models` - the catalog models a deploy must bind a provider for.
 */
export function getReferencedCatalogModelIds(workflow: Workflow): string[] {
  const declared = new Set(Object.keys(workflow.models));
  const catalogIds = new Set<string>();

  for (const canvas of Object.values(workflow.canvases)) {
    for (const node of canvas.nodes) {
      if (node.type !== "Agent") continue;
      const id = node.arguments.model;
      if (id !== "" && !declared.has(id)) catalogIds.add(id);
    }
  }

  return [...catalogIds];
}
