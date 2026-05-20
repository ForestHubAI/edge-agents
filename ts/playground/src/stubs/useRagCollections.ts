// Stub for an embedder-provided hook that the visual-builder shouldn't
// depend on. Replaced by an injection point once useDynamicSelectionOptions
// is refactored. For now, no collections are listed in the playground.
export function useRagCollections() {
  return { collections: [] as Array<{ id: string; name: string }>, loading: false };
}
