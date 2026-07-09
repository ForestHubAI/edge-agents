// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 ForestHub.

import type { Parameter } from "../parameter";
import { ALL_CHANNEL_TYPES } from "./Channel";

/**
 * Single union definition for all Channel variants — deliberately NOT the
 * per-type registry pattern used by Node/Memory/Model (`*Definition` +
 * `*Registry`, one definition object per type).
 *
 * The reason is in-place `type` switching that preserves shared parameter state.
 * Because `type` is a parameter and all variants share one `arguments` bag,
 * changing a channel's type keeps the same instance (id, label) and retains any
 * entered values that are still valid for the new type: the parameter +
 * `activationRules` machinery just re-gates which fields show, and `serialize`
 * (via `pruneArguments`) drops the now-inactive ones. A per-type registry
 * would make each variant its own definition, so switching type would mean
 * delete-and-recreate — losing id/label and every shared value the user entered.
 * (It also lets channels add from one "Add Channel" button with type as a field,
 * rather than an add-button per type. Node/Memory/Model instead treat `type` as
 * an immutable registry key chosen at creation.)
 *
 * The same could be achieved with a UI-layer "type selector" over a
 * ChannelRegistry; this union trades cross-family consistency for that
 * shared-state-preserving switch.
 */
export interface ChannelDefinition {
  parameters: Parameter[];
}

export const CHANNEL_DEFINITION: ChannelDefinition = {
  parameters: [
    {
      id: "type",
      label: "Type",
      description: "Channel type",
      type: "selection",
      default: "GPIOIN",
      options: ALL_CHANNEL_TYPES.map((t) => ({ value: t, label: t })),
    },
    {
      id: "bias",
      label: "Bias",
      description: "Pin bias configuration",
      type: "selection",
      default: "none",
      options: [
        { value: "none", label: "None" },
        { value: "pullup", label: "Pull-up" },
        { value: "pulldown", label: "Pull-down" },
      ],
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["GPIOIN"] }],
    },
    {
      id: "debounceMs",
      label: "Debounce (ms)",
      description: "Debounce window in milliseconds",
      type: "int",
      default: 50,
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["GPIOIN"] }],
    },
    {
      id: "frequency",
      label: "Frequency (Hz)",
      description: "PWM frequency in Hz",
      type: "int",
      default: 1000,
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["PWM"] }],
    },
    {
      id: "topic",
      label: "Topic",
      description: "MQTT topic this channel publishes to / subscribes on (e.g. sensors/temperature)",
      type: "string",
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["MQTT"] }],
    },
    {
      id: "level",
      label: "Level",
      description: "Severity the engine records messages written to this channel at",
      type: "selection",
      default: "info",
      options: [
        { value: "debug", label: "Debug" },
        { value: "info", label: "Info" },
        { value: "warn", label: "Warn" },
        { value: "error", label: "Error" },
      ],
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["LOG"] }],
    },
    {
      id: "tag",
      label: "Tag",
      description: "Optional category stamped on each line so the backend can group workflow-emitted logs",
      type: "string",
      optional: true,
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["LOG"] }],
    },
    {
      id: "width",
      label: "Width (px)",
      description: "Default capture width in pixels (source's native resolution when empty)",
      type: "int",
      optional: true,
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["CAMERA"] }],
    },
    {
      id: "height",
      label: "Height (px)",
      description: "Default capture height in pixels (source's native resolution when empty)",
      type: "int",
      optional: true,
      activationRules: [{ type: "parameterIn", parameterId: "type", values: ["CAMERA"] }],
    },
  ],
};
