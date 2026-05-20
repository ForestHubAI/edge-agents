import { NodeBase, OutputBinding, Reference } from ".";
import { NodeCategory, NodeTag } from "./NodeConstants";
import { NodeDefinition } from "./NodeDefinition";

// On Function Call Trigger - fires when a user-defined function is called
export interface OnFunctionCallNode extends NodeBase {
  type: "OnFunctionCall";
  arguments: Record<string, never>;
}

// Delay Node - pauses execution for a specified duration
export interface DelayNode extends NodeBase {
  type: "Delay";
  arguments: {
    delayMs: number;
  };
}

// Ticker Trigger - fires repeatedly at a specified interval
export interface TickerNode extends NodeBase {
  type: "Ticker";
  arguments: {
    intervalValue: number | undefined;
    intervalUnit: "milliseconds" | "seconds" | "minutes" | "hours";
  };
}

// Alarm Trigger - fires at a scheduled time on selected days
export interface AlarmNode extends NodeBase {
  type: "Alarm";
  arguments: {
    time: string;
    days: string[];
  };
}

// On Startup Trigger - fires once when device powers on
export interface OnStartupNode extends NodeBase {
  type: "OnStartup";
  arguments: Record<string, never>;
}

// On Pin Edge Trigger - fires when a digital pin transitions
export interface OnPinEdgeNode extends NodeBase {
  type: "OnPinEdge";
  arguments: {
    pinReference: string | undefined;
    edge: "rising" | "falling" | "both";
  };
}

// On Serial Receive Trigger - fires when serial data arrives
export interface OnSerialReceiveNode extends NodeBase {
  type: "OnSerialReceive";
  arguments: {
    portReference: string | undefined;
    output: OutputBinding;
  };
}

// On Threshold Trigger - fires when a numeric variable crosses a threshold
export interface OnThresholdNode extends NodeBase {
  type: "OnThreshold";
  arguments: {
    variable: Reference | undefined;
    threshold: number | undefined;
    direction: "rising" | "falling" | "both";
    deadband: number | undefined;
    output: OutputBinding;
  };
}

export type TriggerNodeType =
  | "OnFunctionCall"
  | "Delay"
  | "Ticker"
  | "Alarm"
  | "OnStartup"
  | "OnPinEdge"
  | "OnSerialReceive"
  | "OnThreshold";
export type TriggerNode =
  | OnFunctionCallNode
  | DelayNode
  | TickerNode
  | AlarmNode
  | OnStartupNode
  | OnPinEdgeNode
  | OnSerialReceiveNode
  | OnThresholdNode;

// Node Definitions

export const OnFunctionCallNodeDefinition: NodeDefinition = {
  type: "OnFunctionCall",
  label: "On Function Call",
  category: NodeCategory.Trigger,
  description: "Fires when this function is invoked by a Function Call node",
  parameters: [],
  isUnremovable: true, // Cannot be added or removed by user
  isSingleton: true,
};

export const DelayNodeDefinition: NodeDefinition = {
  type: "Delay",
  label: "Delay",
  category: NodeCategory.Trigger,
  description:
    "Pauses execution for a specified duration and triggers once the delay is complete. During this pause other node chains may run.",
  parameters: [
    {
      id: "delayMs",
      label: "Delay (ms)",
      description: "Time in milliseconds to pause execution",
      type: "int",
      default: 1000,
    },
  ],
};

export const TickerNodeDefinition: NodeDefinition = {
  type: "Ticker",
  label: "Ticker",
  category: NodeCategory.Trigger,
  description: "Fires repeatedly at a specified interval",
  parameters: [
    {
      id: "intervalValue",
      label: "Interval",
      description: "How many units between ticks",
      type: "int",
      default: 1,
    },
    {
      id: "intervalUnit",
      label: "Unit",
      description: "Time unit for the interval",
      type: "selection",
      options: [
        { value: "milliseconds", label: "Milliseconds" },
        { value: "seconds", label: "Seconds" },
        { value: "minutes", label: "Minutes" },
        { value: "hours", label: "Hours" },
      ],
      default: "seconds",
    },
  ],
};

export const AlarmNodeDefinition: NodeDefinition = {
  type: "Alarm",
  label: "Alarm",
  category: NodeCategory.Trigger,
  description: "Fires at a scheduled time on selected days of the week",
  parameters: [
    {
      id: "time",
      label: "Time",
      description: "Time of day to fire (24h format)",
      type: "time",
      default: "12:00",
    },
    {
      id: "days",
      label: "Days",
      description: "Days of the week to fire on (empty = every day)",
      type: "weekdays",
      default: [],
    },
  ],
};

export const OnStartupNodeDefinition: NodeDefinition = {
  type: "OnStartup",
  label: "On Startup",
  category: NodeCategory.Trigger,
  description: "Fires once when the device powers on",
  parameters: [],
  isSingleton: true,
};

export const OnPinEdgeNodeDefinition: NodeDefinition = {
  type: "OnPinEdge",
  label: "On Pin Edge",
  category: NodeCategory.Trigger,
  tags: [NodeTag.Pin],
  description: "Fires when a digital pin transitions",
  parameters: [
    {
      id: "pinReference",
      label: "Pin",
      description: "Digital pin to watch",
      type: "channelSelect",
      channelType: ["GPIOIN"],
    },
    {
      id: "edge",
      label: "Edge",
      description: "Edge transition that fires the trigger",
      type: "selection",
      options: [
        { value: "rising", label: "Rising" },
        { value: "falling", label: "Falling" },
        { value: "both", label: "Both" },
      ],
      default: "both",
    },
  ],
};

export const OnSerialReceiveNodeDefinition: NodeDefinition = {
  type: "OnSerialReceive",
  label: "On Serial Receive",
  category: NodeCategory.Trigger,
  tags: [NodeTag.Serial],
  description: "Fires when serial data arrives",
  outputs: [{ id: "output", label: "Serial Data", type: "static", dataType: "string" }],
  parameters: [
    {
      id: "portReference",
      label: "Port",
      description: "Serial port to listen on",
      type: "channelSelect",
      channelType: ["UART"],
    },
  ],
};

export const OnThresholdNodeDefinition: NodeDefinition = {
  type: "OnThreshold",
  label: "On Threshold",
  category: NodeCategory.Trigger,
  description: "Fires when a numeric variable crosses a threshold",
  outputs: [{ id: "output", label: "Triggering Value", type: "static", dataType: "float" }],
  parameters: [
    {
      id: "variable",
      label: "Variable",
      description: "Numeric variable to watch for threshold crossings",
      type: "variable-reference",
    },
    {
      id: "threshold",
      label: "Threshold",
      description: "Value the variable crosses to fire the trigger",
      type: "float",
      default: 0,
    },
    {
      id: "direction",
      label: "Direction",
      description: "Crossing direction to fire on",
      type: "selection",
      options: [
        { value: "rising", label: "Rising" },
        { value: "falling", label: "Falling" },
        { value: "both", label: "Both" },
      ],
      default: "both",
    },
    {
      id: "deadband",
      label: "Deadband",
      description: "Hysteresis band width around threshold (0 disables)",
      type: "float",
      default: 0,
      optional: true,
    },
  ],
};
