/** AB#368: offline first-adoption evidence. No CMS client or executable mutations. */
import { canonicalJson, digest, LIMITS, strictJson } from "./identity-retirement-reconciliation.mts";

export const ADOPTION_LIMITS = { ...LIMITS, bytes: 64 * 1024 * 1024, manifestBytes: 2 * 1024 * 1024, members: 2000, reportBytes: 8 * 1024 * 1024 };
// Parity-tested against the Studio contract; the Node CLI must not load Studio.
export const SECTION_CONTRACT = { sections: 20, id: 248, slug: 256, label: 256, heading: 160 };
export const SCHEMA_CONTRACT = "ADR0036/article-end-sections-v1";
export class AdoptionPlanError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = "AdoptionPlanError"; this.code = code; }
}
type Row = Record<string, unknown>;
type Document = Row & { _id: string; _rev: string; _type: string };
type Section = { sectionId: string; slug: string; label: string };
type Member = { sourceItemId: string; sourceImageSha256: string; documentId: string; expectedRevision: string; placementId: string; mediaDocumentId: string; mediaRevision: string; mediaId: string; assetRef: string; sectionId: string };
function fail(code: string): never { throw new AdoptionPlanError(code); }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const sha = (value: unknown) => digest(Buffer.from(canonicalJson(value)));
function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_OBJECT");
  return value as Row;
}
function keys(value: Row, names: readonly string[]) {
  if (Object.keys(value).length !== names.length || names.some(name => !Object.hasOwn(value, name))) fail("INVALID_FIELDS");
}
function text(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.length > max || /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)) fail("INVALID_TEXT");
  return value;
}
function domain(value: unknown, max = 256): string {
  const s = text(value, max); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(s)) fail("INVALID_ID"); return s;
}
function documentId(value: unknown): string {
  const s = text(value); if (!/^[a-zA-Z0-9_.-]+$/u.test(s)) fail("INVALID_DOCUMENT_ID"); return s;
}
function hash(value: unknown): string {
  const s = text(value); if (!/^[a-f0-9]{64}$/u.test(s)) fail("INVALID_DIGEST"); return s;
}
function publicAt(endDate: unknown, observedAt: string): boolean {
  if (endDate == null) return true;
  if (typeof endDate !== "string" || !Number.isFinite(Date.parse(endDate))) return false;
  // Same calendar-prefix guard as content-page's isContentEnded, without a
  // runtime application import in the Node CLI. Parity-tested below.
  const date = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?=$|[Tt ])/.exec(endDate.trim());
  if (date) {
    const [, y, m, d] = date, probe = new Date(0);
    probe.setUTCFullYear(Number(y), Number(m) - 1, Number(d));
    if (probe.getUTCFullYear() !== Number(y) || probe.getUTCMonth() !== Number(m) - 1 || probe.getUTCDate() !== Number(d)) return false;
  }
  return Date.parse(endDate) > Date.parse(observedAt);
}
function baseId(id: string): string {
  if (id.startsWith("drafts.")) return id.slice(7);
  if (!id.startsWith("versions.")) return id;
  const parts = id.slice(9), at = parts.indexOf(".");
  if (at < 1 || at === parts.length - 1) fail("INVALID_VERSION_ID");
  return parts.slice(at + 1);
}
function ref(value: unknown): string {
  const r = row(value); if (r._type !== "reference") fail("INVALID_REFERENCE");
  const id = documentId(r._ref); if (baseId(id) !== id) fail("UNPUBLISHED_REFERENCE"); return id;
}
function decode(bytes: Uint8Array, max: number): string {
  if (!bytes.length || bytes.length > max) fail("INPUT_LIMIT");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) fail("INVALID_UTF8");
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { return fail("INVALID_UTF8"); }
}
function json(source: string, budget = { nodes: 0 }): unknown {
  try { return strictJson(source, ADOPTION_LIMITS, budget); } catch { return fail("INVALID_JSON"); }
}
function snapshot(bytes: Uint8Array) {
  const lines = decode(bytes, ADOPTION_LIMITS.bytes).split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.length > ADOPTION_LIMITS.documents) fail("SNAPSHOT_LIMIT");
  const docs = new Map<string, Document>(), variants = new Map<string, Document[]>(), budget = { nodes: 0 };
  for (const line of lines) {
    if (!line.trim()) fail("INVALID_NDJSON");
    const r = row(json(line, budget));
    const d = { ...r, _id: documentId(r._id), _rev: text(r._rev), _type: text(r._type) };
    if (docs.has(d._id)) fail("DUPLICATE_DOCUMENT");
    docs.set(d._id, d);
    const id = baseId(d._id), family = variants.get(id) ?? []; family.push(d); variants.set(id, family);
  }
  return { docs, variants };
}
function manifest(bytes: Uint8Array) {
  const m = row(json(decode(bytes, ADOPTION_LIMITS.manifestBytes)));
  keys(m, ["format", "snapshot", "article", "sourceEvidenceSha256", "heading", "sections", "members"]);
  if (m.format !== "article-end-adoption-intent-v1") fail("INVALID_FORMAT");
  const s = row(m.snapshot); keys(s, ["sha256", "documentCount", "observedAt"]);
  const observedAt = text(s.observedAt);
  if (!Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt) fail("INVALID_OBSERVATION_TIME");
  if (!Number.isSafeInteger(s.documentCount) || (s.documentCount as number) < 1 || (s.documentCount as number) > ADOPTION_LIMITS.documents) fail("INVALID_DOCUMENT_COUNT");
  const a = row(m.article); keys(a, ["documentId", "expectedRevision", "contentId", "language", "endGalleryId"]);
  const language = text(a.language); if (!/^[a-z]{2,3}$/u.test(language)) fail("INVALID_LANGUAGE");
  if (!Array.isArray(m.sections) || m.sections.length < 1 || m.sections.length > SECTION_CONTRACT.sections) fail("INVALID_CATALOG");
  const ids = new Set<string>(), slugs = new Set<string>();
  const sections: Section[] = m.sections.map(value => {
    const r = row(value); keys(r, ["sectionId", "slug", "label"]);
    const id = domain(r.sectionId, SECTION_CONTRACT.id), slug = domain(r.slug, SECTION_CONTRACT.slug), label = text(r.label, SECTION_CONTRACT.label);
    if (slug === "all" || ids.has(id) || slugs.has(slug)) fail("DUPLICATE_OR_RESERVED_SECTION");
    ids.add(id); slugs.add(slug); return { sectionId: id, slug, label };
  });
  if (!Array.isArray(m.members) || !m.members.length || m.members.length > ADOPTION_LIMITS.members) fail("MEMBERS_LIMIT");
  const sourceIds = new Set<string>(), targetIds = new Set<string>();
  const members: Member[] = m.members.map(value => {
    const r = row(value); keys(r, ["sourceItemId", "sourceImageSha256", "documentId", "expectedRevision", "placementId", "mediaDocumentId", "mediaRevision", "mediaId", "assetRef", "sectionId"]);
    const member = { sourceItemId: text(r.sourceItemId), sourceImageSha256: hash(r.sourceImageSha256), documentId: documentId(r.documentId), expectedRevision: text(r.expectedRevision), placementId: domain(r.placementId), mediaDocumentId: documentId(r.mediaDocumentId), mediaRevision: text(r.mediaRevision), mediaId: domain(r.mediaId), assetRef: documentId(r.assetRef), sectionId: domain(r.sectionId, SECTION_CONTRACT.id) };
    if (sourceIds.has(member.sourceItemId) || targetIds.has(member.documentId) || !ids.has(member.sectionId)) fail("INVALID_MEMBER_BINDING");
    sourceIds.add(member.sourceItemId); targetIds.add(member.documentId); return member;
  }).sort((a, b) => compare(a.documentId, b.documentId));
  return { format: m.format, snapshot: { sha256: hash(s.sha256), documentCount: s.documentCount as number, observedAt }, article: { documentId: documentId(a.documentId), expectedRevision: text(a.expectedRevision), contentId: domain(a.contentId), language, endGalleryId: domain(a.endGalleryId, 128) }, sourceEvidenceSha256: hash(m.sourceEvidenceSha256), heading: text(m.heading, SECTION_CONTRACT.heading), sections, members };
}

export function planArticleEndAdoption(input: { manifest: Uint8Array; snapshot: Uint8Array }) {
  const intent = manifest(input.manifest), inventory = snapshot(input.snapshot), { docs, variants } = inventory;
  if (digest(input.snapshot) !== intent.snapshot.sha256 || docs.size !== intent.snapshot.documentCount) fail("SNAPSHOT_PIN_MISMATCH");
  const used = new Map<string, Document>();
  function published(id: string, type?: string): Document {
    const d = docs.get(id);
    if (!d || baseId(id) !== id || (type && d._type !== type)) fail("MISSING_OR_FOREIGN_DOCUMENT");
    if (variants.get(id)?.length !== 1) fail("DRAFT_OR_RELEASE_CONFLICT");
    used.set(id, d); return d;
  }
  const a = intent.article, article = published(a.documentId, "article");
  if (article._rev !== a.expectedRevision || article.contentId !== a.contentId || article.language !== a.language || article.endGalleryId !== a.endGalleryId) fail("ARTICLE_BINDING_MISMATCH");
  if (!publicAt(article.endDate, intent.snapshot.observedAt)) fail("ARTICLE_NOT_PUBLIC_AT_OBSERVATION");
  const peerIds = new Set<string>([article._id]), languages = new Set<string>([a.language]);
  function absentCatalog(d: Document) {
    if (Object.hasOwn(d, "endGallerySections") || Object.hasOwn(d, "endGallerySectionHeading")) fail("EXISTING_CATALOG_STATE");
  }
  absentCatalog(article);
  for (const d of docs.values()) {
    if (d._id === article._id || (d.contentId !== a.contentId && d.endGalleryId !== a.endGalleryId)) continue;
    if (d._type !== "article" || d.contentId !== a.contentId || d.endGalleryId !== a.endGalleryId || typeof d.language !== "string" || !/^[a-z]{2,3}$/u.test(d.language) || languages.has(d.language)) fail("FOREIGN_OR_DUPLICATE_ARTICLE_IDENTITY");
    published(d._id, "article"); absentCatalog(d); languages.add(d.language); peerIds.add(d._id);
  }
  const own: Document[] = [], peerRows: Document[] = [], placementIds = new Set<string>();
  for (const d of docs.values()) {
    const rawRef = d.article && typeof d.article === "object" && !Array.isArray(d.article) ? (d.article as Row)._ref : undefined;
    if (typeof rawRef !== "string" || !peerIds.has(baseId(rawRef))) continue;
    if (d._type !== "articleEndGalleryPlacement" || !peerIds.has(ref(d.article))) fail("FOREIGN_PLACEMENT");
    published(d._id, "articleEndGalleryPlacement");
    if (Object.hasOwn(d, "sectionId")) fail("EXISTING_MEMBERSHIP_STATE");
    domain(d.placementId);
    if (!Number.isSafeInteger(d.order) || (d.order as number) < 0 || (Object.hasOwn(d, "visible") && typeof d.visible !== "boolean")) fail("INVALID_PLACEMENT");
    published(ref(d.media), "media");
    if (rawRef === article._id) {
      if (placementIds.has(d.placementId as string)) fail("DUPLICATE_PLACEMENT_IDENTITY");
      placementIds.add(d.placementId as string); own.push(d);
    } else peerRows.push(d);
  }
  // Identity reuse is allowed only for the same shared occurrence in a no-catalog peer.
  const allRows = [...own, ...peerRows];
  const scopedPlacements = new Map<string, string>(), occurrences = new Set<string>(), scopedRows = new Set(allRows);
  for (const d of allRows) {
    const id = d.placementId as string, media = ref(d.media), occurrence = `${ref(d.article)}:${id}`;
    if (occurrences.has(occurrence) || (scopedPlacements.has(id) && scopedPlacements.get(id) !== media)) fail("FOREIGN_PLACEMENT_IDENTITY");
    occurrences.add(occurrence); scopedPlacements.set(id, media);
  }
  for (const d of docs.values()) {
    if (typeof d.placementId === "string" && scopedPlacements.has(d.placementId) && !scopedRows.has(d)) fail("FOREIGN_PLACEMENT_IDENTITY");
  }
  const visible = own.filter(d => d.visible === true).sort((x, y) => (x.order as number) - (y.order as number) || compare(x.placementId as string, y.placementId as string));
  if (visible.length !== intent.members.length) fail("VISIBLE_MEMBERSHIP_MISMATCH");
  const byDocument = new Map(intent.members.map(member => [member.documentId, member]));
  const mediaIds = new Map<string, string>();
  for (const d of [...own, ...peerRows]) {
    const media = published(ref(d.media), "media"), id = domain(media.mediaId);
    mediaIds.set(id, media._id);
  }
  for (const d of docs.values()) if (typeof d.mediaId === "string" && mediaIds.has(d.mediaId) && mediaIds.get(d.mediaId) !== d._id) fail("FOREIGN_MEDIA_IDENTITY");
  for (const d of visible) {
    const member = byDocument.get(d._id), media = published(ref(d.media), "media");
    if (!member || member.placementId !== d.placementId || member.expectedRevision !== d._rev || member.mediaDocumentId !== media._id || member.mediaRevision !== media._rev || member.mediaId !== media.mediaId || media.mediaType !== "image") fail("MEMBER_BINDING_MISMATCH");
    if (media.publiclyRenderable !== true || (media.privateOnly !== undefined && media.privateOnly !== false && media.privateOnly !== null)) fail("NONPUBLIC_VISIBLE_MEDIA");
    const asset = published(ref(row(media.image).asset), "sanity.imageAsset");
    if (member.assetRef !== asset._id) fail("ASSET_BINDING_MISMATCH");
  }
  // Verify the complete referenced closure, including unchanged prose/hidden rows.
  const queue = [...used.values()];
  for (let i = 0; i < queue.length; i++) {
    const visit = (v: unknown): void => {
      if (Array.isArray(v)) { v.forEach(visit); return; }
      if (!v || typeof v !== "object") return;
      const r = v as Row;
      if (Object.hasOwn(r, "_ref")) {
        const id = ref(r), known = used.has(id), d = published(id);
        if (!known) queue.push(d);
      }
      Object.values(r).forEach(visit);
    };
    visit(queue[i]);
  }
  const afterSections = intent.sections.map(s => ({ _type: "object", _key: sha(s.sectionId).slice(0, 32), ...s }));
  const changes = [{ doc: article, after: { endGallerySectionHeading: intent.heading, endGallerySections: afterSections } as Row }, ...visible.map(doc => ({ doc, after: { sectionId: byDocument.get(doc._id)!.sectionId } as Row }))].map(({ doc, after }) => ({
    documentId: doc._id, documentType: doc._type, expectedRevision: doc._rev,
    beforeFields: Object.fromEntries(Object.keys(after).map(k => [k, { exists: false }])), afterFields: after,
    untouchedValuesSha256: sha(Object.fromEntries(Object.entries(doc).filter(([k]) => k !== "_rev" && k !== "_updatedAt" && !Object.hasOwn(after, k)))),
  }));
  const changed = new Set(changes.map(c => c.documentId));
  const report = {
    format: "article-end-adoption-plan-v1", schemaContract: SCHEMA_CONTRACT, writable: false, approved: false, backup: false,
    snapshotCompletenessVerified: false, sourceAuthenticityVerified: false,
    inputs: { snapshotSha256: intent.snapshot.sha256, snapshotDocumentCount: docs.size, observedAt: intent.snapshot.observedAt, manifestSha256: sha(intent), sourceEvidenceSha256: intent.sourceEvidenceSha256 },
    target: a, catalog: afterSections, heading: intent.heading, bindings: intent.members,
    counts: { visible: visible.length, hidden: own.length - visible.length, changes: changes.length, readConditions: used.size, sections: intent.sections.map(s => ({ sectionId: s.sectionId, members: intent.members.filter(m => m.sectionId === s.sectionId).length })) },
    changes,
    readConditions: [...used.values()].sort((x, y) => compare(x._id, y._id)).map(d => ({ documentId: d._id, documentType: d._type, expectedRevision: d._rev, fullDocumentSha256: sha(d), advisory: !changed.has(d._id) })),
    limitations: ["Evidence only: no writer, approval, backup or deployed-schema confirmation.", "Raw snapshot digest/count pin supplied bytes; capture completeness, atomicity, time and source authenticity require independent evidence.", "Before writing, re-read the complete selected closure and recheck variants, membership, locales and public eligibility; unmodified read revisions are advisory, not transactional guards.", "A future writer must enforce change revisions and reviewed atomic-request limits; the member cap here is only a resource bound.", "First adoption makes incidental section parameters meaningful; unknown selectors return HTTP 404 and published IDs/slugs are immutable.", "Heading/labels/classification are supplied content requiring owner approval; no text parity, translations, rendered layout or asset-byte authenticity was verified.", "Untouched hashes exclude only changed fields, _rev and _updatedAt. Other fields and array ordering are preserved."],
  };
  const result = { ...report, planSha256: sha(report) };
  if (Buffer.byteLength(canonicalJson(result)) > ADOPTION_LIMITS.reportBytes) fail("OUTPUT_LIMIT");
  return result;
}
