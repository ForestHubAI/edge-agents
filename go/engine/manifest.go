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
// the DeploymentMapping points at. The engine currently builds transports from
// MQTTs; provider configs (custom models) are carried on the wire but not yet
// consumed here.
type ExternalResources struct {
	MQTTs map[string]MQTTConnection
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
