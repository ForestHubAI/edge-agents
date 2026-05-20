import type { Parameter } from "../parameter";

/**
 * Parameters that make up a MemoryFile. Mirrors CHANNEL_DEFINITION's shape so
 * the config panel can reuse ParameterEditor verbatim. `name` is the display
 * name (uniqueness is enforced in the panel, not in this definition).
 */
export interface MemoryFileDefinition {
  parameters: Parameter[];
}

export const MEMORY_FILE_DEFINITION: MemoryFileDefinition = {
  parameters: [
    {
      id: "name",
      label: "Name",
      description: "Display name exposed to the LLM as the memory file's identifier",
      type: "string",
    },
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
