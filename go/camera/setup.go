// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package camera

import (
	"context"
	"fmt"
	"os/exec"
	"sort"
	"strings"
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/ForestHubAI/edge-agents/go/logging"
)

// setupTimeout bounds one camera's whole setup script; media-ctl/v4l2-ctl
// calls are near-instant, so a hang means a broken device node.
const setupTimeout = 60 * time.Second

// RunSetup executes each camera's setup commands as one shell script, so
// variables carry across lines — device numbering (e.g. /dev/mediaN) is not
// boot-stable, so an early line can discover the device for later lines.
// -e stops at the first failing line, -x traces each line into the output.
func RunSetup(ctx context.Context, cfg cameraapi.CameraConfig) error {
	names := make([]string, 0, len(cfg.Cameras))
	for name := range cfg.Cameras {
		names = append(names, name)
	}
	sort.Strings(names)
	for _, name := range names {
		lines := cfg.Cameras[name].Setup
		if len(lines) == 0 {
			continue
		}
		cctx, cancel := context.WithTimeout(ctx, setupTimeout)
		out, err := exec.CommandContext(cctx, "/bin/sh", "-exc", strings.Join(lines, "\n")).CombinedOutput()
		cancel()
		if err != nil {
			return fmt.Errorf("camera %q: setup script: %w\n%s", name, err, strings.TrimSpace(string(out)))
		}
		logging.Logger.Info().Str("camera", name).Int("commands", len(lines)).Msg("setup script ok")
	}
	return nil
}
