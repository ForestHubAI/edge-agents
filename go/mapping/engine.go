package mapping

import (
	"github.com/ForestHubAI/fh-core/go/api/engineapi"
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
