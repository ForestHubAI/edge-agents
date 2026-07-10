// SPDX-License-Identifier: AGPL-3.0-only
// Copyright (c) 2026 ForestHub. All rights reserved.
// For commercial licensing, contact root@foresthub.ai

package engine

import (
	"fmt"

	"github.com/ForestHubAI/edge-agents/go/api/workflowapi"

	"github.com/ForestHubAI/edge-agents/go/llmproxy"

	"github.com/ForestHubAI/edge-agents/go/engine/expr"
)

// SubBufSize is the buffer size used in subscription channels. Events are dropped when this buffer size is exceeded.
const SubBufSize = 64

// Transition carries the metadata needed by a branching node to describe one
// of its possible outgoing transitions to an LLM.
type Transition struct {
	TargetID    string
	EdgeType    workflowapi.EdgeType
	Prompt      *workflowapi.Expression
	Description *string
}

// Apply runs the edge-type-specific side effect against the scope before the
// state machine moves on.
func (tr Transition) Apply(scope *Scope) error {
	switch tr.EdgeType {
	case workflowapi.AgentTask:
		if tr.Prompt == nil {
			return fmt.Errorf("agent task edge to %s: missing prompt", tr.TargetID)
		}
		v, err := expr.Eval(*tr.Prompt, scope)
		if err != nil {
			return fmt.Errorf("agent task prompt: %w", err)
		}
		scope.SetConversation(llmproxy.InputString(v.AsString()))
	case workflowapi.AgentDelegate:
		if tr.Prompt == nil {
			return nil // delegate with no prompt: preserve existing conversation as-is
		}
		v, err := expr.Eval(*tr.Prompt, scope)
		if err != nil {
			return fmt.Errorf("agent delegate prompt: %w", err)
		}
		updatedConv := append(scope.GetConversation(), llmproxy.InputString(v.AsString()))
		scope.SetConversation(updatedConv)
	case workflowapi.AgentChoice:
		scope.SetConversation(nil)
	}
	return nil
}

// Event is produced by a Trigger and consumed by the runner's state loop.
type Event struct {
	TargetState string       // Node ID to transition to
	Apply       func(*Scope) // Optional function to apply event data into the runner's scope
}

// Secrets is the engine's secret store: a flat map of secret id -> opaque secret
// value, keyed by the external-resource id ExternalResources and the
// ResourceMapping share. Each value is the single credential that resource needs
// (MQTT password, self-hosted LLM bearer token, embedding endpoint bearer
// token), merged into its connection at the api->domain boundary — the engine
// interprets a value by the kind of the resource its id resolves to. Populated
// from the mounted secret document
// (component.SecretsFile) at boot; deliberately NOT part of the deployment spec
// (not rotation-safe, breach-exposed if stored); empty when no resource needs one.
type Secrets map[string]string

// ResourceMapping binds a binding-free workflow's logical resource ids to
// concrete platform resources, keyed by workflow resource id. Mirrors the
// engineapi wire shape.
type ResourceMapping map[string]ResourceBinding

// ResourceBinding is how one workflow resource binds to the environment. Ref is
// the shared platform resource it points at (driver instance id in the boot
// DeviceManifest, or external resource id in ExternalResources); the engine
// picks the pool by the workflow resource's type. Index is the optional
// per-channel physical sub-address within that resource (GPIO line, or ADC/PWM/
// DAC channel number); nil for UART/MQTT/memory/model.
type ResourceBinding struct {
	Ref   string `json:"ref"`
	Index *int   `json:"index,omitempty"`
}

// DeviceManifest is the hardware the engine opens drivers for, keyed by
// driver instance ID. JSON tags match the fh-backend wire shape.
type DeviceManifest struct {
	GPIOs   map[string]GPIOConfig   `json:"gpios,omitempty"`
	ADCs    map[string]ADCConfig    `json:"adcs,omitempty"`
	DACs    map[string]DACConfig    `json:"dacs,omitempty"`
	Serials map[string]SerialConfig `json:"serials,omitempty"`
	PWMs    map[string]PWMConfig    `json:"pwms,omitempty"`
}

type GPIOConfig struct {
	Chip string `json:"chip"`
}

type ADCConfig struct {
	Device string `json:"device"`
}

type DACConfig struct {
	Device string `json:"device"`
}

type SerialConfig struct {
	Port string `json:"device"`
	Baud int    `json:"baud,omitempty"`
}

type PWMConfig struct {
	Chip string `json:"chip"`
}

// ExternalResources holds the resolved, boot-delivered configs for a workflow's
// non-device external resources, keyed by the platform resource id the
// ResourceMapping points at. The engine builds transports from MQTTs, LLM
// providers from Providers (the connection for each declared custom/self-hosted
// model), inference clients from MLInference (the sidecar endpoint each declared
// ML model is served from), capture clients from Cameras (the sidecar endpoint
// each declared camera channel is read from), and retrievers from VectorStores
// (the on-device artifact each declared vector database is answered from).
type ExternalResources struct {
	MQTTs        map[string]MQTTConnection
	Providers    map[string]LLMProviderConfig
	MLInference  map[string]MLInferenceConfig
	Cameras      map[string]CameraConfig
	VectorStores map[string]VectorStoreConfig
}

// MLInferenceConfig is the resolved connection to an ML inference sidecar the
// engine doesn't ship. The declared workflow model supplies the id; this
// supplies how to reach the sidecar and the name it selects on. Model is sent
// per request, so many models may share one endpoint.
type MLInferenceConfig struct {
	URL   string
	Model string
}

// CameraConfig is the resolved connection to a camera capture sidecar the
// engine doesn't ship. The declared workflow channel supplies the id; this
// supplies how to reach the sidecar. Which camera to read is sent per request,
// so many cameras may share one endpoint.
type CameraConfig struct {
	URL string
}

// VectorStoreConfig is the resolved binding of a vector database to a local
// retrieval artifact. Store names a directory the engine reads the index from;
// URL is the embedding endpoint whose model built that index, needed to place a
// query in the same vector space. APIKey is empty for an endpoint that needs no
// credential.
type VectorStoreConfig struct {
	URL    string
	Store  string
	APIKey string
}

// LLMProviderKind selects how the engine reaches one provider instance when
// registering it into the single llmproxy. Mirrors the wire discriminator.
type LLMProviderKind string

const (
	// LLMLocal: a built-in catalog adapter (Provider) authenticated with APIKey.
	LLMLocal LLMProviderKind = "localLlm"
	// LLMBackend: the catalog adapter (Provider) proxied through the backend, no key.
	LLMBackend LLMProviderKind = "backendLlm"
	// LLMSelfHosted: a self-hosted endpoint (URL, optional APIKey bearer) the
	// llmproxy doesn't ship, shared by every declared model bound to it.
	LLMSelfHosted LLMProviderKind = "selfhostedLlm"
)

// LLMProviderConfig is one resolved provider instance the engine registers into
// its llmproxy. Kind selects the transport; the other fields are kind-specific:
// localLlm/backendLlm carry Provider (the catalog adapter id); localLlm and
// selfhostedLlm carry APIKey; selfhostedLlm carries URL.
type LLMProviderConfig struct {
	Kind     LLMProviderKind
	Provider string
	URL      string
	APIKey   string
}

type MQTTConnection struct {
	BrokerURL       string    `json:"brokerUrl"`
	ClientID        string    `json:"clientId,omitempty"`
	Username        string    `json:"username,omitempty"`
	Password        string    `json:"password,omitempty"`
	PublishPrefix   string    `json:"publishPrefix,omitempty"`
	SubscribePrefix string    `json:"subscribePrefix,omitempty"`
	Will            *MQTTWill `json:"will,omitempty"`
}

type MQTTWill struct {
	Topic   string `json:"topic"`
	Payload string `json:"payload"`
	Qos     int    `json:"qos"`
	Retain  bool   `json:"retain"`
}

// RAGQueryParams is a similarity-search request issued through a Retriever.
type RAGQueryParams struct {
	CollectionID string
	Query        string
	TopK         int
}

// RAGQueryResult is one ranked chunk returned by a Retriever.
type RAGQueryResult struct {
	ChunkID    string
	DocumentID string
	Content    string
	Score      float64
}
