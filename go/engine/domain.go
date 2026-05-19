package engine

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
