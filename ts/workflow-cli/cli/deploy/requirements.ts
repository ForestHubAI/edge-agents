// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// The OSS CLI's enrichment of the Stage-0 binding surface. workflowBindingRequirements
// (in @foresthubai/workflow-core/deploy) is the single, cross-language authority for
// WHAT a workflow needs bound — an id->kind surface the backend produces identically.
// This layer does NOT re-decide that set: it iterates the surface and enriches each
// entry into the typed pools the OSS deploy artifacts and prompts need — hardware
// family/addressability, the LLM-vs-ML split, catalog-model→provider resolution.
// That is exactly the pattern the FE follows off the same surface (there, enriching
// each binding against DB state to build a form). Same root, per-consumer HOW.
//
// NOT a cross-language seam itself — the backend builds its own enrichment off the
// surface. CLI-owned OSS packaging (Stage-1 input prep).

import type { Workflow } from "@foresthubai/workflow-core/workflow";
import type { ModelInfo } from "@foresthubai/workflow-core/model";
import { workflowBindingRequirements, type Requirement, type HardwareFamily } from "@foresthubai/workflow-core/deploy";

export type { HardwareFamily };

// A workflow-derived requirement carrying the OSS enrichment the resolver needs
// around it: its logical `id` and human `label`. This IS the shared Requirement —
// wrapped, not re-derived — so the deployment fields (`ref`/`index`/`model`) start
// null and the resolver fills them as it allocates, then runs bindingConflicts over
// the filled set.
export type BoundRequirement = Requirement & { id: string; label: string };

// Serial and camera take no `index` sub-address; the rest of the hardware families
// discriminate by (ref, line/channel).
export function isAddressable(family: HardwareFamily): boolean {
  return family !== "serial" && family !== "camera";
}

// A bound requirement narrowed to one kind — what the by-kind accessors return.
export type BoundOf<K extends BoundRequirement["kind"]> = Extract<BoundRequirement, { kind: K }>;
// Hardware with camera excluded from the family, so a driver-family switch over it
// stays exhaustive (camera has its own build path).
export type NonCameraHardware = BoundOf<"hardware"> & { family: Exclude<HardwareFamily, "camera"> };

// By-kind views over the wrapped surface. The resolver reads these instead of
// separate pools; the entries ARE the requirements, so filling one fills it for the
// uniqueness check. Hardware excludes camera (its own driver family, own build path).
export function hardwareBindings(req: DeployRequirements): NonCameraHardware[] {
  return Object.values(req.bindings).filter((r): r is NonCameraHardware => r.kind === "hardware" && r.family !== "camera");
}
export function cameraBindings(req: DeployRequirements): BoundOf<"hardware">[] {
  return Object.values(req.bindings).filter((r): r is BoundOf<"hardware"> => r.kind === "hardware" && r.family === "camera");
}
export function mqttBindings(req: DeployRequirements): BoundOf<"mqtt">[] {
  return Object.values(req.bindings).filter((r): r is BoundOf<"mqtt"> => r.kind === "mqtt");
}
export function llmBindings(req: DeployRequirements): BoundOf<"declaredLlm">[] {
  return Object.values(req.bindings).filter((r): r is BoundOf<"declaredLlm"> => r.kind === "declaredLlm");
}
export function mlBindings(req: DeployRequirements): BoundOf<"ml">[] {
  return Object.values(req.bindings).filter((r): r is BoundOf<"ml"> => r.kind === "ml");
}
export function ragBindings(req: DeployRequirements): BoundOf<"rag">[] {
  return Object.values(req.bindings).filter((r): r is BoundOf<"rag"> => r.kind === "rag");
}

// One catalog provider a workflow's Agent nodes pull models from (resolved against
// the static catalog, not workflow.models). Each becomes one ExternalResources entry
// whose routing — local key vs backend — is a deploy input.
export interface CatalogProvider {
  id: string;
}

// What a workflow needs from its environment, derived from its content alone — no
// operator input. Drives input collection (which bindings to ask for), the resolver's
// completeness check, and — once the resolver has filled the deployment fields — the
// canonical uniqueness check. `bindings` IS the shared Requirement surface, wrapped
// (id + label) and constructed ONCE; the resolver reads it by kind and fills each
// binding's ref/index/model in place. The remaining fields are deploy-level
// aggregates that are not per-binding.
export interface DeployRequirements {
  // Every declared resource the workflow needs bound, keyed by logical id — the
  // wrapped Requirement surface. catalogLlm entries are included: they carry no
  // mapping entry (the llmproxy routes them by model id) but are part of the
  // uniqueness namespace.
  bindings: Record<string, BoundRequirement>;
  // At least one Agent references a catalog model (not declared in workflow.models) —
  // a raw signal that provider credentials are needed, even headlessly where the
  // provider set is unknown.
  hasProviderModel: boolean;
  // Distinct catalog providers the referenced models resolve to, via the supplied
  // catalog. Each becomes one ExternalResources provider instance (local or backend —
  // a deploy input). Empty when no catalog is passed — the map is then unknown.
  catalogProviders: CatalogProvider[];
  // Referenced catalog model ids absent from the supplied catalog — a dangling ref
  // the resolver refuses to deploy. Always empty when no catalog is passed.
  unresolvedCatalogModels: string[];
  // The workflow has a WebSearchTool node — needs a web-search key as engine env.
  hasWebSearch: boolean;
}

// The label for a bound resource, from the workflow item it came from (channel /
// model / memory). A catalog model id belongs to no declared item, so it labels
// itself.
function labelFor(workflow: Workflow, id: string): string {
  return workflow.channels[id]?.label ?? workflow.models[id]?.label ?? workflow.memory[id]?.label ?? id;
}

// deriveRequirements wraps the Stage-0 binding surface (workflowBindingRequirements)
// into the resolver's DeployRequirements. Pure — no I/O, no operator input. The
// surface is the single authority for WHAT needs binding, cross-language with the
// backend; this layer wraps each requirement with its id/label — constructed ONCE,
// filled later by the resolver as it allocates refs — and adds the deploy-level
// aggregates the surface doesn't carry: catalog-model→provider resolution and the
// web-search signal. `catalog` is the static model catalog: supply it to resolve
// catalog model ids to their providers; omit it (headless) to defer that.
export function deriveRequirements(workflow: Workflow, catalog: ModelInfo[] = []): DeployRequirements {
  const bindings: Record<string, BoundRequirement> = {};
  const catalogModelIds: string[] = [];
  for (const [id, req] of Object.entries(workflowBindingRequirements(workflow))) {
    bindings[id] = { ...req, id, label: labelFor(workflow, id) };
    if (req.kind === "catalogLlm") catalogModelIds.push(id);
  }

  let hasWebSearch = false;
  for (const canvas of Object.values(workflow.canvases)) {
    for (const node of canvas.nodes) {
      if (node.type === "WebSearchTool") hasWebSearch = true;
    }
  }

  // Resolve catalog model ids to their distinct providers via the catalog. With no
  // catalog the map is unknown: leave provider requirements empty (hasProviderModel
  // still flags that credentials are needed), record nothing as unresolved. We keep
  // only the provider set — catalog models are routed by llmproxy, not mapped, so
  // per-model provider ids aren't needed downstream.
  const byId = new Map(catalog.map((m) => [m.id, m]));
  const unresolvedCatalogModels: string[] = [];
  const providerIds = new Set<string>();
  if (catalog.length > 0) {
    for (const id of catalogModelIds) {
      const info = byId.get(id);
      if (!info) unresolvedCatalogModels.push(id);
      else providerIds.add(info.provider);
    }
  }

  return {
    bindings,
    hasProviderModel: catalogModelIds.length > 0,
    catalogProviders: [...providerIds].map((id) => ({ id })),
    unresolvedCatalogModels,
    hasWebSearch,
  };
}
