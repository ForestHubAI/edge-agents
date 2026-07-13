// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

// The component contract: the fixed in-container paths every ForestHub component
// reads/writes (also the targets the renderers bind-mount host dirs onto) and the
// canonical component identities. The language-neutral source of truth is
// contract/component-constants.json; these MUST equal it (enforced by
// constants.test.ts) and the Go twins in go/component/constants.go. Changing a value
// means changing all three in lockstep.

// Fixed path a component's boot config (config.json) is mounted at, read-only.
export const COMPONENT_CONFIG_PATH = "/etc/foresthub/config.json";

// Fixed path a component's resolved secret document (secrets.json) is mounted at,
// read-only. Dynamic, id-keyed credentials resolved fresh each deploy, never in the spec.
export const COMPONENT_SECRETS_PATH = "/etc/foresthub/secrets.json";

// Fixed path a component's durable workspace is mounted at (engine memory, model
// weights, model repository) — persisted across deployments.
export const COMPONENT_WORKSPACE_PATH = "/var/lib/foresthub/workspace";

// Canonical identities of the singleton first-party components. For a singleton the
// identity is ALSO its compose service/container name — so the renderer names the
// container this, other components reach it at this hostname, and it stamps its logs
// with it. llama-server is a singleton too: one container fronts every on-device model
// with llama-swap, selected by id per request — so its name is fixed, not per-model.
export const ENGINE_COMPONENT_NAME = "engine";
export const LLAMA_COMPONENT_NAME = "llama-server";
export const CAMERA_COMPONENT_NAME = "camera";
export const ML_COMPONENT_NAME = "ml-inference";

// The fixed internal port each serving component's image listens on, baked into its
// entrypoint. NOT a host publishing: a same-network peer (the engine, on-device)
// dials http://<name>:<port> directly over the compose bridge; off-device the operator
// supplies the whole URL and publishes their own host port, so this is only the
// container-side of that mapping. The block is contiguous from llama-swap's 8080
// default. Engine has none — it serves no inbound HTTP.
export const LLAMA_COMPONENT_PORT = 8080;
export const CAMERA_COMPONENT_PORT = 8081;
export const ML_COMPONENT_PORT = 8082;
