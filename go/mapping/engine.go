package mapping

import (
	"time"

	"github.com/ForestHubAI/edge-agents/go/api/engineapi"
	"github.com/ForestHubAI/edge-agents/go/api/workflow"
	"github.com/ForestHubAI/edge-agents/go/engine"
	"github.com/ForestHubAI/edge-agents/go/util/pointer"
)

// ExternalResourcesToDomain maps the wire ExternalResources (a keyed union of
// deploy-time configs) onto the engine domain type at the HTTP boundary,
// routing each arm by its discriminator: MQTT connections into MQTTs, custom
// LLM provider configs into Providers. Unknown arms are skipped.
func ExternalResourcesToDomain(in *engineapi.ExternalResources) *engine.ExternalResources {
	if in == nil {
		return nil
	}
	out := &engine.ExternalResources{
		MQTTs:     make(map[string]engine.MQTTConnection),
		Providers: make(map[string]engine.LLMProviderConfig),
	}
	for id, rc := range *in {
		disc, err := rc.Discriminator()
		if err != nil {
			continue
		}
		switch disc {
		case string(engineapi.Mqtt):
			c, err := rc.AsMQTTConnection()
			if err != nil {
				continue
			}
			mc := engine.MQTTConnection{
				BrokerURL:       c.BrokerURL,
				ClientID:        pointer.Val(c.ClientID),
				Username:        pointer.Val(c.Username),
				Password:        pointer.Val(c.Password),
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
		case string(engineapi.Selfhosted):
			c, err := rc.AsLLMProviderConfig()
			if err != nil {
				continue
			}
			out.Providers[id] = engine.LLMProviderConfig{
				URL:    c.Url,
				APIKey: pointer.Val(c.ApiKey),
				Model:  pointer.Val(c.Model),
			}
		}
	}
	return out
}

// DeploymentMappingToDomain maps the wire DeploymentMapping (workflow resource
// id -> binding) onto the engine domain type at the HTTP boundary.
func DeploymentMappingToDomain(in *engineapi.DeploymentMapping) engine.DeploymentMapping {
	if in == nil {
		return nil
	}
	out := make(engine.DeploymentMapping, len(*in))
	for k, v := range *in {
		out[k] = engine.ResourceBinding{Ref: v.Ref, Index: v.Index}
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
func TickerInterval(value int, unit workflow.TickerNodeArgumentsIntervalUnit) time.Duration {
	switch unit {
	case workflow.Seconds:
		return time.Duration(value) * time.Second
	case workflow.Minutes:
		return time.Duration(value) * time.Minute
	case workflow.Hours:
		return time.Duration(value) * time.Hour
	default:
		return time.Duration(value) * time.Millisecond
	}
}

// JSONTypeFor maps a workflow data type to its JSON Schema type name. Shared
// by nodes that build runtime schemas (Agent response format, FunctionCall
// tool parameters).
func JSONTypeFor(dt workflow.DataType) string {
	switch dt {
	case workflow.Int:
		return "integer"
	case workflow.Float:
		return "number"
	case workflow.Bool:
		return "boolean"
	default:
		return "string"
	}
}
