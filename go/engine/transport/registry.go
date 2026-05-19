package transport

import (
	"fh-backend/pkg/api"
	"fmt"
)

// Registry holds the per-deploy MQTT transport instances, keyed by network ID.
// Constructed fresh for each deploy via the engine's deploy plumbing; closed
// and replaced on the next deploy. Mirrors driver.Registry's open-on-construct
// + close-on-partial-fail discipline.
type Registry struct {
	mqtts map[string]MQTTTransport
}

// NewRegistry opens every transport declared in the manifest. On any failure
// transports opened so far are closed.
func NewRegistry(nm *api.NetworkManifest) (*Registry, error) {
	if nm == nil {
		return &Registry{mqtts: make(map[string]MQTTTransport)}, nil
	}
	r := &Registry{mqtts: make(map[string]MQTTTransport, len(nm.MQTTs))}
	for networkID, cfg := range nm.MQTTs {
		t, err := OpenMQTT(cfg.BrokerURL, cfg.ClientID, cfg.Username, cfg.Password, cfg.Will)
		if err != nil {
			r.CloseAll()
			return nil, fmt.Errorf("mqtt %q: %w", networkID, err)
		}
		r.mqtts[networkID] = t
	}
	return r, nil
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
