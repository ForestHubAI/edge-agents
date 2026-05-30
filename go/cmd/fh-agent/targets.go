package main

import (
	"bytes"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

//go:embed targets/*.yaml
var targetsFS embed.FS

// Target is the embedded hardware-profile shape. Each YAML in targets/
// unmarshals into one of these.
type Target struct {
	ID          string         `yaml:"id" json:"id"`
	DisplayName string         `yaml:"displayName" json:"displayName"`
	Arch        string         `yaml:"arch" json:"arch"` // arm64 | amd64
	OS          string         `yaml:"os" json:"os"`
	Runtime     string         `yaml:"runtime" json:"runtime"` // docker | podman | snap
	CPU         TargetCPU      `yaml:"cpu" json:"cpu"`
	RAM         TargetRAM      `yaml:"ram" json:"ram"`
	Accel       TargetAccel    `yaml:"accel" json:"accel"`
	Hardware    TargetHardware `yaml:"hardware" json:"hardware"`
	SLMs        []TargetSLM    `yaml:"slms" json:"slms"`
	SLMRuntime  TargetSLMRT    `yaml:"slmRuntime" json:"slmRuntime"`
	Notes       string         `yaml:"notes,omitempty" json:"notes,omitempty"`
	NotesIO     string         `yaml:"notes_io,omitempty" json:"notes_io,omitempty"`
	IndustrialBuses []string   `yaml:"industrialBuses,omitempty" json:"industrialBuses,omitempty"`
}

type TargetCPU struct {
	Model   string `yaml:"model" json:"model"`
	Cores   int    `yaml:"cores" json:"cores"`
	FreqMHz int    `yaml:"freqMHz" json:"freqMHz"`
}

type TargetRAM struct {
	TotalMB    int `yaml:"totalMB" json:"totalMB"`
	ReservedMB int `yaml:"reservedMB" json:"reservedMB"`
}

func (r TargetRAM) availableMB() int {
	return r.TotalMB - r.ReservedMB
}

type TargetAccel struct {
	Type   string `yaml:"type" json:"type"` // none | cuda | npu | igpu
	Device string `yaml:"device,omitempty" json:"device,omitempty"`
	TOPS   float64 `yaml:"tops,omitempty" json:"tops,omitempty"`
	Notes  string `yaml:"notes,omitempty" json:"notes,omitempty"`
}

type TargetHardware struct {
	GPIOs   []TargetGPIO   `yaml:"gpios" json:"gpios"`
	Serials []TargetSerial `yaml:"serials" json:"serials"`
	PWMs    []TargetPWM    `yaml:"pwms" json:"pwms"`
	ADCs    []TargetADC    `yaml:"adcs" json:"adcs"`
	DACs    []TargetDAC    `yaml:"dacs" json:"dacs"`
	I2C     []string       `yaml:"i2c,omitempty" json:"i2c,omitempty"`
	SPI     []string       `yaml:"spi,omitempty" json:"spi,omitempty"`
}

type TargetGPIO struct {
	ID    string `yaml:"id" json:"id"`
	Chip  string `yaml:"chip" json:"chip"`
	Lines int    `yaml:"lines" json:"lines"`
}
type TargetSerial struct {
	ID          string `yaml:"id" json:"id"`
	Device      string `yaml:"device" json:"device"`
	DefaultBaud int    `yaml:"defaultBaud" json:"defaultBaud"`
}
type TargetPWM struct {
	ID   string `yaml:"id" json:"id"`
	Chip string `yaml:"chip" json:"chip"`
}
type TargetADC struct {
	ID     string `yaml:"id" json:"id"`
	Device string `yaml:"device" json:"device"`
}
type TargetDAC struct {
	ID     string `yaml:"id" json:"id"`
	Device string `yaml:"device" json:"device"`
}

type TargetSLM struct {
	ID           string   `yaml:"id" json:"id"`
	Capabilities []string `yaml:"capabilities" json:"capabilities"`
	RAMMB        int      `yaml:"ramMB" json:"ramMB"`
	EstTokPerSec float64  `yaml:"estTokPerSec,omitempty" json:"estTokPerSec,omitempty"`
	Dimension    int      `yaml:"dimension,omitempty" json:"dimension,omitempty"`
	Runtime      string   `yaml:"runtime,omitempty" json:"runtime,omitempty"`
	Notes        string   `yaml:"notes,omitempty" json:"notes,omitempty"`
}

type TargetSLMRT struct {
	Image      string `yaml:"image" json:"image"`
	ServePort  int    `yaml:"servePort" json:"servePort"`
	GPURequest string `yaml:"gpuRequest,omitempty" json:"gpuRequest,omitempty"`
}

// loadAllTargets reads every embedded *.yaml under targets/ exactly once.
// Strict mode (KnownFields) catches typos in profile files at compile-time
// of the binary, not at runtime in a customer environment.
func loadAllTargets() (map[string]*Target, error) {
	out := map[string]*Target{}
	err := fs.WalkDir(targetsFS, "targets", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return err
		}
		if !strings.HasSuffix(path, ".yaml") {
			return nil
		}
		raw, rerr := targetsFS.ReadFile(path)
		if rerr != nil {
			return fmt.Errorf("read %s: %w", path, rerr)
		}
		dec := yaml.NewDecoder(bytes.NewReader(raw))
		dec.KnownFields(true)
		var t Target
		if derr := dec.Decode(&t); derr != nil {
			return fmt.Errorf("parse %s: %w", path, derr)
		}
		if t.ID == "" {
			return fmt.Errorf("%s: missing id", path)
		}
		if _, dup := out[t.ID]; dup {
			return fmt.Errorf("%s: duplicate target id %q", path, t.ID)
		}
		out[t.ID] = &t
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// listTargets returns target ids sorted alphabetically for deterministic
// output.
func listTargets() ([]*Target, error) {
	all, err := loadAllTargets()
	if err != nil {
		return nil, err
	}
	out := make([]*Target, 0, len(all))
	for _, t := range all {
		out = append(out, t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID < out[j].ID })
	return out, nil
}

func getTarget(id string) (*Target, error) {
	all, err := loadAllTargets()
	if err != nil {
		return nil, err
	}
	t, ok := all[id]
	if !ok {
		ids := make([]string, 0, len(all))
		for k := range all {
			ids = append(ids, k)
		}
		sort.Strings(ids)
		return nil, fmt.Errorf("unknown target %q; available: %s", id, strings.Join(ids, ", "))
	}
	return t, nil
}

// suggestModels picks SLMs from the target whose capability set covers the
// requested capability and whose RAM footprint fits the available budget.
// Results are sorted by best-fit: smaller RAM first (leaves headroom),
// then higher estimated throughput.
func suggestModels(t *Target, capability string, maxRAMMB int) []TargetSLM {
	avail := t.RAM.availableMB()
	if maxRAMMB > 0 && maxRAMMB < avail {
		avail = maxRAMMB
	}
	var out []TargetSLM
	for _, m := range t.SLMs {
		if !contains(m.Capabilities, capability) {
			continue
		}
		if m.RAMMB > avail {
			continue
		}
		out = append(out, m)
	}
	sort.SliceStable(out, func(i, j int) bool {
		if out[i].RAMMB != out[j].RAMMB {
			return out[i].RAMMB < out[j].RAMMB
		}
		return out[i].EstTokPerSec > out[j].EstTokPerSec
	})
	return out
}

func contains(xs []string, x string) bool {
	for _, v := range xs {
		if v == x {
			return true
		}
	}
	return false
}
