/** AB#117: one existing home text value; never creates/publishes a draft or asset. */
import { createHash } from "node:crypto";
import { canonicalJson } from "./joomla-intro-summary.mts";
import { parsePublicReadTarget, type PublicReadTarget } from "./sanity-read-http.mts";

type ObjectValue = Record<string, unknown>;
const HEX = /^[0-9a-f]{64}$/u;
const ID = /^[A-Za-z0-9_-]{1,128}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export type PublicationField = "intro" | "photographerIntroduction.text";
function textRows(doc: ObjectValue, field: PublicationField): unknown {
  return field === "intro" ? doc.intro : object(doc.photographerIntroduction).text;
}
export const sha256 = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("SMOKE_OBJECT");
  return value as ObjectValue;
}
function jsonValue(value: unknown, depth = 0, budget = { nodes: 0 }): void {
  if (++budget.nodes > 20_000 || depth > 24) throw new Error("SMOKE_BOUND");
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (Array.isArray(value)) { for (const item of value) jsonValue(item, depth + 1, budget); return; }
  const obj = object(value);
  if (![Object.prototype, null].includes(Object.getPrototypeOf(obj))) throw new Error("SMOKE_JSON");
  for (const item of Object.values(obj)) jsonValue(item, depth + 1, budget);
}
export function sourceDocument(value: unknown): ObjectValue {
  jsonValue(value);
  const doc = object(value);
  if (typeof doc._id !== "string" || !ID.test(doc._id) || typeof doc._rev !== "string" || !ID.test(doc._rev) ||
    doc._type !== "homePage" || typeof doc._createdAt !== "string" || typeof doc._updatedAt !== "string" ||
    !Number.isFinite(Date.parse(doc._createdAt)) || !Number.isFinite(Date.parse(doc._updatedAt)) ||
    Buffer.byteLength(canonicalJson(doc)) > 128 * 1024) throw new Error("SMOKE_SOURCE");
  return doc;
}
export function contentDigest(doc: ObjectValue): string {
  return sha256(canonicalJson(Object.fromEntries(Object.entries(doc).filter(([key]) => !["_rev", "_updatedAt"].includes(key)))));
}
export function compilePublicationPlan(source: unknown, targetInput: PublicReadTarget, language: string, nonce: string, baselineDigest: string, field: PublicationField = "intro") {
  const doc = sourceDocument(source), target = parsePublicReadTarget(targetInput);
  if (!["intro", "photographerIntroduction.text"].includes(field)) throw new Error("SMOKE_FIELD");
  if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(language) || !UUID.test(nonce) || !HEX.test(baselineDigest)) throw new Error("SMOKE_ARGUMENT");
  const rows = textRows(doc, field);
  if (!Array.isArray(rows) || rows.length < 1 || rows.length > 8) throw new Error("SMOKE_INTRO");
  const intro = rows.map((entry) => {
    const row = object(entry);
    if (row._type !== "localizedText" || typeof row._key !== "string" || row._key.length < 1 || row._key.length > 96 ||
      typeof row.language !== "string" || typeof row.value !== "string" || !row.value.trim() || row.value.length > 10_000) throw new Error("SMOKE_INTRO");
    return row;
  });
  if (new Set(intro.map((r) => r.language)).size !== intro.length || new Set(intro.map((r) => r._key)).size !== intro.length ||
    intro.filter((r) => r.language === language).length !== 1) throw new Error("SMOKE_LANGUAGE");
  const marker = `[Publication verification ${nonce}]`;
  if (String(intro.find((r) => r.language === language)!.value).length + marker.length + 2 > 10_000) throw new Error("SMOKE_INTRO_BOUND");
  if (canonicalJson(doc).includes(nonce)) throw new Error("SMOKE_NONCE_ALREADY_PRESENT");
  const changed = intro.map((r) => r.language === language ? { ...r, value: `${r.value}\n\n${marker}` } : { ...r });
  const proposed: ObjectValue = field === "intro" ? { ...doc, intro: changed }
    : { ...doc, photographerIntroduction: { ...object(doc.photographerIntroduction), text: changed } };
  sourceDocument(proposed);
  const body = { version: 1, target, field, language, nonce, baselineDigest, source: doc, proposed, marker } as const;
  jsonValue(body);
  return { ...body, digest: sha256(canonicalJson(body)) };
}
export type PublicationPlan = ReturnType<typeof compilePublicationPlan>;
export function validatePublicationPlan(value: unknown, approvedDigest?: string): PublicationPlan {
  const p = object(value);
  jsonValue(p);
  const t = object(p.target);
  const compiled = compilePublicationPlan(p.source, { projectId: String(t.projectId), dataset: String(t.dataset), apiVersion: String(t.apiVersion) }, String(p.language), String(p.nonce), String(p.baselineDigest), String(p.field) as PublicationField);
  if (canonicalJson(p) !== canonicalJson(compiled) || (approvedDigest !== undefined && compiled.digest !== approvedDigest)) throw new Error("SMOKE_PLAN_DIGEST");
  return compiled;
}
/** These are owner-reviewed attestations, not automatic proof of backup completeness. */
export function requireRecoveryEvidence(plan: PublicationPlan, evidence: unknown): void {
  const e = object(evidence);
  if (e.version !== 1 || canonicalJson(e.target) !== canonicalJson(plan.target) || e.documentsComplete !== true ||
    e.assetsComplete !== true || e.restoreReady !== true || e.sourceDocumentSha256 !== sha256(canonicalJson(plan.source)) ||
    typeof e.documentSnapshotSha256 !== "string" || !HEX.test(e.documentSnapshotSha256) ||
    typeof e.assetManifestSha256 !== "string" || !HEX.test(e.assetManifestSha256)) throw new Error("SMOKE_RECOVERY_EVIDENCE");
}
export function singleCurrentDocument(plan: PublicationPlan, rows: unknown): ObjectValue {
  if (!Array.isArray(rows) || rows.length !== 1) throw new Error("SMOKE_VERSION_CONFLICT");
  const doc = sourceDocument(rows[0]);
  if (doc._id !== plan.source._id) throw new Error("SMOKE_DOCUMENT_ID");
  return doc;
}
export function smokeMutation(plan: PublicationPlan, current: ObjectValue, phase: "apply" | "restore", appliedRevision?: string) {
  sourceDocument(current);
  const expected = phase === "apply" ? plan.source : plan.proposed;
  const revision = phase === "apply" ? plan.source._rev : appliedRevision;
  if (typeof revision !== "string" || !ID.test(revision) || (phase === "restore" && revision === plan.source._rev) ||
    current._rev !== revision || contentDigest(current) !== contentDigest(expected)) throw new Error("SMOKE_STALE_SOURCE");
  return { patch: { id: String(plan.source._id), ifRevisionID: revision, set: { [plan.field]: textRows(phase === "apply" ? plan.proposed : plan.source, plan.field) } } };
}
export function restoreRevision(plan: PublicationPlan, receipt: unknown): string {
  const r = object(receipt);
  if (r.version !== 1 || r.planDigest !== plan.digest || r.phase !== "apply" || r.status !== "applied" ||
    typeof r.observedRevision !== "string" || !ID.test(r.observedRevision) || r.observedRevision === plan.source._rev ||
    r.contentDigest !== contentDigest(plan.proposed)) throw new Error("SMOKE_RESTORE_RECEIPT");
  return r.observedRevision;
}
export function reconcilePublication(plan: PublicationPlan, rows: unknown, phase: "apply" | "restore", previousRevision: string) {
  const doc = singleCurrentDocument(plan, rows), expected = phase === "apply" ? plan.proposed : plan.source;
  if (doc._rev !== previousRevision && contentDigest(doc) === contentDigest(expected)) {
    return { status: phase === "apply" ? "applied" : "restored", observedRevision: doc._rev as string, observedUpdatedAt: doc._updatedAt as string, contentDigest: contentDigest(doc) } as const;
  }
  const prior = phase === "apply" ? plan.source : plan.proposed;
  if (doc._rev === previousRevision && contentDigest(doc) === contentDigest(prior)) return { status: "unchanged" as const };
  return { status: "unexpected" as const };
}
