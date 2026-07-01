package engine

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

// DeploymentMapping binds a binding-free workflow's logical resource ids to
// concrete platform resources for one deploy, keyed by workflow resource id.
// Mirrors the engineapi wire shape.
type DeploymentMapping map[string]ResourceBinding

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

// ExternalResources holds the resolved, deploy-delivered configs for a
// workflow's non-device external resources, keyed by the platform resource id
// the DeploymentMapping points at. The engine builds transports from MQTTs,
// per-deploy LLM providers from Providers (the connection for each declared
// custom/self-hosted model), and inference clients from MLInference (the sidecar
// endpoint each declared ML model is served from).
type ExternalResources struct {
	MQTTs       map[string]MQTTConnection
	Providers   map[string]LLMProviderConfig
	MLInference map[string]MLInferenceConfig
}

// MLInferenceConfig is the resolved connection to an ML inference sidecar the
// engine doesn't ship. The declared workflow model supplies the id; this
// supplies how to reach the sidecar. The model name to run is sent per
// request, so many models may share one endpoint.
type MLInferenceConfig struct {
	URL string
}

// LLMProviderConfig is the resolved connection to a self-hosted/custom LLM
// endpoint the llmproxy doesn't ship. The declared workflow model supplies the
// id and capabilities; this supplies how to reach it. Model is the optional
// upstream model name the endpoint serves (defaults to the workflow model id).
type LLMProviderConfig struct {
	URL    string
	APIKey string
	Model  string
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

// ResourceSecret holds the credentials for one external resource. Secrets are
// deliberately NOT part of the deployment spec (not rotation-safe, breach-
// exposed if stored): they are delivered out-of-band and merged into the
// resource's connection at the api->domain boundary, so the connection the
// engine actually uses is complete while the stored spec stays secret-free.
type ResourceSecret struct {
	Password string `json:"password,omitempty"` // MQTT broker password
	APIKey   string `json:"apiKey,omitempty"`   // self-hosted LLM endpoint bearer
}

// ResourceSecrets maps an external-resource id (the same id ExternalResources
// and the DeploymentMapping key on) to its credentials. Populated from the
// FH_RESOURCE_SECRETS env channel at boot; empty when no resource needs a secret.
type ResourceSecrets map[string]ResourceSecret
