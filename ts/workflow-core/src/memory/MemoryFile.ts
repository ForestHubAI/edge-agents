// Domain MemoryFile — agent-scoped durable storage declared in the workflow.
// `content` is the seed value: on a fresh deploy it's written into the agent's
// store; on redeploy the engine keeps the existing row's content. `name` is the
// label the LLM sees in tool calls (must be unique per agent).

export interface MemoryFileInstance {
  uid: string;
  name: string;
  description: string;
  content: string;
  /** Byte cap; null/undefined means unlimited. */
  maxSizeBytes?: number | null;
}
