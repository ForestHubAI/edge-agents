// Stub for an embedder-provided hook. See useRagCollections.ts.
type Model = { id: string; label: string; capabilities: string[] };

export function useAvailableProviders() {
  return { models: [] as Model[], loading: false };
}
