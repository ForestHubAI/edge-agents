// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// Stage 0 of the deployment pipeline (docs/deployment-pipeline.md): extract the
// binding SURFACE a workflow demands — which resource ids must be bound, and of
// what kind — from the workflow content alone. This is the language-neutral
// requirement analysis every deploy path (OSS CLI, backend) shares.

import type { Workflow } from "../workflow";

// The binding kind a requirement must be bound with.
// These string values are a cross-language seam and must match the
// backend's deploy.ResourceBinding discriminators.
export type BindingKind = "hardware" | "mqtt" | "declaredLlm" | "catalogLlm" | "ml" | "rag";

// The physical driver family behind a `hardware` requirement. Sub-discriminates
// `hardware` because the families do not share a uniqueness shape
export type HardwareFamily = "gpio" | "adc" | "dac" | "pwm" | "serial" | "camera";

// A single resource a deploy must bind and carrier of uniquness constraints for that bind.
// WORKFLOW facts (`kind`, `family`, `topic`, catalog `model`) are set when
// the requirement is derived; DEPLOYMENT facts (`ref`, `index`, served `model`)
// start `null` and the consumer fills them from its binding before running `bindingConflicts`.
export type Requirement =
  | { kind: "hardware"; family: HardwareFamily; ref: string | null; index: number | null }
  | { kind: "mqtt"; ref: string | null; topic: string }
  | { kind: "declaredLlm"; model: string | null }
  | { kind: "catalogLlm"; model: string }
  | { kind: "ml"; ref: string | null; model: string | null }
  | { kind: "rag"; ref: string | null };

// Channel type -> hardware family. GPIOIN and GPIOOUT share the pin space, so both
// are `gpio`; UART is `serial`; CAMERA is `camera`.
function hardwareFamily(type: "GPIOIN" | "GPIOOUT" | "ADC" | "DAC" | "PWM" | "UART" | "CAMERA"): HardwareFamily {
  switch (type) {
    case "GPIOIN":
    case "GPIOOUT":
      return "gpio";
    case "ADC":
      return "adc";
    case "DAC":
      return "dac";
    case "PWM":
      return "pwm";
    case "UART":
      return "serial";
    case "CAMERA":
      return "camera";
  }
}

// workflowBindingRequirements returns the resources a deploy must bind, keyed by
// workflow logical id — the binding surface. The TS twin of the backend's
// deploy.WorkflowBindingRequirements: both must derive the SAME id->Requirement map
// from the same workflow, or an OSS deploy and a backend deploy disagree about what
// needs binding. Deployment fields (`ref`/`index`/served `model`) come back `null`
// — the caller fills them from its own binding representation.
//
// The surface is neither the declared set nor a subset of it:
//  - LOG channels and MemoryFile bind nothing — declared, but out.
//  - referenced catalog models bind a provider yet are node references, not
//    declarations — undeclared, but in.
//
// Pure — reads workflow content alone: no operator input, no model catalog.
export function workflowBindingRequirements(workflow: Workflow): Record<string, Requirement> {
  const reqs: Record<string, Requirement> = {};

  for (const channel of Object.values(workflow.channels)) {
    switch (channel.type) {
      case "GPIOIN":
      case "GPIOOUT":
      case "ADC":
      case "DAC":
      case "PWM":
      case "UART":
      case "CAMERA":
        reqs[channel.id] = { kind: "hardware", family: hardwareFamily(channel.type), ref: null, index: null };
        break;
      case "MQTT":
        // topic is a workflow fact (the channel's intent), filled now; ref is the
        // deployment binding, filled by the consumer.
        reqs[channel.id] = { kind: "mqtt", ref: null, topic: String(channel.arguments.topic ?? "") };
        break;
      case "LOG":
        // Resolves to the ambient engine logger — no platform resource to bind.
        break;
      default:
        return assertNeverChannel(channel.type);
    }
  }

  // Every declared model needs a source binding, but of a different kind by family:
  // an LLMModel binds a model source ("declaredLlm"); an MLModel is served by an
  // onnx component ("ml"). Mirrors the backend's workflowModelIDs
  // split — both sides must agree on which kind each declared model gets.
  for (const model of Object.values(workflow.models)) {
    switch (model.type) {
      case "LLMModel":
        // `model` is the served upstream name — a deployment fact, filled by the
        // consumer from the binding's sub-address.
        reqs[model.id] = { kind: "declaredLlm", model: null };
        break;
      case "MLModel":
        reqs[model.id] = { kind: "ml", ref: null, model: null };
        break;
      default:
        return assertNeverModel(model.type);
    }
  }

  // A declared VectorDatabase binds the retrieval collection its id resolves to
  // ("rag"). Keyed by memory id: that is the id the engine resolves through the
  // mapping (buildCollections), so an unbound one fatals at build.
  for (const memory of Object.values(workflow.memory)) {
    switch (memory.type) {
      case "VectorDatabase":
        reqs[memory.id] = { kind: "rag", ref: null };
        break;
      case "MemoryFile":
        // Lives in the engine's own workspace volume — no platform resource to bind.
        break;
      default:
        return assertNeverMemory(memory.type);
    }
  }

  // Catalog models: referenced by an Agent node but not declared. Keyed by model
  // id (canonical, matching the backend surface) — not collapsed to providers
  // here. The id IS the catalog model name (a workflow fact), carried on `model`.
  // getReferencedCatalogModelIds already excludes declared ids, so this never
  // overwrites a declaredLlm entry.
  for (const id of getReferencedCatalogModelIds(workflow)) reqs[id] = { kind: "catalogLlm", model: id };

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

// Drift sentinel: a new MemoryType breaks compilation here until it is classified
// in workflowBindingRequirements' memory switch.
function assertNeverMemory(t: never): never {
  throw new Error(`unhandled memory type: ${String(t)}`);
}

// A binding conflict: two or more requirements that resolve to the same
// uniqueness key, i.e. the same physical/logical resource claimed more than once.
export interface BindingConflict {
  key: string;
  ids: string[];
}

// uniquenessKey is the CANONICAL, executable uniqueness rule per binding — the one
// table both deploy paths (OSS CLI, backend) and the engine backstop must agree on
// (workflow-deployment-layers.md, "The rule"). It maps a FILLED requirement to the
// string identifying the resource it claims; two requirements sharing a key are the
// same claim declared twice. Every requirement has a key — the rule is "always
// unique by (ref, discriminator)", with no keyless kinds.
//
// A required field left null THROWS — an unfilled requirement is a caller bug, never
// a silent skip. Run bindingConflicts only AFTER the completeness pass.
export function uniquenessKey(r: Requirement): string {
  switch (r.kind) {
    case "hardware":
      if (r.ref == null) throw unbound("hardware", r.family, "ref");
      // A serial port and a camera are exclusive by ref alone — no sub-address;
      // the index families discriminate by (ref, line/channel).
      if (r.family === "serial" || r.family === "camera") return `${r.family}:${r.ref}`;
      if (r.index == null) throw unbound("hardware", r.family, "index");
      return `${r.family}:${r.ref}:${r.index}`;
    case "mqtt":
      if (r.ref == null) throw unbound("mqtt", null, "ref");
      // topic is workflow-filled and never null; empty topic is a separate
      // (workflow-completeness) failure, not a uniqueness concern.
      return `mqtt:${r.ref}:${r.topic}`;
    case "declaredLlm":
      if (r.model == null) throw unbound("declaredLlm", null, "model");
      return `llm:${r.model}`;
    case "catalogLlm":
      // Shares the llmproxy's flat namespace with self-hosted served names (see
      // above), so the same `llm:` key catches a shadow.
      return `llm:${r.model}`;
    case "ml":
      if (r.ref == null) throw unbound("ml", null, "ref");
      if (r.model == null) throw unbound("ml", null, "model");
      return `ml:${r.ref}:${r.model}`;
    case "rag":
      // A VectorDatabase ref IS the collection id; two ids on one collection are the
      // same requirement declared twice (1:1 by ref, like UART).
      if (r.ref == null) throw unbound("rag", null, "ref");
      return `rag:${r.ref}`;
  }
}

function unbound(kind: string, family: string | null, field: string): Error {
  const what = family ? `${kind}/${family}` : kind;
  return new Error(`requirement ${what}: ${field} not bound at uniquenessKey time (run completeness check first)`);
}

// bindingConflicts groups filled requirements by uniqueness key and returns every
// key held by two or more ids. Run AFTER the completeness pass — uniquenessKey throws
// on an unfilled field rather than silently skipping it.
export function bindingConflicts(requirements: Record<string, Requirement>): BindingConflict[] {
  const byKey = new Map<string, string[]>();
  for (const [id, r] of Object.entries(requirements)) {
    const key = uniquenessKey(r);
    const ids = byKey.get(key);
    if (ids) ids.push(id);
    else byKey.set(key, [id]);
  }

  const conflicts: BindingConflict[] = [];
  for (const [key, ids] of byKey) {
    if (ids.length > 1) conflicts.push({ key, ids });
  }
  return conflicts;
}
