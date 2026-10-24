/** Deterministic atomic Content Lake fixture, without a Studio or query-engine dependency. */
export type MemorySanityDocument = Record<string, unknown> & { _id: string; _rev: string };
export function memorySanityLake(initial: readonly Record<string, unknown>[]) {
  const docs = new Map<string, MemorySanityDocument>();
  let counter = 0;
  const put = (value: Record<string, unknown>) => docs.set(value._id as string, { ...value, _rev: `r${++counter}` } as MemorySanityDocument);
  initial.forEach(put);
  async function read(ids: readonly string[], allVersions = false) {
    const related = (id: string, base: string) => id === base || id === `drafts.${base}` ||
      id.startsWith("versions.") && id.indexOf(".", 9) > 9 && id.slice(id.indexOf(".", 9) + 1) === base;
    return {
      documents: [...docs.values()].filter((doc) => ids.some((id) => allVersions ? related(doc._id, id) : doc._id === id)),
      omitted: ids.filter((id) => !docs.has(id)).map((id) => ({ id, reason: "existence" })),
    };
  }
  function commit(mutations: readonly Readonly<Record<string, unknown>>[]) {
    const next = new Map(docs);
    const conflict = (reason: string): never => { throw Object.assign(new Error(reason), { statusCode: 409 }); };
    for (const mutation of mutations) {
      if ("create" in mutation || "createOrReplace" in mutation) {
        const doc = (mutation.create ?? mutation.createOrReplace) as MemorySanityDocument;
        if ("create" in mutation && next.has(doc._id)) conflict("exists");
        next.set(doc._id, { ...doc, _rev: `r${++counter}` });
      } else if ("patch" in mutation) {
        const patch = mutation.patch as { id: string; ifRevisionID?: string; set?: Record<string, unknown>; unset?: readonly string[] };
        const current = next.get(patch.id);
        if (!current) return conflict("missing");
        if (patch.ifRevisionID !== undefined && patch.ifRevisionID !== current._rev) conflict("revision");
        const updated: MemorySanityDocument = { ...current, ...patch.set, _rev: `r${++counter}` };
        for (const key of patch.unset ?? []) delete updated[key];
        next.set(patch.id, updated);
      } else {
        next.delete((mutation.delete as { id: string }).id);
      }
    }
    const strong = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(strong)
      : typeof value === "object" && value !== null
        ? [...(typeof (value as MemorySanityDocument)._ref === "string" && (value as MemorySanityDocument)._weak !== true ? [(value as MemorySanityDocument)._ref as string] : []), ...Object.values(value).flatMap(strong)]
        : [];
    if ([...next.values()].flatMap(strong).some((ref) => docs.has(ref) && !next.has(ref))) conflict("referenced");
    docs.clear(); next.forEach((value, key) => docs.set(key, value));
  }
  return { docs, put, read, commit };
}
