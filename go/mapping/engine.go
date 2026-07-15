// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package mapping

import (
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
)

// ExternalResourcesToDomain maps the wire ExternalResources (a keyed union of
// boot config) onto the engine domain type at the api→domain boundary, routing
// each arm by its discriminator: MQTT connections into MQTTs, LLM provider
// instances (local / backend / self-hosted) into Providers, ML inference
// endpoints into MLInference, camera capture endpoints into Cameras. Unknown
// arms are skipped.
//
// The wire configs are secret-free (secrets are never stored in the deployment
// spec). Credentials arrive separately in secrets, keyed by the same resource
// id, and are merged in here so the domain connection the engine builds from is
// complete. A missing secret leaves the credential empty (the connection may
// still be valid — e.g. an anonymous broker or a keyless endpoint).
func ExternalResourcesToDomain(in *engineapi.ExternalResources, secrets engine.Secrets) *engine.ExternalResources {
	if in == nil {
		return nil
	}
	out := &engine.ExternalResources{
		MQTTs:       make(map[string]engine.MQTTConfig),
		Providers:   make(map[string]engine.LLMProviderConfig),
		MLInference: make(map[string]engine.MLInferenceConfig),
		Cameras:     make(map[string]engine.CameraConfig),
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
			mc := engine.MQTTConfig{
				BrokerURL:       c.BrokerURL,
				ClientID:        pointer.Val(c.ClientID),
				Username:        pointer.Val(c.Username),
				Password:        secrets[id],
				PublishPrefix:   pointer.Val(c.PublishPrefix),
				SubscribePrefix: pointer.Val(c.SubscribePrefix),
			}
			if c.Will != nil {
				mc.Will = &engine.MQTTWill{
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
			out.Providers[id] = engine.LLMProviderConfig{
				Kind:     engine.LLMProviderKind(c.Type),
				Provider: pointer.Val(c.Provider),
				URL:      pointer.Val(c.Url),
				APIKey:   secrets[id],
			}
		case string(engineapi.MlInference):
			c, err := rc.AsMLInferenceConfig()
			if err != nil {
				continue
			}
			out.MLInference[id] = engine.MLInferenceConfig{URL: c.Url}
		case string(engineapi.Camera):
			c, err := rc.AsCameraConfig()
			if err != nil {
				continue
			}
			out.Cameras[id] = engine.CameraConfig{URL: c.Url}
		}
	}
	return out
}

// SecretsToDomain maps the wire EngineSecrets (the mounted secret store: secret
// id -> opaque value) onto the engine domain type ExternalResourcesToDomain
// merges into connections. Both are a string map, so this is a plain type
// conversion; a nil input converts to nil (no resource needs a secret).
func SecretsToDomain(in engineapi.EngineSecrets) engine.Secrets {
	return engine.Secrets(in)
}

// ResourceMappingToDomain maps the wire ResourceMapping (workflow resource id ->
// binding) onto the engine domain type at the HTTP boundary.
func ResourceMappingToDomain(in *engineapi.ResourceMapping) engine.ResourceMapping {
	if in == nil {
		return nil
	}
	out := make(engine.ResourceMapping, len(*in))
	for k, v := range *in {
		out[k] = engine.ResourceAddress{Ref: v.Ref, Index: v.Index, Model: v.Model}
	}
	return out
}

// DeviceManifestToDomain maps the wire DeviceManifest (the device hardware
// catalog bundled into EngineConfig) onto the engine domain type the driver
// registry consumes. A nil input yields a zero manifest (no drivers).
func DeviceManifestToDomain(in *engineapi.DeviceManifest) engine.DeviceManifest {
	out := engine.DeviceManifest{}
	if in == nil {
		return out
	}
	if in.Gpios != nil {
		out.GPIOs = make(map[string]engine.GPIOConfig, len(*in.Gpios))
		for id, c := range *in.Gpios {
			out.GPIOs[id] = engine.GPIOConfig{Chip: c.Chip}
		}
	}
	if in.Adcs != nil {
		out.ADCs = make(map[string]engine.ADCConfig, len(*in.Adcs))
		for id, c := range *in.Adcs {
			out.ADCs[id] = engine.ADCConfig{Device: c.Device}
		}
	}
	if in.Dacs != nil {
		out.DACs = make(map[string]engine.DACConfig, len(*in.Dacs))
		for id, c := range *in.Dacs {
			out.DACs[id] = engine.DACConfig{Device: c.Device}
		}
	}
	if in.Serials != nil {
		out.Serials = make(map[string]engine.SerialConfig, len(*in.Serials))
		for id, c := range *in.Serials {
			out.Serials[id] = engine.SerialConfig{Port: c.Device, Baud: pointer.Val(c.Baud)}
		}
	}
	if in.Pwms != nil {
		out.PWMs = make(map[string]engine.PWMConfig, len(*in.Pwms))
		for id, c := range *in.Pwms {
			out.PWMs[id] = engine.PWMConfig{Chip: c.Chip}
		}
	}
	return out
}

// TickerInterval converts a wire ticker (value + unit) into a runtime duration.
func TickerInterval(value int, unit workflowapi.TickerNodeArgumentsIntervalUnit) time.Duration {
	switch unit {
	case workflowapi.Seconds:
		return time.Duration(value) * time.Second
	case workflowapi.Minutes:
		return time.Duration(value) * time.Minute
	case workflowapi.Hours:
		return time.Duration(value) * time.Hour
	default:
		return time.Duration(value) * time.Millisecond
	}
}

// JSONTypeFor maps a workflow data type to its JSON Schema type name. Shared
// by nodes that build runtime schemas (Agent response format, FunctionCall
// tool parameters).
func JSONTypeFor(dt workflowapi.DataType) string {
	switch dt {
	case workflowapi.Int:
		return "integer"
	case workflowapi.Float:
		return "number"
	case workflowapi.Bool:
		return "boolean"
	default:
		return "string"
	}
}
