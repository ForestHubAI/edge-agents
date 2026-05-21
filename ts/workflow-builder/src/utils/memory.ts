/** Canonical store key for a memory primitive. */
export function memoryKey(id: string): string {
  return `mem:${id}`;
}
