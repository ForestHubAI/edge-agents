// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import (
	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/component"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
)

// ResourcesToDomain maps the wire Resources (family-typed maps of boot config)
// onto the engine domain type at the api→domain boundary. Each family is copied
// straight into its domain counterpart: the discriminator lives in the map the
// entry sits in, so there is no arm-routing. Device families (GPIOs..Cameras)
// carry no credential; the endpoint families (MQTTs/Providers) merge their
// out-of-band secret by ref.
//
// The wire configs are secret-free (secrets are never stored in the deployment
// spec). Credentials arrive separately in secrets, keyed by the same resource
// id, and are merged in here so the domain connection the engine builds from is
// complete. A missing secret leaves the credential empty (the connection may
// still be valid — e.g. an anonymous broker or a keyless endpoint).
func ResourcesToDomain(in *engineapi.Resources, secrets component.Secrets) *Resources {
	if in == nil {
		return nil
	}
	out := &Resources{
		GPIOs:     make(map[string]GPIOConfig),
		ADCs:      make(map[string]ADCConfig),
		DACs:      make(map[string]DACConfig),
		Serials:   make(map[string]SerialConfig),
		PWMs:      make(map[string]PWMConfig),
		Cameras:   make(map[string]CameraSource),
		MQTTs:     make(map[string]MQTTBroker),
		Providers: make(map[string]LLMProvider),
		ML:        make(map[string]MLProvider),
	}
	if in.Gpios != nil {
		for id, c := range *in.Gpios {
			out.GPIOs[id] = GPIOConfig{Chip: c.Chip}
		}
	}
	if in.Adcs != nil {
		for id, c := range *in.Adcs {
			out.ADCs[id] = ADCConfig{Device: c.Device}
		}
	}
	if in.Dacs != nil {
		for id, c := range *in.Dacs {
			out.DACs[id] = DACConfig{Device: c.Device}
		}
	}
	if in.Serials != nil {
		for id, c := range *in.Serials {
			out.Serials[id] = SerialConfig{Port: c.Device, Baud: pointer.Val(c.Baud)}
		}
	}
	if in.Pwms != nil {
		for id, c := range *in.Pwms {
			out.PWMs[id] = PWMConfig{Chip: c.Chip}
		}
	}
	if in.Cameras != nil {
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
	if in.MqttBrokers != nil {
		for id, c := range *in.MqttBrokers {
			mc := MQTTBroker{
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
		}
	}
	if in.LlmProviders != nil {
		for id, c := range *in.LlmProviders {
			out.Providers[id] = LLMProvider{
				Kind:     LLMProviderKind(c.Type),
				Provider: pointer.Val(c.Provider),
				URL:      pointer.Val(c.Url),
				APIKey:   secrets[id],
			}
		}
	}
	if in.MlProviders != nil {
		for id, c := range *in.MlProviders {
			out.ML[id] = MLProvider{URL: c.Url}
		}
	}
	return out
}

// ResourceMappingToDomain maps the wire ResourceMapping (workflow logical id ->
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
