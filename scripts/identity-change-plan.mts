/** AB#259: deterministic offline change data; never a mutation request. */
import { canonicalJson, digest, LIMITS, reconcileIdentities, ReconciliationError } from "./identity-retirement-reconciliation.mts";

export const BATCH_LIMITS = { documents: 100, bytes: 256 * 1024 };
type Input = Parameters<typeof reconcileIdentities>[0];
type Fields = Record<string, { before: string; after: string }>;
type Document = Record<string, unknown> & { _id: string; _rev: string; _type: string };
type Change = { documentId: string; expectedRevision: string; fields: Fields };

// Unicode scalar order, independent of locale and the input's enumeration order.
function compare(a: string, b: string): number {
  const left = Array.from(a), right = Array.from(b);
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const delta = left[i].codePointAt(0)! - right[i].codePointAt(0)!;
    if (delta) return delta;
  }
  return left.length - right.length;
}
const sha = (value: unknown) => digest(Buffer.from(canonicalJson(value)));
/** Includes all values except the selected fields and CMS-managed update metadata.
 * Arrays retain order; canonicalJson uses ordinal UTF-16 object-key ordering.
 */
export function untouchedValuesDigest(document: Document, fields: Fields): string {
  return sha(Object.fromEntries(Object.entries(document).filter(([field]) =>
    field !== "_rev" && field !== "_updatedAt" && !Object.hasOwn(fields, field))));
}

export function planIdentityChanges(input: Input, maxDocumentsPerBatch = 50,
  budgets: { batchBytes?: number; reportBytes?: number } = {}) {
  if (!Number.isSafeInteger(maxDocumentsPerBatch) || maxDocumentsPerBatch < 1 || maxDocumentsPerBatch > BATCH_LIMITS.documents) {
    throw new ReconciliationError("INVALID_BATCH_LIMIT");
  }
  const batchBytes = budgets.batchBytes ?? BATCH_LIMITS.bytes, reportBytes = budgets.reportBytes ?? LIMITS.reportBytes;
  if (!Number.isSafeInteger(batchBytes) || batchBytes < 1 || batchBytes > BATCH_LIMITS.bytes ||
    !Number.isSafeInteger(reportBytes) || reportBytes < 1 || reportBytes > LIMITS.reportBytes) throw new ReconciliationError("INVALID_BATCH_LIMIT");
  if ([input.map, input.approval, input.baseline, input.snapshot].some(bytes => bytes.byteLength > LIMITS.bytes)) throw new ReconciliationError("INPUT_LIMIT");
  // Copy once: validation and native parsing consume the same private bytes.
  const data = { ...input, map: Buffer.from(input.map), approval: Buffer.from(input.approval), baseline: Buffer.from(input.baseline), snapshot: Buffer.from(input.snapshot) };
  const reconciliation = reconcileIdentities(data);
  if (reconciliation.status !== "consistent-old" || reconciliation.issues.length) throw new ReconciliationError("RECONCILIATION_BLOCKED");
  // Reconciliation has already strictly decoded and validated these exact inputs,
  // including duplicate JSON keys, map coverage, revisions and field families.
  const changes = (JSON.parse(data.map.toString("utf8")) as { proposedChanges: Change[] }).proposedChanges;
  const documents = new Map<string, Document>(data.snapshot.toString("utf8").trimEnd().split(/\r?\n/u).map(line => {
    const doc = JSON.parse(line) as Document; return [doc._id, doc];
  }));
  const records = changes.map(change => {
    const doc = documents.get(change.documentId)!;
    return {
      documentId: doc._id, documentType: doc._type, preWriteRevision: change.expectedRevision,
      fields: change.fields, untouchedValuesSha256: untouchedValuesDigest(doc, change.fields),
      rollback: {
        originalValues: Object.fromEntries(Object.entries(change.fields).map(([field, pair]) => [field, pair.before])),
        revisionSource: "verified-post-write-receipt" as const,
      },
    };
  }).sort((a, b) => compare(a.documentId, b.documentId));
  const parents = new Map(records.map(row => [row.documentId, row.documentId]));
  const root = (id: string): string => {
    let result = id;
    while (parents.get(result) !== result) result = parents.get(result)!;
    // Compress paths so large, transitive groups cannot create quadratic walks.
    while (id !== result) { const next = parents.get(id)!; parents.set(id, result); id = next; }
    return result;
  };
  const identityOwner = new Map<string, string>();
  for (const row of records) for (const pair of Object.values(row.fields)) {
    const owner = identityOwner.get(pair.before);
    if (owner) parents.set(root(row.documentId), root(owner));
    else identityOwner.set(pair.before, row.documentId);
  }
  const components = new Map<string, typeof records>();
  for (const row of records) {
    const group = root(row.documentId);
    if (!components.has(group)) components.set(group, []);
    components.get(group)!.push(row);
  }
  // Members were sorted first; the group's first member is its minimum ID.
  const groups = [...components.values()].sort((a, b) => compare(a[0].documentId, b[0].documentId));
  const batches: { sequence: number; groupSha256: string[]; documents: typeof records; batchSha256: string }[] = [];
  let pending: typeof records = [], groupDigests: string[] = [];
  const finish = () => {
    if (!pending.length) return;
    const body = { sequence: batches.length + 1, groupSha256: groupDigests, documents: pending };
    batches.push({ ...body, batchSha256: sha(body) }); pending = []; groupDigests = [];
  };
  const bytes = (rows: typeof records) => Buffer.byteLength(canonicalJson(rows));
  for (const group of groups) {
    if (group.length > maxDocumentsPerBatch || bytes(group) > batchBytes) throw new ReconciliationError("IDENTITY_GROUP_LIMIT");
    const next = [...pending, ...group];
    if (next.length > maxDocumentsPerBatch || bytes(next) > batchBytes) finish();
    pending.push(...group); groupDigests.push(sha(group.map(row => row.documentId)));
  }
  finish();
  const report = {
    version: "identity-change-plan-v1", writable: false, cutoverReady: false,
    reconciliationVersion: reconciliation.version, reconciliationSha256: reconciliation.reportSha256,
    digests: reconciliation.digests,
    limits: { documentsPerBatch: maxDocumentsPerBatch, documentDataBytesPerBatch: batchBytes },
    counts: { ...reconciliation.counts, groups: groups.length, batches: batches.length, largestGroupDocuments: groups.reduce((max, group) => Math.max(max, group.length), 0) },
    batches, rollbackOrder: "reverse-batch-sequence-requires-verified-receipts",
    remainingGates: reconciliation.remainingGates,
  };
  const result = { ...report, planSha256: sha(report) };
  if (Buffer.byteLength(canonicalJson(result)) + 1 > reportBytes) throw new ReconciliationError("PLAN_OUTPUT_LIMIT");
  return result;
}
