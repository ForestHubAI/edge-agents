// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Deploy-artifact wire api layer: the generated TS bindings for the deployment,
// engine and camera contracts. These shapes cross the OSS deploy pipeline's seams —
// the resolver PRODUCES a DeploymentSpec (with a frozen EngineConfig) and the
// renderer PRODUCES the camera component's boot config (CameraConfig), consumed by
// the Go camera component. The CLI is the only TS consumer, so the codegen lives
// here (npm run generate) rather than in the headless core lib, which owns only the
// workflow wire (@foresthubai/workflow-core/api).
//
// GENERATED siblings (deployment.ts / engine.ts / camera.ts / ml.ts) —
// never hand-edit; regenerate from contract/*.yaml with `npm run generate`.

// Deployment-spec api layer, from contract/deployment.yaml. Its
// DeployComponent.config is an opaque object — the spec transports rendered config
// as bytes and no longer $refs engine.yaml — so the engine's own config types live
// in EngineSchemas below, not here. Kept under a distinct name so it never collides
// with the others.
import type { components as deploymentComponents } from "./deployment";
export type DeploymentSchemas = deploymentComponents["schemas"];

// Engine wire/config api layer, from contract/engine.yaml. The deploy resolver
// PRODUCES an EngineConfig (workflow + mapping + resources) and freezes it into a
// DeployComponent's opaque config, so it types that construction against these.
import type { components as engineComponents } from "./engine";
export type EngineSchemas = engineComponents["schemas"];

// Camera component wire + boot-config api layer, from contract/camera.yaml. The
// deploy renderer PRODUCES the camera component's boot config (CameraConfig); the
// Go camera component consumes it — one generated shape across that seam.
import type { components as cameraComponents } from "./camera";
export type CameraSchemas = cameraComponents["schemas"];

// ML component wire + boot-config api layer, from contract/ml.yaml. The deploy
// renderer PRODUCES the component's boot config (MLConfig) — the authoritative set
// of models it must load; the Python component (image fh-onnx) consumes it — one
// generated shape across that seam.
import type { components as mlComponents } from "./ml";
export type MLSchemas = mlComponents["schemas"];
