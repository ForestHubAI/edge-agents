// Package component holds the cross-component device-filesystem contract: the
// fixed in-container paths every ForestHub component (engine, broker, …) reads
// and writes. See docs/device-filesystem.md.
package component

// The standard in-container mountpoints from the device-filesystem contract.
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
	// Workspace is the durable, device-authoritative working dir (memory, model
	// files, broker state), persisted across deployments.
	Workspace = "/var/lib/foresthub/workspace"
)
