// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// The deploy module's public surface: the language-neutral, cross-implementation
// pieces of the deployment pipeline (docs/deployment-pipeline.md). The OSS CLI's
// spec resolver (buildDeploymentSpec) and its operator-input types live in the
// workflow-cli package, not here — this module holds only what the backend path
// must agree with: the Stage-0 requirement analysis and the component contract.

export { getReferencedCatalogModelIds, deriveRequirements } from "./requirements";
export { workflowBindingRequirements } from "./bindingRequirements";
export type { BindingKind } from "./bindingRequirements";
export type {
  DeployRequirements,
  HardwareChannel,
  MqttChannel,
  CameraChannel,
  CustomLLMModel,
  CustomMLModel,
  CatalogProvider,
  HardwareFamily,
} from "./requirements";
export { COMPONENT_CONFIG_PATH, COMPONENT_SECRETS_PATH, COMPONENT_WORKSPACE_PATH } from "./constants";
export { ENGINE_COMPONENT_NAME, CAMERA_COMPONENT_NAME, ML_COMPONENT_NAME, LLAMA_COMPONENT_NAME } from "./constants";
