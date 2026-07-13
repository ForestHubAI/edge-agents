// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// Stage 0 of the deployment pipeline (docs/deployment-pipeline.md): extract the
// binding SURFACE a workflow demands — which resource ids must be bound, and of
// what kind — from the workflow content alone. This is the language-neutral
// requirement analysis every deploy path (OSS CLI, backend) shares.

import type { Workflow } from "../workflow";
import { getReferencedCatalogModelIds } from "./requirements";

// The binding kind a workflow resource must be bound with — the discriminator of
// the deployment api's ResourceBindingRequest.
//
// CROSS-LANGUAGE SEAM: these string values MUST match the backend's
// deploy.BindingRequirement constants (fh-backend deploy.WorkflowBindingRequirements),
// which are themselves the ResourceBindingRequest discriminators
// ("hardware"/"mqtt"/"declaredModel"/"catalogModel"/"rag"). A value that drifts
// here silently disagrees with the backend about what a workflow needs bound.
//
// Two deliberate asymmetries with the backend today, each a known catch-up:
//  - "camera" is OSS-ahead: the backend's extractor predates the CAMERA channel
//    and has no camera binding kind yet. OSS emits it; the backend will add it.
//  - "rag" is absent: OSS is behind on retrieval — it does not yet extract a
//    VectorDatabase memory resource as a requirement (the backend emits "rag").
//    Add it when the OSS engine gains a retrieval backing.
export type BindingKind = "hardware" | "mqtt" | "camera" | "declaredModel" | "catalogModel";

// Drift sentinel: a new ChannelType breaks compilation here until it is
// classified in workflowBindingRequirements' switch.
function assertNeverChannel(t: never): never {
  throw new Error(`unhandled channel type: ${String(t)}`);
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

  // Every declared model needs a source binding, LLM and ML alike. The surface
  // does not distinguish the family — that split is a Stage-1 resolver concern.
  // Mirrors the backend keying every declared model as "declaredModel".
  for (const model of Object.values(workflow.models)) reqs[model.id] = "declaredModel";

  // Catalog models: referenced by an Agent node but not declared. Keyed by model
  // id (canonical, matching the backend surface) — not collapsed to providers
  // here. getReferencedCatalogModelIds already excludes declared ids, so this
  // never overwrites a declaredModel entry.
  for (const id of getReferencedCatalogModelIds(workflow)) reqs[id] = "catalogModel";

  return reqs;
}
