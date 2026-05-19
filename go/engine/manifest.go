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

// NetworkManifest is the resolved MQTT transport set handed to the engine on
// deploy, keyed by network ID.
type NetworkManifest struct {
	MQTTs map[string]MQTTConnection `json:"mqtts"`
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
