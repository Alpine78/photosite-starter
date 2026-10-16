/** Browser-safe list merge: acknowledged revisions survive older page overlaps. */
export type PrivateDraftListRow = { readonly handle: string; readonly revision: number };
export type PrivateDraftPage<T> = { readonly items: readonly T[]; readonly hasMore: boolean; readonly nextCursor?: string };
export function appendPrivateDraftRows<T extends PrivateDraftListRow>(existing: readonly T[], incoming: readonly T[]): readonly T[] {
  const rows = new Map(existing.map((row) => [row.handle, row]));
  for (const row of incoming) {
    const current = rows.get(row.handle);
    if (!current || row.revision > current.revision) rows.set(row.handle, row);
  }
  return [...rows.values()];
}
