// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

// Package component holds the cross-component runtime contract: the fixed
// in-container paths every ForestHub component (engine, broker, …) reads and
// writes, the exit-code policy, and the canonical component names. See
// docs/component-contract.md.
package component

// The standard in-container mountpoints from the component contract.
//
// At container start a renderer mounts each per-container host directory onto one
// of these paths.
//
// A mount maps a real host path — which carries the OS-specific prefix and the
// container name, e.g. /var/lib/foresthub/workspaces/<container>/ — onto the fixed
// in-container path below. So the component never sees the host layout: it reads
// the same path on every OS and in every container, while the renderer does all
// the prefix/container-name arithmetic on its side.
//
// These are constants, not configuration. Their values ARE the renderers' mount
// targets and must stay in sync with the renderer code.
const (
	// ConfigFile is the single boot config, mounted read-only from the host deploy
	// dir. The component opens exactly this file.
	ConfigFile = "/etc/foresthub/config.json"
	// SecretsFile is the resolved resource-credential document, mounted read-only
	// from the host deploy dir like ConfigFile. Dynamic, id-keyed credentials —
	// never in the deployment spec, resolved fresh at pull and delivered here
	// instead of via env. Absent when no external resource needs a secret.
	SecretsFile = "/etc/foresthub/secrets.json"
	// Workspace is the durable, device-authoritative working dir (memory, model
	// files, broker state), persisted across deployments.
	Workspace = "/var/lib/foresthub/workspace"
)

// Component identity names — the stable, canonical name each first-party component
// stamps on its logs and the control plane addresses it by. A cross-boundary
// contract: the value must match what the renderer/backend uses to name the
// container and correlate its output. Constants, not configuration.
const (
	// Engine is the workflow-runtime component's identity.
	Engine = "engine"
	// Llama is the on-device LLM component's identity (llama.cpp / llama-swap).
	Llama = "llama"
	// Camera is the camera-capture component's identity.
	Camera = "camera"
	// Onnx is the on-device Onnx runtime component's identity.
	Onnx = "onnx"
)

// The fixed internal port each serving component's image listens on, baked into its
// entrypoint. A same-network peer dials http://<name>:<port> directly over the container
// network; off-device the operator supplies the whole URL and publishes their own host
// port, so this is only the container-side of that mapping.
const (
	// LlamaPort is the llama component's listen port (llama-swap's endpoint).
	LlamaPort = 8080
	// CameraPort is the camera-capture component's listen port.
	CameraPort = 8081
	// OnnxPort is the ML component's listen port.
	OnnxPort = 8082
)

// Process exit codes a first-party component uses to tell the orchestrator how to
// react to a failure. Only a permanent failure gets a dedicated code; any other
// nonzero exit is treated as transient — the orchestrator may restart the
// container — and 0 is a clean shutdown.
const (
	// ExitConfigError signals a permanent boot failure where the provided config can not start the component.
	// Restarting the container unchanged fails the same way. The orchestrator marks the deployment failed as
	// instead of retrying.
	// Value 78 is sysexits.h EX_CONFIG.
	ExitConfigError = 78
)
