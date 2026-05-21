import type { MemoryDefinition } from "./MemoryDefinition";

/**
 * Agent-scoped durable text storage. The instance `label` (edited like a channel
 * label) is the identifier the LLM sees in tool calls, so it is not a parameter.
 * The config panel renders these parameters via ParameterEditor, same as channels.
 */
export const MemoryFileDefinition: MemoryDefinition = {
  type: "MemoryFile",
  label: "Memory File",
  description: "Durable text storage an agent can read and write",
  parameters: [
    {
      id: "description",
      label: "Description",
      description: "What this memory file is for (shown to the LLM as tool description)",
      type: "string",
      multiline: true,
      optional: true,
    },
    {
      id: "content",
      label: "Initial Content",
      description: "Seed content written on fresh deploy; existing rows keep their content on redeploy",
      type: "string",
      multiline: true,
      optional: true,
    },
    {
      id: "maxSizeBytes",
      label: "Max Size (bytes)",
      description: "Byte cap on writes; leave empty for unlimited",
      type: "int",
      optional: true,
    },
  ],
};
