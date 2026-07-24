// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// The deploy module's public surface: the language-neutral, cross-implementation
// pieces of the deployment pipeline (docs/deployment-pipeline.md). The OSS CLI's
// spec resolver (buildDeploymentSpec), its rich requirement analysis
// (deriveRequirements) and its operator-input types live in the workflow-cli
// package, not here — this module holds only what the backend path must
// independently agree with: the Stage-0 binding surface (the cross-language seam),
// the catalog-model walk it builds on, and the component contract.

export { workflowBindingRequirements, getReferencedCatalogModelIds, uniquenessKey, bindingConflicts } from "./requirements";
export type { BindingKind, HardwareFamily, Requirement, BindingConflict } from "./requirements";
export { COMPONENT_CONFIG_PATH, COMPONENT_SECRETS_PATH, COMPONENT_WORKSPACE_PATH } from "./constants";
export { ENGINE_COMPONENT_NAME, CAMERA_COMPONENT_NAME, ONNX_COMPONENT_NAME, LLAMA_COMPONENT_NAME, MOSQUITTO_COMPONENT_NAME } from "./constants";
export { LLAMA_COMPONENT_PORT, CAMERA_COMPONENT_PORT, ONNX_COMPONENT_PORT, MOSQUITTO_COMPONENT_PORT } from "./constants";
