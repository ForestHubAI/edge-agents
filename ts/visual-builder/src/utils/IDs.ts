/**
 * Generate a unique ID with the given prefix.
 * Format: `${prefix}_${uuid_with_underscores}`
 */
export function generateId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "_")}`;
}
