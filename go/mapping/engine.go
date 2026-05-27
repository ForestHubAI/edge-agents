package mapping

import (
	"time"

	"github.com/ForestHubAI/fh-core/go/api/engineapi"
	"github.com/ForestHubAI/fh-core/go/api/workflow"
	"github.com/ForestHubAI/fh-core/go/engine"
	"github.com/ForestHubAI/fh-core/go/util/pointer"
)

// NetworkManifestToDomain maps the wire NetworkManifest (engineapi) onto the
// engine domain type at the HTTP boundary.
func NetworkManifestToDomain(in *engineapi.NetworkManifest) *engine.NetworkManifest {
	if in == nil {
		return nil
	}
	out := &engine.NetworkManifest{MQTTs: make(map[string]engine.MQTTConnection, len(in.MQTTs))}
	for id, c := range in.MQTTs {
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
	}
	return out
}

// StatusToAPI maps the engine domain Status onto the wire State enum.
func StatusToAPI(running bool) engineapi.State {
	if running {
		return engineapi.StateRunning
	}
	return engineapi.StateIdle
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
