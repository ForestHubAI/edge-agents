// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

export type { components } from "./workflow";

import type { components } from "./workflow";
export type Schemas = components["schemas"];

// Deployment-spec api layer, generated from contract/deployment.yaml. Its
// DeployComponent.config is an opaque object — the spec transports rendered config
// as bytes and no longer $refs engine.yaml — so the engine's own config types live
// in EngineSchemas below, not here. Kept under a distinct name so it never collides
// with the workflow Schemas above.
import type { components as deploymentComponents } from "./deployment";
export type DeploymentSchemas = deploymentComponents["schemas"];

// Engine wire/config api layer, generated from contract/engine.yaml. The deploy
// resolver (src/deploy/) PRODUCES an EngineConfig (workflow + mapping + external
// resources + device manifest) and freezes it into a DeployComponent's opaque
// config, so it types that construction against these.
import type { components as engineComponents } from "./engine";
export type EngineSchemas = engineComponents["schemas"];

// Api-layer type aliases used across the domain. They live here (not in any
// single domain module) so modules don't cross-import them; consumers pull
// them from the package root (`@foresthubai/workflow-core`).
export type DataType = Schemas["DataType"];
export type Reference = Schemas["Reference"];
export type Expression = Schemas["Expression"];
