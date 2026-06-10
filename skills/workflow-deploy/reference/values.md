# The `--values` file

`fh-workflow deploy <workflow.json> --values <file>` reads a JSON object — a **partial deploy
config** — and fills the bundle from it. Without a terminal, every *required* value must be present
in this file or the command exits non-zero and prints exactly what's missing. This reference is how
to assemble that file correctly the first time.

The object is a partial of the deploy config; every field is optional at the JSON level, but some
become **required by content** (a hardware channel in the workflow ⇒ that channel's binding is
required). Anything you omit that has a default is filled with the default.

## Top-level fields

| Field        | Type                                  | Default                      | Notes |
| ------------ | ------------------------------------- | ---------------------------- | ----- |
| `hardware`   | `Record<channelId, HardwareBinding>`  | `{}`                         | one entry per hardware channel the workflow declares |
| `mqtt`       | `Record<channelId, MqttBinding>`      | `{}`                         | one entry per MQTT channel |
| `models`     | `Record<modelId, ModelBinding>`       | `{}`                         | one entry per custom model in `workflow.models` |
| `webSearch`  | `WebSearchBinding`                    | absent                       | only when the workflow has a `WebSearchTool` node |
| `llmKeys`    | `Record<provider, string>`            | `{}`                         | API keys for catalog models an `Agent` uses (see secrets) |
| `outputDir`  | `string`                              | `./<workflow-name>-bundle`   | where the bundle is written |
| `logLevel`   | `"debug" \| "info" \| "warn" \| "error"` | `"info"`                  | engine log level |
| `force`      | `boolean`                             | `false`                      | overwrite a non-empty output dir |

`outputDir`, `logLevel`, `force` can also be passed as flags (`--output`, `--log-level`, `--force`)
— a flag wins over the same field in the file. Keys (`--anthropic-key …`) likewise override
`llmKeys`. The keys, like all values, are merged per provider.

## Binding shapes

```
HardwareBinding   { "chipOrDevice": string, "index"?: number, "baud"?: number }
MqttBinding       { "brokerUrl": string, "username"?: string, "password"?: string }
ModelBinding      { "location": "device",  "modelFile": string }          // a GGUF run as a sidecar
                | { "location": "network", "url": string, "apiKey"?: string }  // an endpoint you run
WebSearchBinding  { "provider": string, "apiKey": string }
llmKeys           { "anthropic"?: string, "openai"?: string, "gemini"?: string, "mistral"?: string }
```

The four providers are the only keys the wizard knows; a custom/self-hosted model never needs one
(it goes through `models`, not `llmKeys`).

## What's required, what's secret

A value is **required** when its kind appears in the workflow. The deploy command checks exactly
these and lists any gap before refusing to run:

| Kind                         | Required field(s)                                  | Secret? |
| ---------------------------- | -------------------------------------------------- | ------- |
| hardware channel (any)       | `chipOrDevice`                                     | no |
| hardware channel (addressable: gpio/adc/dac/pwm) | `chipOrDevice` **and** `index`        | no |
| serial/UART channel          | `chipOrDevice` (no `index`; `baud` optional)       | no |
| MQTT channel                 | `brokerUrl`                                        | no (but `password` is) |
| custom model — device        | `modelFile` (a `.gguf` filename)                   | no |
| custom model — network       | `url`                                              | no (but `apiKey` is) |
| `WebSearchTool` node present | `webSearch.apiKey` (and `provider`)                | **yes** |
| `Agent` using a catalog model | nothing *blocking* — but the matching `llmKeys` entry is needed at **build** time | **yes** |

**Secret fields:** `llmKeys.*`, `mqtt.*.password`, `webSearch.apiKey`, `models.*.apiKey` (network).
These end up in `.env` / `external_resources.json`, both written `chmod 600`. The skill never asks
for or writes a real secret — it writes a **sentinel placeholder** (see below) so the value is
present (the command runs) but obviously not real, and the operator swaps it in afterwards.

Note the last row: a provider key is **not** blocking — the bundle generates without it — but an
`Agent` that references a catalog model (e.g. `claude-haiku-4-5`, a model **not** declared in
`workflow.models`) will fail at engine build time if the key is absent from `.env`. So treat it as
required-for-a-working-bundle and surface a placeholder.

## Reading the workflow to know what to fill

The workflow's own content tells you which bindings to provide:

- **`channels[]`** — each entry's `type` maps to a hardware family (or MQTT). Use the table below.
- **`models[]`** — each entry is a custom model needing a `ModelBinding` (ask device vs network).
- **nodes** — an `Agent` whose `arguments.model` is **not** in `models[]` ⇒ a catalog model ⇒ a
  provider key. A `WebSearchTool` node ⇒ `webSearch`. A `Retriever` node ⇒ **cannot deploy
  standalone** (hard stop — a standalone engine has no retriever).

### Channel type → family → physical binding

| `channels[].type` | family   | `chipOrDevice` looks like                         | addressable | binding extras |
| ----------------- | -------- | ------------------------------------------------- | ----------- | -------------- |
| `GPIOIN`,`GPIOOUT`| gpio     | `/dev/gpiochip0` (a cdev)                          | yes → `index` = GPIO line | — |
| `ADC`             | adc      | `/sys/bus/iio/devices/iio:device0` (sysfs)        | yes → `index` = channel | — |
| `DAC`             | dac      | `/sys/bus/iio/devices/iio:device1` (sysfs)        | yes → `index` = channel | — |
| `PWM`             | pwm      | `/sys/class/pwm/pwmchip0` (sysfs)                 | yes → `index` = channel | — |
| `UART`            | serial   | `/dev/ttyUSB0`, `/dev/ttyACM0`, `/dev/ttyAMA0`    | no (omit `index`) | `baud` optional, default 115200 |
| `MQTT`            | —        | n/a (uses `mqtt` binding, not `hardware`)         | — | `brokerUrl` + optional creds |

gpio/adc/dac/pwm always need an `index` sub-address; serial does not (it's one device). gpio and
serial are passed through as device nodes; adc/dac/pwm reach sysfs via a privileged container — the
bundle handles that for you, but it's why those families differ.

### `.gguf` filename rules (device models)

`modelFile` is a filename, not a path — the file lives in the bundle's `models/` folder. It must be
non-empty, end in `.gguf` (llama-server only loads GGUF), and contain no `/`. The file itself is
**not** copied into the bundle; the operator places it on the controller (the README says where).

## Sentinel placeholders for secrets

Write a recognizable, greppable placeholder for every secret field — never a real value:

```
REPLACE_ME_ANTHROPIC_API_KEY      (and _OPENAI_, _GEMINI_, _MISTRAL_)
REPLACE_ME_MQTT_PASSWORD
REPLACE_ME_WEB_SEARCH_API_KEY
REPLACE_ME_MODEL_API_KEY
```

A placeholder is non-empty, so the deploy command's required-checks pass and the value flows into
`.env` / `external_resources.json` (already `chmod 600`). The final report lists every placeholder
the operator must replace there before the bundle will actually run.

## A complete annotated example

A workflow with two GPIO channels, one MQTT channel (with credentials), a device model, a network
model, web search, and an `Agent` on a catalog model:

```json
{
  "hardware": {
    "button-in": { "chipOrDevice": "/dev/gpiochip0", "index": 17 },
    "led-out":   { "chipOrDevice": "/dev/gpiochip0", "index": 27 }
  },
  "mqtt": {
    "sensor-in": {
      "brokerUrl": "tcp://broker.local:1883",
      "username": "controller",
      "password": "REPLACE_ME_MQTT_PASSWORD"
    }
  },
  "models": {
    "gemma-local":  { "location": "device",  "modelFile": "gemma-2-9b-q4.gguf" },
    "vllm-remote":  { "location": "network",  "url": "http://10.0.0.5:8000", "apiKey": "REPLACE_ME_MODEL_API_KEY" }
  },
  "webSearch": { "provider": "brave", "apiKey": "REPLACE_ME_WEB_SEARCH_API_KEY" },
  "llmKeys":   { "anthropic": "REPLACE_ME_ANTHROPIC_API_KEY" },
  "outputDir": "./my-flow-bundle",
  "logLevel": "info"
}
```

The two minimal example files next to this reference (`examples/gpio-pin.values.json`,
`examples/mqtt-agent.values.json`) show the smaller, common cases.
