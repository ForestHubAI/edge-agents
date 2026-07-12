// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

//go:build !linux

package camera

import "os/exec"

// killChildProcessGroup is a no-op off Linux. The camera component only ever runs
// in a Linux edge container; this stub exists so the package still compiles for
// local development on macOS/Windows, where exec.CommandContext already SIGKILLs
// the direct child on cancel (process groups are a POSIX concept).
func killChildProcessGroup(_ *exec.Cmd) {}
