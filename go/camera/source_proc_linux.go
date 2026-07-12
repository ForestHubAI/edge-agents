// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build linux

package camera

import (
	"os/exec"
	"syscall"
)

// killChildProcessGroup runs cmd in its own process group and, on context
// cancel, SIGKILLs the whole group. A gst-launch pipeline forks plugin children
// (v4l2, libcamera); killing only the direct child would orphan them and they
// could keep the V4L2 node open. Negating the pid targets the group.
func killChildProcessGroup(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Cancel = func() error {
		if cmd.Process == nil {
			return nil
		}
		return syscall.Kill(-cmd.Process.Pid, syscall.SIGKILL)
	}
}
