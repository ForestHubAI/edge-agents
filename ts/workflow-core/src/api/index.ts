export type { components } from "./workflow";

import type { components } from "./workflow";
export type Schemas = components["schemas"];

// Deployment-spec api layer, generated from contract/deployment.yaml. It $refs
// engine.yaml + workflow.yaml, which openapi-typescript inlines, so this file is
// self-contained — DeploymentSchemas["DeploymentSpec"] carries its own EngineConfig
// and Workflow. Kept under a distinct name so it never collides with the workflow
// Schemas above.
import type { components as deploymentComponents } from "./deployment";
export type DeploymentSchemas = deploymentComponents["schemas"];

// Api-layer type aliases used across the domain. They live here (not in any
// single domain module) so modules don't cross-import them; consumers pull
// them from the package root (`@foresthubai/workflow-core`).
export type DataType = Schemas["DataType"];
export type Reference = Schemas["Reference"];
export type Expression = Schemas["Expression"];
