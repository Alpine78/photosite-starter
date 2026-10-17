/** AB#258: local, deterministic reconciliation; never constructs a mutation. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const LIMITS = { bytes: 128 * 1024 * 1024, documents: 100_000, nodes: 5_000_000, depth: 64, reportBytes: 64 * 1024 * 1024 };
export class ReconciliationError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "ReconciliationError"; this.code = code; }
}
function fail(code: string): never { throw new ReconciliationError(code); }
export function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_OBJECT");
  return value as RecordValue;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value || value.length > 256 || /[\u0000-\u001f]/u.test(value)) fail("INVALID_STRING");
  return value;
}
function list(value: unknown): unknown[] { if (!Array.isArray(value)) fail("INVALID_ARRAY"); return value; }
function hash(value: unknown): string { const s = text(value); if (!/^[a-f0-9]{64}$/u.test(s)) fail("INVALID_DIGEST"); return s; }
const families = {
  contentId: ["article", "gallery"], categoryId: ["category"],
  endGalleryId: ["article"], placementId: ["galleryPlacement", "articleEndGalleryPlacement"],
} as const;
type Field = keyof typeof families;
type Mapping = { field: Field; oldId: string; newId: string };
type Change = { documentId: string; expectedRevision: string; fields: Record<string, { before: string; after: string }> };
type Doc = RecordValue & { _id: string; _rev: string; _type: string };
type Issue = { code: string; documentId?: string; field?: string; path?: string };
function domain(value: unknown): string {
  const s = text(value); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(s)) fail("INVALID_DOMAIN_ID"); return s;
}
function family(field: string, type: string): boolean {
  return Object.hasOwn(families, field) && (families[field as Field] as readonly string[]).includes(type);
}

/** Validate JSON before native parsing: duplicate decoded keys, depth and numbers.
 * Prototype-shaped keys remain ordinary own data; no assignment into prototypes.
 */
export function strictJson(source: string, limits: typeof LIMITS, budget = { nodes: 0 }): unknown {
  let offset = 0;
  const space = () => { while (/\s/u.test(source[offset] ?? "") && offset < source.length) offset++; };
  const string = (): string => {
    const start = offset++;
    while (offset < source.length) {
      const c = source[offset++];
      if (c === "\\") offset++;
      else if (c === '"') {
        try { return JSON.parse(source.slice(start, offset)) as string; } catch { fail("INVALID_JSON"); }
      }
    }
    fail("INVALID_JSON");
  };
  const value = (depth: number): void => {
    if (depth > limits.depth || ++budget.nodes > limits.nodes) fail("INPUT_LIMIT");
    space();
    const c = source[offset];
    if (c === '"') { string(); return; }
    if (c === "{" || c === "[") {
      offset++;
      const end = c === "{" ? "}" : "]", keys = new Set<string>();
      space(); if (source[offset] === end) { offset++; return; }
      for (;;) {
        if (c === "{") {
          space(); if (source[offset] !== '"') fail("INVALID_JSON");
          const key = string(); if (keys.has(key)) fail("DUPLICATE_JSON_KEY"); keys.add(key);
          space(); if (source[offset++] !== ":") fail("INVALID_JSON");
        }
        value(depth + 1); space();
        const separator = source[offset++];
        if (separator === end) return;
        if (separator !== ",") fail("INVALID_JSON");
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/u.exec(source.slice(offset))?.[0];
    if (!token) fail("INVALID_JSON");
    if (/^-?\d/u.test(token)) {
      const number = Number(token);
      if (!Number.isFinite(number) || Object.is(number, -0) || (Number.isInteger(number) && !Number.isSafeInteger(number))) fail("UNSAFE_NUMBER");
    }
    offset += token.length;
  };
  value(0); space(); if (offset !== source.length) fail("INVALID_JSON");
  try { return JSON.parse(source); } catch { fail("INVALID_JSON"); }
}
function decode(bytes: Uint8Array, limits: typeof LIMITS): string {
  if (bytes.byteLength > limits.bytes) fail("INPUT_LIMIT");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail("UTF8_BOM");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("INVALID_UTF8"); }
}
function snapshot(bytes: Uint8Array, limits: typeof LIMITS): Map<string, Doc> {
  const lines = decode(bytes, limits).split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop(); // One final LF/CRLF is allowed; internal blank lines are not.
  if (!lines.length || lines.length > limits.documents) fail("SNAPSHOT_LIMIT");
  const docs = new Map<string, Doc>();
  const budget = { nodes: 0 };
  for (const line of lines) {
    if (!line.trim()) fail("EMPTY_NDJSON_RECORD");
    const raw = record(strictJson(line, limits, budget));
    const doc = { ...raw, _id: text(raw._id), _rev: text(raw._rev), _type: text(raw._type) };
    if (docs.has(doc._id)) fail("DUPLICATE_DOCUMENT");
    docs.set(doc._id, doc);
  }
  return docs;
}
export function canonicalJson(value: unknown): string {
  const normalize = (v: unknown): unknown => Array.isArray(v) ? v.map(normalize)
    : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => compare(a, b)).map(([k, item]) => [k, normalize(item)])) : v;
  return JSON.stringify(normalize(value));
}
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
function baseId(id: string): string {
  if (id.startsWith("drafts.")) return id.slice(7);
  if (id.startsWith("versions.")) {
    const remainder = id.slice(9), separator = remainder.indexOf(".");
    return separator < 0 ? remainder : remainder.slice(separator + 1);
  }
  return id;
}

export function reconcileIdentities(input: {
  map: Uint8Array; approval: Uint8Array; baseline: Uint8Array; snapshot: Uint8Array; approvedDigest: string;
}, overrides: Partial<typeof LIMITS> = {}) {
  const limits = { ...LIMITS, ...overrides };
  const mapDigest = digest(input.map), baselineDigest = digest(input.baseline), currentDigest = digest(input.snapshot);
  if (mapDigest !== hash(input.approvedDigest)) fail("MAP_DIGEST_MISMATCH");
  const map = record(strictJson(decode(input.map, limits), limits));
  const approval = record(strictJson(decode(input.approval, limits), limits));
  if (hash(approval.candidateFileSha256) !== mapDigest) fail("APPROVAL_MAP_MISMATCH");
  if (hash(map.snapshotSha256) !== baselineDigest || hash(approval.snapshotFileSha256) !== baselineDigest) fail("BASELINE_DIGEST_MISMATCH");
  if (map.version !== "ab257-private-proposal-v1" || map.writable !== false) fail("UNSUPPORTED_MAP");
  const scope = record(approval.acceptedScope);
  if (scope.retainSanityDocumentIds !== true || scope.retainSanityReferences !== true || approval.productionWriteApproved !== false) fail("UNSUPPORTED_APPROVAL");
  const baseline = snapshot(input.baseline, limits), current = snapshot(input.snapshot, limits);
  const mappings: Mapping[] = [], byField = new Map<string, Map<string, Mapping>>();
  const olds = new Set<string>(), news = new Set<string>();
  for (const raw of list(map.mapping)) {
    const row = record(raw), field = text(row.field);
    if (!Object.hasOwn(families, field)) fail("UNSUPPORTED_FIELD");
    const oldId = domain(row.oldId), newId = domain(row.newId);
    const maxLength = field === "contentId" || field === "categoryId" ? 64 : field === "endGalleryId" ? 128 : 256;
    if (newId.length > maxLength || !oldId.startsWith("joomla-") || newId.startsWith("joomla-") || olds.has(oldId) || news.has(newId)) fail("MAPPING_COLLISION");
    olds.add(oldId); news.add(newId);
    const mapping = { field: field as Field, oldId, newId }; mappings.push(mapping);
    if (!byField.has(field)) byField.set(field, new Map());
    byField.get(field)!.set(oldId, mapping);
  }
  if (!mappings.length || [...news].some(id => olds.has(id))) fail("MAPPING_COLLISION");
  for (const field of Object.keys(families)) if (scope[field] !== (byField.get(field)?.size ?? 0)) fail("APPROVAL_COUNTS_MISMATCH");
  if (scope.totalDomainIdentities !== mappings.length) fail("APPROVAL_COUNTS_MISMATCH");
  const lookup = (field: string, value: unknown, type: string) => {
    if (typeof value !== "string") return undefined;
    if (field === "featuredGalleryId" && type === "siteSettings") return byField.get("contentId")?.get(value);
    return family(field, type) ? byField.get(field)?.get(value) : undefined;
  };
  const changes = new Map<string, Change>();
  const usedOlds = new Set<string>();
  let fieldCount = 0;
  for (const raw of list(map.proposedChanges)) {
    const row = record(raw), id = text(row.documentId), revision = text(row.expectedRevision), fields = record(row.fields);
    const doc = baseline.get(id);
    if (!doc || doc._rev !== revision || changes.has(id) || !Object.keys(fields).length) fail("INVALID_BASELINE_CHANGE");
    const selected: Change["fields"] = {};
    for (const [field, rawPair] of Object.entries(fields)) {
      const pair = record(rawPair), before = domain(pair.before), after = domain(pair.after), mapping = lookup(field, before, doc._type);
      if (!mapping || mapping.newId !== after || doc[field] !== before) fail("INVALID_BASELINE_CHANGE");
      selected[field] = { before, after }; fieldCount++; usedOlds.add(before);
    }
    changes.set(id, { documentId: id, expectedRevision: revision, fields: selected });
  }
  if (scope.documents !== changes.size || scope.fieldChanges !== fieldCount) fail("APPROVAL_COUNTS_MISMATCH");
  for (const doc of baseline.values()) for (const [field, value] of Object.entries(doc)) {
    const mapping = lookup(field, value, doc._type);
    if (mapping && !Object.hasOwn(changes.get(doc._id)?.fields ?? {}, field)) fail("INCOMPLETE_APPROVED_MAP");
    if (family(field, doc._type) && typeof value === "string" && news.has(value)) fail("BASELINE_TARGET_COLLISION");
  }
  for (const mapping of mappings) if (!usedOlds.has(mapping.oldId)) fail("UNUSED_MAPPING");

  const issues: Issue[] = [], classifications: { documentId: string; state: string; fieldStates: Record<string, string>; revisionChanged: boolean }[] = [];
  const baselineBases = new Set([...baseline.keys()].map(baseId));
  const currentBases = new Set([...current.keys()].map(baseId));
  const referenceIssue = (obj: RecordValue, index: Map<string, Doc>): string | undefined => {
    const ref = obj._ref;
    if (typeof ref !== "string" || !ref) return "INVALID_REFERENCE";
    if (Object.hasOwn(obj, "_dataset") || Object.hasOwn(obj, "_projectId") || ref.includes(":")) return "EXTERNAL_REFERENCE";
    if (index.has(ref)) return undefined;
    return obj._weak === true ? "MISSING_WEAK_REFERENCE" : /^(image|file)-/u.test(ref) ? "MISSING_ASSET_REFERENCE" : (index === baseline ? baselineBases : currentBases).has(ref) ? "UNPUBLISHED_REFERENCE_TARGET" : "DANGLING_REFERENCE";
  };
  let baselineNodes = 0;
  const checkBaselineReferences = (value: unknown): void => {
    if (++baselineNodes > limits.nodes) fail("INPUT_LIMIT");
    if (Array.isArray(value)) value.forEach(checkBaselineReferences);
    else if (value && typeof value === "object") {
      const obj = value as RecordValue;
      if (Object.hasOwn(obj, "_ref") && referenceIssue(obj, baseline)) fail("INVALID_BASELINE_REFERENCE");
      Object.values(obj).forEach(checkBaselineReferences);
    }
  };
  baseline.forEach(checkBaselineReferences);
  const approvedFields = new Map<string, Change["fields"]>();
  for (const change of changes.values()) {
    approvedFields.set(change.documentId, change.fields);
    const doc = current.get(change.documentId);
    const fieldStates = Object.fromEntries(Object.entries(change.fields).map(([field, pair]) => [field, doc?.[field] === pair.before ? "old" : doc?.[field] === pair.after ? "already-new" : "conflict"]));
    const states = new Set(Object.values(fieldStates));
    const state = !doc || states.size !== 1 ? "conflict" : [...states][0];
    const revisionChanged = !!doc && doc._rev !== change.expectedRevision;
    classifications.push({ documentId: change.documentId, state, fieldStates, revisionChanged });
    if (state === "conflict") issues.push({ code: doc ? "FIELD_CONFLICT" : "MISSING_APPROVED_DOCUMENT", documentId: change.documentId });
    if (revisionChanged) issues.push({ code: "REVISION_DRIFT", documentId: change.documentId });
    if (states.has("already-new")) issues.push({ code: "WRITE_RECEIPT_REQUIRED", documentId: change.documentId });
    if (doc) {
      const omit = (d: Doc) => Object.fromEntries(Object.entries(d).filter(([field]) => field !== "_rev" && !Object.hasOwn(change.fields, field)));
      if (!isDeepStrictEqual(omit(doc), omit(baseline.get(change.documentId)!))) issues.push({ code: "MAPPED_DOCUMENT_CHANGED", documentId: change.documentId });
    }
  }
  // One literal alternation consumes longest old/new spans, avoiding parent-ID
  // hits inside known placements or inside a recognized target identity.
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const expression = new RegExp([...olds, ...news].sort((a, b) => b.length - a.length || compare(a, b)).map(escape).join("|"), "gu");
  let references = 0, walked = 0;
  const variants: { documentId: string; publishedId: string; publishedPresent: boolean }[] = [];
  for (const doc of current.values()) {
    let affected = changes.has(doc._id);
    for (const [field, value] of Object.entries(doc)) {
      if (!family(field, doc._type) && !(doc._type === "siteSettings" && field === "featuredGalleryId")) continue;
      if (typeof value !== "string") { issues.push({ code: "INVALID_IDENTITY_FIELD", documentId: doc._id, field }); continue; }
      const mapping = lookup(field, value, doc._type), selected = approvedFields.get(doc._id)?.[field];
      if (mapping || news.has(value)) {
        affected = true;
        if (!selected) issues.push({ code: "ADDITIONAL_MAPPED_FIELD", documentId: doc._id, field });
        if (news.has(value) && (!selected || selected.after !== value)) issues.push({ code: "TARGET_COLLISION", documentId: doc._id, field });
      } else if (value.startsWith("joomla-")) issues.push({ code: "UNMAPPED_LEGACY_ID", documentId: doc._id, field });
    }
    if (affected && (doc._id.startsWith("drafts.") || doc._id.startsWith("versions."))) {
      const publishedId = baseId(doc._id);
      variants.push({ documentId: doc._id, publishedId, publishedPresent: current.has(publishedId) });
      issues.push({ code: "AFFECTED_UNPUBLISHED_VARIANT", documentId: doc._id });
    }
    const walk = (value: unknown, path: string[], depth: number): void => {
      if (++walked > limits.nodes || depth > limits.depth) fail("INPUT_LIMIT");
      if (Array.isArray(value)) { value.forEach((item, index) => walk(item, [...path, String(index)], depth + 1)); return; }
      if (value && typeof value === "object") {
        const obj = value as RecordValue;
        if (Object.hasOwn(obj, "_ref")) {
          references++;
          const code = referenceIssue(obj, current);
          if (code) issues.push({ code, documentId: doc._id, path: [...path, "_ref"].join(".") });
        }
        for (const [key, item] of Object.entries(obj)) walk(item, [...path, key], depth + 1);
      } else if (typeof value === "string") {
        if ((path.length === 1 && path[0] === "_id") || path.at(-1) === "_ref") return;
        if (path.length === 1 && lookup(path[0], value, doc._type)) return;
        if (!value.includes("joomla-")) return;
        expression.lastIndex = 0;
        for (const match of value.matchAll(expression)) if (olds.has(match[0])) {
          issues.push({ code: "UNKNOWN_IDENTITY_CONSUMER", documentId: doc._id, path: path.join(".") }); break;
        }
      }
    };
    walk(doc, [], 0);
  }
  const sorted = <T,>(rows: T[]) => rows.sort((a, b) => compare(canonicalJson(a), canonicalJson(b)));
  const snapshotDelta = {
    added: [...current.keys()].filter(id => !baseline.has(id)).sort(compare),
    removed: [...baseline.keys()].filter(id => !current.has(id)).sort(compare),
    changed: [...current.keys()].filter(id => baseline.has(id) && !isDeepStrictEqual(current.get(id), baseline.get(id))).sort(compare),
  };
  for (const id of snapshotDelta.removed) if (!changes.has(id)) issues.push({ code: "SNAPSHOT_DOCUMENT_REMOVED", documentId: id });
  const report = {
    version: "identity-reconciliation-v1", writable: false, cutoverReady: false,
    status: issues.length ? "blocked" : "consistent-old",
    writerReceiptRequired: classifications.some(row => Object.values(row.fieldStates).includes("already-new")),
    byteIdenticalToBaseline: baselineDigest === currentDigest,
    digests: { approvedMap: mapDigest, approval: digest(input.approval), baseline: baselineDigest, snapshot: currentDigest },
    counts: { mappedIdentities: mappings.length, approvedDocuments: changes.size, approvedFields: fieldCount, currentDocuments: current.size, references, issues: issues.length },
    classifications: sorted(classifications), issues: sorted(issues), affectedVariants: sorted(variants), snapshotDelta,
    remainingGates: ["snapshot-provenance-and-freeze", "accepted-deltas", "reader-import-writer-plan", "route-order-media-validation", "backup-restore-migration-rollback-rehearsal", "separate-cutover-approval"],
  };
  const body = canonicalJson(report);
  const result = { ...report, reportSha256: digest(Buffer.from(body)) };
  if (Buffer.byteLength(canonicalJson(result)) + 1 > limits.reportBytes) fail("REPORT_LIMIT");
  return result;
}
