/** Canonical store key for a memory file. */
export function memoryFileKey(uid: string): string {
  return `mem:${uid}`;
}
