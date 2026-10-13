/** Offline metadata census, never a translation acceptance or publish decision. */
import { createHash } from "node:crypto";
export const CENSUS_LIMITS = { bytes: 256 * 1024 * 1024, lineBytes: 4 * 1024 * 1024, documents: 100_000 };
export const CENSUS_MAX_CATEGORY_DEPTH = 5;
type Document = Record<string, unknown> & { _id: string; _rev: string; _type: string };
export type CensusRow = { id: string; revision: string; type: string; identity: string; language?: string; state: "published" | "draft" | "release"; rootId: string; pendingFields: number; blockers: string[] };
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const stable = (value: unknown): value is string => typeof value === "string" && value.length <= 200 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const documentId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,199}$/.test(value);
export function snapshotDocuments(bytes: Buffer): Document[] {
  if (bytes.length > CENSUS_LIMITS.bytes) throw new Error("SNAPSHOT_LIMIT");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes), lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.length > CENSUS_LIMITS.documents) throw new Error("DOCUMENT_LIMIT");
  const ids = new Set<string>();
  return lines.map(line => {
    if (!line.trim() || Buffer.byteLength(line) > CENSUS_LIMITS.lineBytes) throw new Error("LINE_LIMIT_OR_EMPTY");
    const d: unknown = JSON.parse(line);
    if (!object(d) || !documentId(d._id) || !documentId(d._rev) || typeof d._type !== "string" || !/^[a-zA-Z0-9_.-]{1,100}$/.test(d._type) || ids.has(d._id)) throw new Error("INVALID_OR_DUPLICATE_DOCUMENT");
    ids.add(d._id);
    return d as Document;
  });
}
function versionOf(id: string): Pick<CensusRow, "state" | "rootId"> {
  if (id.startsWith("drafts.")) {
    const rootId = id.slice(7);
    if (!rootId || rootId.startsWith("drafts.") || rootId.startsWith("versions.")) throw new Error("INVALID_DRAFT_ID");
    return { state: "draft", rootId };
  }
  if (id.startsWith("versions.")) {
    const parts = id.slice(9).split(".");
    if (parts.length < 2 || parts.some(v => !v)) throw new Error("INVALID_RELEASE_ID");
    return { state: "release", rootId: parts.slice(1).join(".") };
  }
  return { state: "published", rootId: id };
}
function categoryHas(d: Document, field: string, language: string): boolean {
  const entries = d[field];
  if (!Array.isArray(entries) || entries.length > 50) return false;
  const selected = entries.filter(e => object(e) && e.language === language);
  return selected.length === 1 && object(selected[0]) && typeof selected[0].value === "string" && selected[0].value.trim().length > 0 &&
    (field !== "slug" || stable(selected[0].value));
}
export function publicationLocaleCensus(bytes: Buffer, languages: readonly string[]) {
  if (languages.length < 2 || languages.length > 10 || new Set(languages).size !== languages.length || languages.some(v => !/^[a-z]{2,3}$/.test(v))) throw new Error("INVALID_LANGUAGES");
  const documents = snapshotDocuments(bytes), selected = documents.filter(d => ["article", "gallery", "service", "category"].includes(d._type));
  const rows: CensusRow[] = selected.map(d => {
    const identity = d[d._type === "category" ? "categoryId" : d._type === "service" ? "serviceId" : "contentId"];
    if (!stable(identity) || (d._type !== "category" && (typeof d.language !== "string" || !languages.includes(d.language)))) throw new Error("INVALID_CONTENT_IDENTITY_OR_LANGUAGE");
    const row: CensusRow = { id: d._id, revision: d._rev, type: d._type, identity, ...versionOf(d._id), pendingFields: 0, blockers: [] };
    if (d._type !== "category") row.language = d.language as string;
    if (d.localizationReview !== undefined) {
      const review = d.localizationReview;
      if (!object(review) || !Array.isArray(review.pendingFields) || review.pendingFields.length > 10_000 || review.pendingFields.some(v => typeof v !== "string" || v.length > 300 || !v.trim())) throw new Error("INVALID_REVIEW_STATE");
      row.pendingFields = review.pendingFields.length;
      if (row.pendingFields) row.blockers.push("EDITOR_REVIEW_PENDING");
      if (d.localizedFrom !== undefined && (typeof d.localizedFrom !== "string" || !languages.includes(d.localizedFrom) || review.sourceLanguage !== d.localizedFrom)) row.blockers.push("REVIEW_SOURCE_MISMATCH");
    } else if (d.localizedFrom !== undefined) row.blockers.push("REVIEW_STATE_MISSING");
    return row;
  });
  const byId = new Map(documents.map(d => [d._id, d]));
  const rowById = new Map(rows.map(row => [row.id, row]));
  const groups = new Map<string, CensusRow[]>();
  for (const row of rows) {
    const key = JSON.stringify([row.type, row.identity, row.language ?? null]);
    const group = groups.get(key) ?? []; group.push(row); groups.set(key, group);
  }
  for (const group of groups.values()) {
    // Draft + published versions of the same document are legitimate. Distinct
    // root IDs claiming one identity are ambiguous in every publication state.
    if (new Set(group.map(row => row.rootId)).size > 1) for (const row of group) row.blockers.push("DUPLICATE_IDENTITY");
  }
  for (const row of rows) {
    if (row.type !== "article" && row.type !== "gallery") continue;
    let ref = byId.get(row.id)?.canonicalCategory;
    const ancestors = new Set<string>();
    for (;;) {
      const category = object(ref) && documentId(ref._ref) ? byId.get(ref._ref) : undefined;
      if (!category || category._type !== "category" || versionOf(category._id).state !== "published") { row.blockers.push("PUBLISHED_CATEGORY_MISSING"); break; }
      if (ancestors.has(category._id) || ancestors.size >= CENSUS_MAX_CATEGORY_DEPTH) { row.blockers.push("CATEGORY_CYCLE_OR_DEPTH"); break; }
      ancestors.add(category._id);
      if (!categoryHas(category, "label", row.language!)) row.blockers.push("CATEGORY_LABEL_MISSING");
      if (!categoryHas(category, "slug", row.language!)) row.blockers.push("CATEGORY_SLUG_MISSING");
      if (rowById.get(category._id)?.blockers.includes("DUPLICATE_IDENTITY")) row.blockers.push("CATEGORY_IDENTITY_AMBIGUOUS");
      if (category.parent === undefined || category.parent === null) break;
      ref = category.parent;
    }
    row.blockers = [...new Set(row.blockers)];
  }
  const coverage = ["article", "gallery", "service", "category"].map(type => {
    const family = rows.filter(r => r.type === type), identities = [...new Set(family.map(r => r.identity))].sort();
    const missing: { identity: string; language: string; draftIds: string[] }[] = [];
    const published: Record<string, number> = Object.fromEntries(languages.map(language => [language, 0]));
    for (const identity of identities) for (const language of languages) {
      const matches = groups.get(JSON.stringify([type, identity, type === "category" ? null : language])) ?? [];
      const available = matches.filter(r => r.state === "published").some(r => type !== "category" || (categoryHas(byId.get(r.id)!, "label", language) && categoryHas(byId.get(r.id)!, "slug", language)));
      if (available) published[language]++;
      else missing.push({ identity, language, draftIds: matches.filter(r => r.state === "draft").map(r => r.id).sort() });
    }
    return { type, identities: identities.length, published, missing, drafts: family.filter(r => r.state === "draft").length, releases: family.filter(r => r.state === "release").length };
  });
  return { version: 1, snapshotSha256: createHash("sha256").update(bytes).digest("hex"), documentCount: documents.length, languages: [...languages],
    coverage, rows: rows.sort((a, b) => a.id.localeCompare(b.id)),
    hasBlockers: coverage.some(c => c.missing.length > 0) || rows.some(r => r.blockers.length > 0),
    snapshotCompletenessVerified: false, translationAcceptanceVerified: false, publicationAuthorized: false, cmsMutated: false };
}
