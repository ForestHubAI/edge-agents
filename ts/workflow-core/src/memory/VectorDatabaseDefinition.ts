import type { MemoryDefinition } from "./MemoryDefinition";

/**
 * RAG knowledge base referenced from Retriever nodes. The backend collection it
 * maps to is a deploy-time binding (see VectorDatabase.collectionId in the
 * contract, emitted as "" by the editor), so it is not an editor parameter —
 * only descriptive config lives here.
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
