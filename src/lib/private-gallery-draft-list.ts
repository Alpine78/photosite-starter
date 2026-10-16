/** Browser-safe merge: acknowledgements replace older revisions; page reads can preserve visible editors. */
export type PrivateDraftListRow = { readonly handle: string; readonly revision: number };
export type PrivateDraftPage<T> = { readonly items: readonly T[]; readonly hasMore: boolean; readonly nextCursor?: string };
export function appendPrivateDraftRows<T extends PrivateDraftListRow>(existing: readonly T[], incoming: readonly T[], options: { readonly preserveExisting?: boolean } = {}): readonly T[] {
  const rows = new Map(existing.map((row) => [row.handle, row]));
  for (const row of incoming) {
    const current = rows.get(row.handle);
    if (!current || (!options.preserveExisting && row.revision > current.revision)) rows.set(row.handle, row);
  }
  return [...rows.values()];
}
