/**
 * Sanity reports an idle document as `{ enabled: false }`, an object, so a truthiness test treats
 * every loaded document as locked. Only an unreadable or enabled lock state blocks an action.
 */
export function transactionSyncLocked(lock: unknown): boolean {
  if (lock == null) return false;
  return typeof lock !== "object" || (lock as { enabled?: unknown }).enabled !== false;
}
