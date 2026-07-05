// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import { describe, it, expect } from "vitest";
import { serialize, deserialize } from "./serialization";
import type { Node } from "./Node";

// Drafts save on purpose: a required-but-unset argument must serialize as
// ABSENT — never as `undefined`, `""`, or (worst) `null` in the JSON file.

function makeNode(type: string, args: Record<string, unknown>): Node {
  return { id: "n1", type, position: { x: 0, y: 0 }, arguments: args } as unknown as Node;
}

describe("serialize: draft (incomplete) nodes", () => {
  it("omits a required-but-unset argument entirely", () => {
    const api = serialize(makeNode("ReadPin", {}), false);
    expect("arguments" in api && api.arguments && "pinReference" in api.arguments).toBe(false);
  });

  it("emits no null/undefined values in the JSON form", () => {
    const api = serialize(makeNode("OnThreshold", {}), false);
    const json = JSON.parse(JSON.stringify(api)) as { arguments?: Record<string, unknown> };
    expect(Object.values(json.arguments ?? {})).not.toContain(null);
    expect(json).toEqual({ id: "n1", type: "OnThreshold", position: { x: 0, y: 0 }, arguments: {} });
  });

  it("unset MqttPublish qos stays absent instead of NaN→null", () => {
    const api = serialize(makeNode("MqttPublish", { channelReference: "ch1" }), false);
    const json = JSON.parse(JSON.stringify(api)) as { arguments: Record<string, unknown> };
    expect("qos" in json.arguments).toBe(false);
  });
});

describe("serialize: complete nodes", () => {
  it("keeps configured required arguments", () => {
    const api = serialize(makeNode("Delay", { delayMs: 250 }), false);
    expect(api).toMatchObject({ arguments: { delayMs: 250 } });
  });

  it("maps MqttPublish qos from domain string to wire number", () => {
    const api = serialize(makeNode("MqttPublish", { channelReference: "ch1", qos: "2" }), false);
    expect(api).toMatchObject({ arguments: { qos: 2 } });
  });

  it("round-trips a configured node through deserialize", () => {
    const node = makeNode("Ticker", { intervalValue: 5, intervalUnit: "seconds" });
    const back = deserialize(serialize(node, false));
    expect(back.arguments).toMatchObject({ intervalValue: 5, intervalUnit: "seconds" });
  });
});
