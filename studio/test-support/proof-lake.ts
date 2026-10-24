import { evaluate, parse } from "groq-js/1";
import { PROOF_DELETE_SWEEP_QUERY, type ProofDeletionReader } from "../proof-delete";

type Doc = Record<string, unknown> & { _id: string; _rev: string };
/** A tiny Content Lake: fresh Doc reads, a query index that may lag, and atomic transactions. */
export function lake(initial: Record<string, unknown>[]) {
  const docs = new Map<string, Doc>();
  let counter = 0;
  const put = (value: Record<string, unknown>) => docs.set(value._id as string, { ...value, _rev: `r${++counter}` } as Doc);
  initial.forEach(put);
  let index: Doc[] | undefined;
  const reader: ProofDeletionReader = {
    async docs(ids, allVersions) {
      if (allVersions) {
        return { documents: [...docs.values()].filter((doc) => ids.some((id) => doc._id === id || doc._id === `drafts.${id}` || new RegExp(`^versions\\.[^.]+\\.${id.replace(/\./gu, "\\.")}$`, "u").test(doc._id))), omitted: ids.filter((id) => !docs.has(id)).map((id) => ({ id, reason: "existence" })) };
      }
      return { documents: ids.flatMap((id) => docs.has(id) ? [docs.get(id)] : []), omitted: ids.filter((id) => !docs.has(id)).map((id) => ({ id, reason: "existence" })) };
    },
    async sweep(galleryId, ids, assetIds) {
      return (await evaluate(parse(PROOF_DELETE_SWEEP_QUERY), { dataset: index ?? [...docs.values()], params: { galleryId, ids, assetIds } })).get();
    },
  };
  function commit(mutations: readonly Record<string, unknown>[]) {
    const next = new Map(docs);
    for (const mutation of mutations) {
      if ("create" in mutation || "createOrReplace" in mutation) {
        const doc = (mutation.create ?? mutation.createOrReplace) as Doc;
        if ("create" in mutation && next.has(doc._id)) throw Object.assign(new Error("exists"), { statusCode: 409 });
        next.set(doc._id, { ...doc, _rev: `r${++counter}` });
      } else if ("patch" in mutation) {
        const patch = mutation.patch as { id: string; ifRevisionID?: string; set?: Record<string, unknown> };
        const current = next.get(patch.id);
        if (!current) throw Object.assign(new Error("missing"), { statusCode: 409 });
        if (patch.ifRevisionID !== undefined && patch.ifRevisionID !== current._rev) throw Object.assign(new Error("revision"), { statusCode: 409 });
        next.set(patch.id, { ...current, ...patch.set, _rev: `r${++counter}` });
      } else {
        next.delete((mutation.delete as { id: string }).id);
      }
    }
    // Content Lake refuses to delete a document a remaining one references strongly.
    const strong = (value: unknown): string[] => Array.isArray(value) ? value.flatMap(strong)
      : typeof value === "object" && value !== null
        ? [...(typeof (value as Doc)._ref === "string" && (value as Doc)._weak !== true ? [(value as Doc)._ref as string] : []), ...Object.values(value).flatMap(strong)]
        : [];
    if ([...next.values()].flatMap(strong).some((ref) => docs.has(ref) && !next.has(ref))) throw Object.assign(new Error("referenced"), { statusCode: 409 });
    docs.clear();
    next.forEach((value, key) => docs.set(key, value));
  }
  return { docs, put, reader, commit, freezeIndex: () => { index = [...docs.values()]; } };
}
