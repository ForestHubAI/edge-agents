package transport

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/engine"
)

// Registry holds the per-deploy MQTT transport instances, keyed by network ID.
// Constructed fresh for each deploy via the engine's deploy plumbing; closed
// and replaced on the next deploy. Mirrors driver.Registry's open-on-construct
// + close-on-partial-fail discipline.
type Registry struct {
	mqtts map[string]MQTTTransport
}

// NewRegistry opens every MQTT transport in the deploy's external resources,
// keyed by external resource id. On any failure transports opened so far are
// closed.
func NewRegistry(ext *engine.ExternalResources) (*Registry, error) {
	if ext == nil {
		return &Registry{mqtts: make(map[string]MQTTTransport)}, nil
	}
	r := &Registry{mqtts: make(map[string]MQTTTransport, len(ext.MQTTs))}
	for id, cfg := range ext.MQTTs {
		t, err := OpenMQTT(cfg.BrokerURL, cfg.ClientID, cfg.Username, cfg.Password, cfg.Will)
		if err != nil {
			r.CloseAll()
			return nil, fmt.Errorf("mqtt %q: %w", id, err)
		}
		r.mqtts[id] = t
	}
	return r, nil
}

// str dereferences an optional wire string (nil -> ""). MQTTConnection's
// clientId/username/password are optional in the contract and thus generated
// as *string.
func str(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// MQTT returns the transport registered under networkID, or an error if no
// such network was opened in this deploy.
func (r *Registry) MQTT(networkID string) (MQTTTransport, error) {
	t, ok := r.mqtts[networkID]
	if !ok {
		return nil, fmt.Errorf("mqtt network %q: not registered", networkID)
	}
	return t, nil
}

// CloseAll shuts down every transport. Returns the first error encountered;
// keeps going on failures so no connection leaks.
func (r *Registry) CloseAll() error {
	var firstErr error
	for id, t := range r.mqtts {
		if err := t.Close(); err != nil && firstErr == nil {
			firstErr = fmt.Errorf("mqtt %q: close: %w", id, err)
		}
		delete(r.mqtts, id)
	}
	return firstErr
}
