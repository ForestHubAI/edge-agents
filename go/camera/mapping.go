// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package camera

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/cameraapi"
	"github.com/ForestHubAI/edge-agents/go/component"
)

// ToDomain maps the wire boot config onto the domain type, routing each camera by
// its kind discriminator and merging in its credential from the secret document.
//
// The wire config is secret-free (a credential is never written into a config
// blob). Secrets arrive separately keyed by the same manifest key, and are merged
// here so the Camera the capture pipeline is built from is complete. A missing
// secret leaves the password empty — an unauthenticated stream is valid, so this
// is not an error.
//
// An unknown or malformed kind is a hard error: the component cannot serve a
// camera it does not understand, and failing at boot beats 500-ing on the first
// capture hours later.
func ToDomain(in cameraapi.CameraConfig, secrets component.Secrets) (Config, error) {
	out := Config{Cameras: make(map[string]Camera, len(in.Cameras))}
	for name, src := range in.Cameras {
		kind, err := src.Discriminator()
		if err != nil {
			return Config{}, fmt.Errorf("camera %q: %w", name, err)
		}
		c := Camera{Kind: Kind(kind)}
		switch Kind(kind) {
		case KindV4L2:
			v, err := src.AsV4L2Source()
			if err != nil {
				return Config{}, fmt.Errorf("camera %q: %w", name, err)
			}
			c.Device, c.WarmupFrames, c.Setup = v.Device, v.WarmupFrames, v.Setup
		case KindLibcamera:
			v, err := src.AsLibcameraSource()
			if err != nil {
				return Config{}, fmt.Errorf("camera %q: %w", name, err)
			}
			c.CameraName, c.WarmupFrames, c.Setup = v.CameraName, v.WarmupFrames, v.Setup
		case KindRTSP:
			v, err := src.AsRtspSource()
			if err != nil {
				return Config{}, fmt.Errorf("camera %q: %w", name, err)
			}
			c.URL, c.User, c.WarmupFrames = v.Url, v.User, v.WarmupFrames
			c.Password = secrets[name]
		case KindHTTP:
			v, err := src.AsHttpSource()
			if err != nil {
				return Config{}, fmt.Errorf("camera %q: %w", name, err)
			}
			c.URL, c.User, c.WarmupFrames = v.Url, v.User, v.WarmupFrames
			c.Password = secrets[name]
		case KindRaw:
			v, err := src.AsRawSource()
			if err != nil {
				return Config{}, fmt.Errorf("camera %q: %w", name, err)
			}
			c.Pipeline, c.WarmupFrames, c.Setup = v.Pipeline, v.WarmupFrames, v.Setup
		case KindDebug:
			// Nothing to carry: a debug camera needs no hardware and no config.
		default:
			return Config{}, fmt.Errorf("camera %q: unknown kind %q", name, kind)
		}
		out.Cameras[name] = c
	}
	return out, nil
}
