package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"

	"gopkg.in/yaml.v3"
)

// Spec is the user-facing site description. It is the single durable artifact
// the user maintains; every other build artifact is regenerated from it.
type Spec struct {
	SchemaVersion int          `yaml:"schemaVersion" json:"schemaVersion"`
	Name          string       `yaml:"name" json:"name"`
	Target        string       `yaml:"target" json:"target"`
	Description   string       `yaml:"description,omitempty" json:"description,omitempty"`
	Goals         []Goal       `yaml:"goals,omitempty" json:"goals,omitempty"`
	Constraints   []Constraint `yaml:"constraints,omitempty" json:"constraints,omitempty"`
	Zones         []Zone       `yaml:"zones,omitempty" json:"zones,omitempty"`
	Buses         []Bus        `yaml:"buses" json:"buses"`
	Devices       []Device     `yaml:"devices" json:"devices"`
	Agent         Agent        `yaml:"agent" json:"agent"`
}

type Goal struct {
	ID          string `yaml:"id" json:"id"`
	Description string `yaml:"description" json:"description"`
}

type Constraint struct {
	ID          string `yaml:"id" json:"id"`
	Description string `yaml:"description" json:"description"`
}

type Zone struct {
	ID   string `yaml:"id" json:"id"`
	Name string `yaml:"name" json:"name"`
}

// Bus describes a transport reachable from the site (MQTT broker, GPIO chip,
// serial port). Devices reference a bus by id.
type Bus struct {
	ID        string `yaml:"id" json:"id"`
	Type      string `yaml:"type" json:"type"` // mqtt | gpio | serial
	BrokerURL string `yaml:"brokerUrl,omitempty" json:"brokerUrl,omitempty"`
	Username  string `yaml:"username,omitempty" json:"username,omitempty"`
	Password  string `yaml:"password,omitempty" json:"password,omitempty"`
	Chip      string `yaml:"chip,omitempty" json:"chip,omitempty"`     // gpio: overrides target default
	Device    string `yaml:"device,omitempty" json:"device,omitempty"` // serial: overrides target default
	Baud      int    `yaml:"baud,omitempty" json:"baud,omitempty"`
}

type Device struct {
	ID       string    `yaml:"id" json:"id"`
	Zone     string    `yaml:"zone,omitempty" json:"zone,omitempty"`
	Kind     string    `yaml:"kind" json:"kind"`               // sensor | actuator | controller
	Measures string    `yaml:"measures,omitempty" json:"measures,omitempty"` // sensors: temperature, humidity, co2, presence, ...
	Controls string    `yaml:"controls,omitempty" json:"controls,omitempty"` // actuators: heating, cooling, light, valve, ...
	Unit     string    `yaml:"unit,omitempty" json:"unit,omitempty"`
	Bus      DeviceBus `yaml:"bus" json:"bus"`
}

// DeviceBus binds a device to one of the spec's buses with the per-device
// addressing (mqtt topic, gpio line number, etc).
type DeviceBus struct {
	Ref      string `yaml:"ref" json:"ref"` // buses[].id
	Topic    string `yaml:"topic,omitempty" json:"topic,omitempty"`
	Line     *int   `yaml:"line,omitempty" json:"line,omitempty"` // gpio line / pwm channel
	Writable bool   `yaml:"writable,omitempty" json:"writable,omitempty"`
}

type Agent struct {
	Reasoning       AgentReasoning `yaml:"reasoning" json:"reasoning"`
	EvaluationEvery string         `yaml:"evaluationEvery,omitempty" json:"evaluationEvery,omitempty"` // simple "60s" / "5m"
}

type AgentReasoning struct {
	Capability string `yaml:"capability" json:"capability"` // chat | reasoning | classification | embedding
	PromptHint string `yaml:"promptHint,omitempty" json:"promptHint,omitempty"`
}

// LoadSpec reads + parses a site.spec.yaml in strict mode (unknown fields
// fail loudly — agents would otherwise emit silently-ignored typos).
func LoadSpec(path string) (*Spec, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read spec: %w", err)
	}
	dec := yaml.NewDecoder(bytes.NewReader(raw))
	dec.KnownFields(true)
	var s Spec
	if err := dec.Decode(&s); err != nil {
		return nil, fmt.Errorf("parse spec: %w", err)
	}
	return &s, nil
}

// SpecSchema returns a hand-written JSON Schema (draft 2020-12). Kept in code
// rather than generated so the schema and the Go types are co-located and
// drift between them shows up in PR review.
func SpecSchema() json.RawMessage {
	return json.RawMessage(specSchemaJSON)
}

// ValidateSpec returns structured diagnostics describing missing required
// fields, dangling refs, and bus/device inconsistencies. Returns nil if the
// spec is well-formed (validation against the target catalog happens later
// in the plan pass).
func ValidateSpec(s *Spec) []Diagnostic {
	var diags []Diagnostic
	add := func(sev, msg, loc string) {
		diags = append(diags, Diagnostic{Severity: sev, Category: "spec", Message: msg, Location: loc})
	}

	if s.SchemaVersion != 1 {
		add("error", "schemaVersion must be 1", "$.schemaVersion")
	}
	if s.Name == "" {
		add("error", "name is required", "$.name")
	}
	if s.Target == "" {
		add("error", "target is required", "$.target")
	}
	if len(s.Buses) == 0 {
		add("error", "at least one bus is required", "$.buses")
	}
	if len(s.Devices) == 0 {
		add("error", "at least one device is required", "$.devices")
	}
	if s.Agent.Reasoning.Capability == "" {
		add("error", "agent.reasoning.capability is required (chat|reasoning|classification|embedding)", "$.agent.reasoning.capability")
	}

	busByID := map[string]Bus{}
	for i, b := range s.Buses {
		loc := fmt.Sprintf("$.buses[%d]", i)
		if b.ID == "" {
			add("error", "bus id is required", loc+".id")
			continue
		}
		if _, dup := busByID[b.ID]; dup {
			add("error", fmt.Sprintf("duplicate bus id %q", b.ID), loc+".id")
		}
		busByID[b.ID] = b
		switch b.Type {
		case "mqtt":
			if b.BrokerURL == "" {
				add("error", "mqtt bus requires brokerUrl", loc+".brokerUrl")
			}
		case "gpio":
			// chip defaults to target's first gpiochip; nothing required
		case "serial":
			// device defaults to target's first serial; nothing required
		case "":
			add("error", "bus type is required (mqtt|gpio|serial)", loc+".type")
		default:
			add("error", fmt.Sprintf("unknown bus type %q (mqtt|gpio|serial)", b.Type), loc+".type")
		}
	}

	zoneByID := map[string]bool{}
	for _, z := range s.Zones {
		zoneByID[z.ID] = true
	}

	devByID := map[string]bool{}
	for i, d := range s.Devices {
		loc := fmt.Sprintf("$.devices[%d]", i)
		if d.ID == "" {
			add("error", "device id is required", loc+".id")
			continue
		}
		if devByID[d.ID] {
			add("error", fmt.Sprintf("duplicate device id %q", d.ID), loc+".id")
		}
		devByID[d.ID] = true
		if d.Zone != "" && !zoneByID[d.Zone] {
			add("warn", fmt.Sprintf("device %q references unknown zone %q", d.ID, d.Zone), loc+".zone")
		}
		switch d.Kind {
		case "sensor":
			if d.Measures == "" {
				add("warn", fmt.Sprintf("sensor %q has no 'measures' set", d.ID), loc+".measures")
			}
		case "actuator":
			if d.Controls == "" {
				add("warn", fmt.Sprintf("actuator %q has no 'controls' set", d.ID), loc+".controls")
			}
		case "controller":
			// nothing required
		case "":
			add("error", "device kind is required (sensor|actuator|controller)", loc+".kind")
		default:
			add("error", fmt.Sprintf("unknown device kind %q", d.Kind), loc+".kind")
		}
		bus, ok := busByID[d.Bus.Ref]
		if !ok {
			add("error", fmt.Sprintf("device %q references unknown bus %q", d.ID, d.Bus.Ref), loc+".bus.ref")
			continue
		}
		switch bus.Type {
		case "mqtt":
			if d.Bus.Topic == "" {
				add("error", fmt.Sprintf("device %q on mqtt bus requires bus.topic", d.ID), loc+".bus.topic")
			}
		case "gpio":
			if d.Bus.Line == nil {
				add("error", fmt.Sprintf("device %q on gpio bus requires bus.line", d.ID), loc+".bus.line")
			}
		}
		if d.Kind == "actuator" && !d.Bus.Writable {
			add("warn", fmt.Sprintf("actuator %q on bus %q is not marked writable", d.ID, d.Bus.Ref), loc+".bus.writable")
		}
	}

	return diags
}

var errSpecInvalid = errors.New("spec validation failed")

// specInitTemplate is the YAML emitted by `fh-agent spec init`. Kept compact
// and heavily commented so a human (or an LLM) can fill it in without
// reading external docs first.
const specInitTemplate = `schemaVersion: 1

# Human-readable site name (used as the bundle directory name).
name: my-site

# Hardware target. Run 'fh-agent targets list' for available ids.
target: rpi5-8gb

description: ""

# What the agent is trying to achieve. Each goal becomes part of the
# reasoning prompt. Keep them short and behavioral.
goals: []
#   - id: comfort
#     description: Keep occupied rooms comfortable.

# Hard rules the agent must respect. Free-text in v1 — enforced via prompt,
# not via structural constraints. Tighten in a later version.
constraints: []
#   - id: heating-min
#     description: Heating setpoint must never go below 5 °C.

# Optional zone (room) labels. Devices reference a zone for spatial context.
zones: []
#   - id: livingroom
#     name: Wohnzimmer

# Buses are transports reachable from this site. Each device binds to one.
buses: []
#   - id: home-mqtt
#     type: mqtt
#     brokerUrl: tcp://localhost:1883
#   - id: gpio
#     type: gpio
#   - id: serial
#     type: serial

# Physical devices the agent reads or controls.
devices: []
#   - id: temp-livingroom
#     zone: livingroom
#     kind: sensor
#     measures: temperature
#     unit: C
#     bus:
#       ref: home-mqtt
#       topic: home/living/temperature
#   - id: heating-livingroom
#     zone: livingroom
#     kind: actuator
#     controls: heating
#     unit: C
#     bus:
#       ref: home-mqtt
#       topic: home/living/heating/setpoint
#       writable: true

agent:
  reasoning:
    capability: chat      # chat | reasoning | classification | embedding
    promptHint: ""
  evaluationEvery: 60s
`

// Hand-written JSON Schema for the spec. Edit alongside the Go types above.
const specSchemaJSON = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "site.spec.yaml",
  "type": "object",
  "required": ["schemaVersion", "name", "target", "buses", "devices", "agent"],
  "additionalProperties": false,
  "properties": {
    "schemaVersion": {"type": "integer", "const": 1},
    "name":          {"type": "string", "minLength": 1},
    "target":        {"type": "string", "minLength": 1, "description": "Hardware target id from 'fh-agent targets list'"},
    "description":   {"type": "string"},
    "goals": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "description"],
        "additionalProperties": false,
        "properties": {
          "id":          {"type": "string", "minLength": 1},
          "description": {"type": "string", "minLength": 1}
        }
      }
    },
    "constraints": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "description"],
        "additionalProperties": false,
        "properties": {
          "id":          {"type": "string", "minLength": 1},
          "description": {"type": "string", "minLength": 1}
        }
      }
    },
    "zones": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["id", "name"],
        "additionalProperties": false,
        "properties": {
          "id":   {"type": "string", "minLength": 1},
          "name": {"type": "string", "minLength": 1}
        }
      }
    },
    "buses": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "type"],
        "additionalProperties": false,
        "properties": {
          "id":        {"type": "string", "minLength": 1},
          "type":      {"type": "string", "enum": ["mqtt", "gpio", "serial"]},
          "brokerUrl": {"type": "string"},
          "username":  {"type": "string"},
          "password":  {"type": "string"},
          "chip":      {"type": "string"},
          "device":    {"type": "string"},
          "baud":      {"type": "integer", "minimum": 0}
        }
      }
    },
    "devices": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "required": ["id", "kind", "bus"],
        "additionalProperties": false,
        "properties": {
          "id":       {"type": "string", "minLength": 1},
          "zone":     {"type": "string"},
          "kind":     {"type": "string", "enum": ["sensor", "actuator", "controller"]},
          "measures": {"type": "string"},
          "controls": {"type": "string"},
          "unit":     {"type": "string"},
          "bus": {
            "type": "object",
            "required": ["ref"],
            "additionalProperties": false,
            "properties": {
              "ref":      {"type": "string", "minLength": 1},
              "topic":    {"type": "string"},
              "line":     {"type": "integer", "minimum": 0},
              "writable": {"type": "boolean"}
            }
          }
        }
      }
    },
    "agent": {
      "type": "object",
      "required": ["reasoning"],
      "additionalProperties": false,
      "properties": {
        "reasoning": {
          "type": "object",
          "required": ["capability"],
          "additionalProperties": false,
          "properties": {
            "capability": {"type": "string", "enum": ["chat", "reasoning", "classification", "embedding"]},
            "promptHint": {"type": "string"}
          }
        },
        "evaluationEvery": {"type": "string", "pattern": "^[0-9]+(s|m|h)$"}
      }
    }
  }
}
`
