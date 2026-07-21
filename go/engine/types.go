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
	TargetState string             // Node ID to transition to
	Apply       func(*Scope) error // Optional: seeds the trigger's outputs and applies the outgoing edge's side effects into the scope. Runs on the runner goroutine; a non-nil error aborts the transition and keeps the runner idle.
}

// ResourceMapping binds a binding-free workflow's logical resource ids to
// concrete platform resources, keyed by workflow resource id. Mirrors the
// engineapi wire shape.
type ResourceMapping map[string]ResourceAddress

// ResourceAddress is how one workflow resource binds to the environment. Ref is
// the shared platform resource it points at (a key in Resources). The optional
// sub-address fields select one served unit within that resource and are
// kind-specific.
type ResourceAddress struct {
	Ref   string  `json:"ref"`
	Index *int    `json:"index,omitempty"`
	Model *string `json:"model,omitempty"`
}

// Resources is the frozen set of platform resources the engine materializes 1:1
// into live code at boot, keyed by platform resource id (ref). It unifies
// device-owned driver configs (GPIOs..Cameras) and environment-supplied endpoint
// configs (MQTTs/Providers/ML) into one bundle.
type Resources struct {
	GPIOs     map[string]GPIOConfig
	ADCs      map[string]ADCConfig
	DACs      map[string]DACConfig
	Serials   map[string]SerialConfig
	PWMs      map[string]PWMConfig
	Cameras   map[string]CameraSource
	MQTTs     map[string]MQTTBroker
	Providers map[string]LLMProvider
	ML        map[string]MLProvider
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

// CameraKind is the path a camera is reached by. Mirrors the wire
// discriminator; the driver component owns what each kind means in practice.
type CameraKind string

const (
	CameraV4L2      CameraKind = "v4l2"      // a V4L2 device node
	CameraLibcamera CameraKind = "libcamera" // the platform's libcamera stack
	CameraRTSP      CameraKind = "rtsp"      // an IP camera over RTSP
	CameraHTTP      CameraKind = "http"      // an MJPEG stream or still endpoint
	CameraRaw       CameraKind = "raw"       // an escape-hatch source fragment
	CameraDebug     CameraKind = "debug"     // a synthetic fixed frame, no hardware
)

// CameraSource is one camera the device owns, as the engine sees it —
// deliberately narrow. The engine needs the identity and nothing else: the
// driver component owns every capture detail (device, url, credentials, warmup),
// receives them in its own derived config, and selects the camera by its manifest
// key per request. Kind is carried for diagnostics only, never to decide behavior.
type CameraSource struct {
	Kind CameraKind
}

// MLProvider is the resolved connection to an ML component the engine doesn't ship.
// The declared workflow model supplies the id; this supplies how to reach the
// component. The name the component selects on is the binding's Model sub-address
// (ResourceAddress.Model), sent per request, so many models may share one endpoint.
type MLProvider struct {
	URL string
}

// LLMProviderKind selects how the engine reaches one provider instance when
// registering it into the single llmproxy. Mirrors the wire discriminator.
type LLMProviderKind string

const (
	// LLMDirect: a built-in catalog adapter (Provider) reached straight at the
	// provider, authenticated with APIKey.
	LLMDirect LLMProviderKind = "directLlm"
	// LLMBackend: the catalog adapter (Provider) proxied through the backend, no key.
	LLMBackend LLMProviderKind = "backendLlm"
	// LLMSelfHosted: a self-hosted endpoint (URL, optional APIKey bearer) the
	// llmproxy doesn't ship, shared by every declared model bound to it.
	LLMSelfHosted LLMProviderKind = "selfhostedLlm"
)

// LLMProvider is one resolved provider instance the engine registers into
// its llmproxy. Kind selects the transport; the other fields are kind-specific:
// directLlm/backendLlm carry Provider (the catalog adapter id); directLlm and
// selfhostedLlm carry APIKey; selfhostedLlm carries URL.
type LLMProvider struct {
	Kind     LLMProviderKind
	Provider string
	URL      string
	APIKey   string
}

type MQTTBroker struct {
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
