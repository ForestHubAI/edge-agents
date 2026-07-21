// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import (
	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
)

// ExternalResourcesToDomain maps the wire ExternalResources (a keyed union of
// boot config) onto the engine domain type at the api→domain boundary, routing
// each arm by its discriminator: MQTT connections into MQTTs, LLM provider
// instances (local / backend / self-hosted) into Providers, ML component
// endpoints into ML. Unknown arms are skipped. Cameras are not an
// external resource — they are device-owned and arrive in the DeviceManifest.
//
// The wire configs are secret-free (secrets are never stored in the deployment
// spec). Credentials arrive separately in secrets, keyed by the same resource
// id, and are merged in here so the domain connection the engine builds from is
// complete. A missing secret leaves the credential empty (the connection may
// still be valid — e.g. an anonymous broker or a keyless endpoint).
func ExternalResourcesToDomain(in *engineapi.ExternalResources, secrets component.Secrets) *ExternalResources {
	if in == nil {
		return nil
	}
	out := &ExternalResources{
		MQTTs:       make(map[string]MQTTConfig),
		Providers:   make(map[string]LLMProviderConfig),
		ML: make(map[string]MLConfig),
	}
	for id, rc := range *in {
		disc, err := rc.Discriminator()
		if err != nil {
			continue
		}
		switch disc {
		case string(engineapi.Mqtt):
			c, err := rc.AsMQTTConfig()
			if err != nil {
				continue
			}
			mc := MQTTConfig{
				BrokerURL:       c.BrokerURL,
				ClientID:        pointer.Val(c.ClientID),
				Username:        pointer.Val(c.Username),
				Password:        secrets[id],
				PublishPrefix:   pointer.Val(c.PublishPrefix),
				SubscribePrefix: pointer.Val(c.SubscribePrefix),
			}
			if c.Will != nil {
				mc.Will = &MQTTWill{
					Topic:   c.Will.Topic,
					Payload: c.Will.Payload,
					Qos:     c.Will.Qos,
					Retain:  c.Will.Retain,
				}
			}
			out.MQTTs[id] = mc
		case string(engineapi.LocalLlm), string(engineapi.BackendLlm), string(engineapi.SelfhostedLlm):
			c, err := rc.AsLLMProviderConfig()
			if err != nil {
				continue
			}
			out.Providers[id] = LLMProviderConfig{
				Kind:     LLMProviderKind(c.Type),
				Provider: pointer.Val(c.Provider),
				URL:      pointer.Val(c.Url),
				APIKey:   secrets[id],
			}
		case string(engineapi.Ml):
			c, err := rc.AsMLConfig()
			if err != nil {
				continue
			}
			out.ML[id] = MLConfig{URL: c.Url}
		}
	}
	return out
}

// ResourceMappingToDomain maps the wire ResourceMapping (workflow resource id ->
// binding) onto the engine domain type at the HTTP boundary.
func ResourceMappingToDomain(in *engineapi.ResourceMapping) ResourceMapping {
	if in == nil {
		return nil
	}
	out := make(ResourceMapping, len(*in))
	for k, v := range *in {
		out[k] = ResourceAddress{Ref: v.Ref, Index: v.Index, Model: v.Model}
	}
	return out
}

// DeviceManifestToDomain maps the wire DeviceManifest (the device hardware
// catalog bundled into EngineConfig) onto the engine domain type the driver
// registry consumes. A nil input yields a zero manifest (no drivers).
func DeviceManifestToDomain(in *engineapi.DeviceManifest) DeviceManifest {
	out := DeviceManifest{}
	if in == nil {
		return out
	}
	if in.Gpios != nil {
		out.GPIOs = make(map[string]GPIOConfig, len(*in.Gpios))
		for id, c := range *in.Gpios {
			out.GPIOs[id] = GPIOConfig{Chip: c.Chip}
		}
	}
	if in.Adcs != nil {
		out.ADCs = make(map[string]ADCConfig, len(*in.Adcs))
		for id, c := range *in.Adcs {
			out.ADCs[id] = ADCConfig{Device: c.Device}
		}
	}
	if in.Dacs != nil {
		out.DACs = make(map[string]DACConfig, len(*in.Dacs))
		for id, c := range *in.Dacs {
			out.DACs[id] = DACConfig{Device: c.Device}
		}
	}
	if in.Serials != nil {
		out.Serials = make(map[string]SerialConfig, len(*in.Serials))
		for id, c := range *in.Serials {
			out.Serials[id] = SerialConfig{Port: c.Device, Baud: pointer.Val(c.Baud)}
		}
	}
	if in.Pwms != nil {
		out.PWMs = make(map[string]PWMConfig, len(*in.Pwms))
		for id, c := range *in.Pwms {
			out.PWMs[id] = PWMConfig{Chip: c.Chip}
		}
	}
	if in.Cameras != nil {
		out.Cameras = make(map[string]CameraSource, len(*in.Cameras))
		for id, c := range *in.Cameras {
			// Only the discriminator survives into the domain: the engine reaches
			// every camera the same way regardless of kind, and the capture details
			// belong to the driver component, which gets its own derived config. An
			// unreadable arm is skipped rather than fatal — the camera then has no
			// driver, and a channel bound to it fails at build with "not registered".
			kind, err := c.Discriminator()
			if err != nil {
				continue
			}
			out.Cameras[id] = CameraSource{Kind: CameraKind(kind)}
		}
	}
	return out
}
