import type { MemoryDefinition } from "./MemoryDefinition";

/**
 * RAG knowledge base referenced from Retriever nodes. Only descriptive config
 * lives here; the backend collection it binds to is supplied at deploy time.
 */
export const VectorDatabaseDefinition: MemoryDefinition = {
  type: "VectorDatabase",
  label: "Vector Database",
  description: "RAG knowledge base that Retriever nodes can query",
  parameters: [
    {
      id: "description",
      label: "Description",
      description: "What this knowledge base contains",
      type: "string",
      multiline: true,
      optional: true,
    },
  ],
};
