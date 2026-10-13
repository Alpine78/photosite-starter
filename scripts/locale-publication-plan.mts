/** Narrow offline plans. Exact reviewed fields, guarded revisions, strict creates. */
import { createHash } from "node:crypto";
import { canonicalJson } from "./joomla-intro-summary.mts";
import { snapshotDocuments } from "./publication-locale-census.mts";
import type { SeedMutation } from "./sanity-seed-http.mts";
type Document = Record<string, unknown> & { _id: string; _rev: string; _type: string };
export type PublicationTarget = { projectId: string; dataset: string; apiVersion: string };
export type PublicationTransaction = { kind: "category-services" | "article"; identity: string; mutations: SeedMutation[]; sources: Document[]; created: Record<string, unknown>[]; removedDraftIds: string[] };
export type LocalePublicationPlan = { version: 1; target: PublicationTarget; snapshotSha256: string; reviewPacketSha256: string; transactions: PublicationTransaction[]; digest: string };
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const sha256 = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
const root = (id: string) => id.startsWith("drafts.") ? id.slice(7) : id.startsWith("versions.") ? id.slice(id.indexOf(".", 9) + 1) : id;
const identity = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v) && v.length <= 200;
function validateServiceCopy(fields: Record<string, unknown>): void {
  const text = (v: unknown, maximum = 10_000): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= maximum;
  if (!text(fields.name, 300) || !text(fields.shortDescription, 1000) || !Number.isSafeInteger(fields.order) || !Array.isArray(fields.description) || !fields.description.length || fields.description.length > 100 || fields.description.some(v => !text(v)) || (fields.startingPrice !== undefined && !text(fields.startingPrice, 300)) || (fields.hideFromListing !== undefined && typeof fields.hideFromListing !== "boolean")) throw new Error("INVALID_SERVICE_COPY");
  if (fields.pricing !== undefined) {
    if (!Array.isArray(fields.pricing) || !fields.pricing.length || fields.pricing.length > 50) throw new Error("INVALID_SERVICE_PRICING");
    const keys = new Set<string>();
    for (const value of fields.pricing) {
      if (!record(value) || typeof value._key !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(value._key) || keys.has(value._key) || value._type !== "object" || !text(value.name, 300) || !text(value.price, 300) || (value.note !== undefined && !text(value.note)) || Object.keys(value).some(k => !["_key", "_type", "name", "price", "note"].includes(k))) throw new Error("INVALID_SERVICE_PRICING");
      keys.add(value._key);
    }
  }
}
export function publicationContent(d: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(d).filter(([k]) => !["_rev", "_createdAt", "_updatedAt"].includes(k)));
}
function sourceOf(binding: Record<string, unknown>, documents: Document[], type: string): Document {
  const source = documents.find(d => d._id === binding._id);
  if (!source || source._type !== type || source._rev !== binding._rev || root(source._id) !== source._id || documents.some(d => d._id !== source._id && root(d._id) === source._id)) throw new Error("STALE_OR_AMBIGUOUS_SOURCE");
  for (const [k, v] of Object.entries(binding)) if (!same(source[k] ?? null, v)) throw new Error("SOURCE_CONTENT_MISMATCH");
  return source;
}
function finish(target: PublicationTarget, bytes: Buffer, reviewPacket: unknown, transactions: PublicationTransaction[]): LocalePublicationPlan {
  if (!/^[a-z0-9-]{1,63}$/.test(target.projectId) || !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(target.dataset) || !/^v\d{4}-\d{2}-\d{2}$/.test(target.apiVersion) || !transactions.length || transactions.length > 50) throw new Error("INVALID_PUBLICATION_TARGET_OR_COUNT");
  for (const tx of transactions) if (tx.mutations.length > 500 || Buffer.byteLength(JSON.stringify({ mutations: tx.mutations })) > 2 * 1024 * 1024) throw new Error("TRANSACTION_LIMIT");
  const data = { version: 1 as const, target, snapshotSha256: sha256(bytes), reviewPacketSha256: sha256(canonicalJson(reviewPacket)), transactions };
  return { ...data, digest: sha256(canonicalJson(data)) };
}
export function publicationPlanDigest(plan: LocalePublicationPlan): string {
  const { digest: _digest, ...data } = plan; void _digest; return sha256(canonicalJson(data));
}
function languageGuard(source: Document): SeedMutation {
  if (typeof source.language !== "string") throw new Error("INVALID_SOURCE_LANGUAGE");
  // The unchanged value checks the revision atomically. Provider revision/update
  // metadata may advance; authored Finnish content remains byte-equivalent.
  return { patch: { id: source._id, ifRevisionID: source._rev, set: { language: source.language } } };
}
export function planLocaleAdditions(bytes: Buffer, packet: unknown, target: PublicationTarget): LocalePublicationPlan {
  if (!record(packet) || !record(packet.category) || !Array.isArray(packet.services) || packet.services.length > 20) throw new Error("INVALID_REVIEW_PACKET");
  const documents = snapshotDocuments(bytes), category = packet.category;
  if (!record(category.sourceDocument) || !record(category.englishAdditions)) throw new Error("INVALID_CATEGORY_PACKET");
  const source = sourceOf(category.sourceDocument, documents, "category"), set: Record<string, unknown> = {};
  for (const field of ["label", "slug", "description"]) {
    const addition = category.englishAdditions[field], prior = source[field] ?? [];
    if (!Array.isArray(prior) || prior.length > 50 || !record(addition) || addition.language !== "en" || addition._key !== "en" || prior.some(v => !record(v) || v.language === "en" || v._key === "en")) throw new Error("INVALID_OR_EXISTING_CATEGORY_LANGUAGE");
    if (Object.keys(addition).some(k => !["_key", "_type", "language", field === "description" ? "blocks" : "value"].includes(k)) || addition._type !== ({ label: "localizedText", slug: "localizedSlug", description: "categoryDescription" } as Record<string, string>)[field]) throw new Error("UNDECLARED_CATEGORY_FIELD");
    // This owner packet contains plain paragraph runs only. Refuse added
    // links, marks, media or HTML rather than expanding its approval scope.
    if (field === "description") {
      const validKey = (v: unknown) => typeof v === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
      if (!Array.isArray(addition.blocks) || !addition.blocks.length || addition.blocks.length > 6 || new Set(addition.blocks.map(b => record(b) ? b._key : undefined)).size !== addition.blocks.length || addition.blocks.some(b => !record(b) || b._type !== "categoryDescriptionParagraph" || !validKey(b._key) || Object.keys(b).some(k => !["_key", "_type", "spans"].includes(k)) || !Array.isArray(b.spans) || !b.spans.length || b.spans.length > 20 || new Set(b.spans.map(v => record(v) ? v._key : undefined)).size !== b.spans.length || b.spans.some(v => !record(v) || v._type !== "categoryDescriptionInlineSpan" || !validKey(v._key) || typeof v.text !== "string" || !v.text.trim() || v.text.length > 300 || Object.keys(v).some(k => !["_key", "_type", "text"].includes(k))))) throw new Error("INVALID_CATEGORY_DESCRIPTION");
    }
    if (field === "slug" && !identity(addition.value)) throw new Error("INVALID_CATEGORY_SLUG");
    if (field === "label" && (typeof addition.value !== "string" || !addition.value.trim() || addition.value.length > 200)) throw new Error("INVALID_CATEGORY_LABEL");
    set[field] = [...prior, structuredClone(addition)];
  }
  const slug = (category.englishAdditions.slug as Record<string, unknown>).value;
  if (documents.some(d => d._type === "category" && d._id !== source._id && same(d.parent ?? null, source.parent ?? null) && Array.isArray(d.slug) && d.slug.some(v => record(v) && v.language === "en" && v.value === slug))) throw new Error("CATEGORY_SLUG_COLLISION");
  const tx: PublicationTransaction = { kind: "category-services", identity: String(source.categoryId), mutations: [{ patch: { id: source._id, ifRevisionID: source._rev, set } }], sources: [source], created: [], removedDraftIds: [] };
  const plannedPairs = new Set<string>(), plannedSlugs = new Set<string>();
  for (const value of packet.services) {
    if (!record(value) || !record(value.sourceDocument) || !record(value.targetEditingFields)) throw new Error("INVALID_SERVICE_PACKET");
    const original = sourceOf(value.sourceDocument, documents, "service"), fields = value.targetEditingFields;
    validateServiceCopy(fields);
    const serviceFields = new Set(["_type", "serviceId", "language", "slug", "name", "shortDescription", "description", "hideFromListing", "parentServiceId", "coverMedia", "startingPrice", "pricing", "order"]);
    if (Object.keys(fields).some(k => !serviceFields.has(k)) || Object.keys(publicationContent(original)).some(k => k !== "_id" && !serviceFields.has(k))) throw new Error("UNDECLARED_SERVICE_FIELD");
    if (original.language !== "fi" || fields.language !== "en" || fields._type !== "service" || fields.serviceId !== original.serviceId || !identity(fields.serviceId) || !identity(fields.slug)) throw new Error("SERVICE_IDENTITY_MISMATCH");
    const pair = `${fields.serviceId}:en`, slugKey = canonicalJson([fields.parentServiceId ?? null, fields.slug]);
    if (plannedPairs.has(pair) || plannedSlugs.has(slugKey) || documents.some(d => d._type === "service" && d.language === "en" && (d.serviceId === fields.serviceId || (same(d.parentServiceId ?? null, fields.parentServiceId ?? null) && d.slug === fields.slug)))) throw new Error("EXISTING_OR_DUPLICATE_SERVICE_TARGET");
    for (const k of ["coverMedia", "order", "parentServiceId", "hideFromListing"]) if (!same(fields[k] ?? null, original[k] ?? null)) throw new Error("SERVICE_UNRELATED_FIELD_CHANGE");
    if (fields.parentServiceId && !documents.some(d => d._type === "service" && d.serviceId === fields.parentServiceId && d.language === "en" && root(d._id) === d._id)) throw new Error("SERVICE_PARENT_UNPUBLISHED");
    const created = { ...publicationContent(original), ...structuredClone(fields), _id: `localized-service-${sha256(`${original._id}\0en`)}` };
    if (documents.some(d => root(d._id) === created._id)) throw new Error("TARGET_DOCUMENT_EXISTS");
    let sourceGuard = languageGuard(original);
    if (value.sourcePricingAdditions !== undefined) {
      if (!Array.isArray(value.sourcePricingAdditions) || !value.sourcePricingAdditions.length || !Array.isArray(original.pricing)) throw new Error("INVALID_SOURCE_PRICING_ADDITIONS");
      const pricing = [...original.pricing, ...structuredClone(value.sourcePricingAdditions)];
      validateServiceCopy({ ...original, pricing });
      if (!Array.isArray(fields.pricing) || value.sourcePricingAdditions.some(addition => !record(addition) || (fields.pricing as unknown[]).filter(p => record(p) && p._key === addition._key && p.price === addition.price).length !== 1)) throw new Error("SOURCE_TARGET_PRICE_MISMATCH");
      sourceGuard = { patch: { id: original._id, ifRevisionID: original._rev, set: { pricing } } };
    }
    plannedPairs.add(pair); plannedSlugs.add(slugKey); tx.sources.push(original); tx.created.push(created); tx.mutations.push(sourceGuard, { create: created });
  }
  return finish(target, bytes, packet, [tx]);
}
export function planReviewedArticlePublication(bytes: Buffer, packet: unknown, target: PublicationTarget): LocalePublicationPlan {
  if (!record(packet) || !Array.isArray(packet.proposals) || !packet.proposals.length || packet.proposals.length > 50) throw new Error("INVALID_ARTICLE_PACKET");
  const documents = snapshotDocuments(bytes), byId = new Map(documents.map(d => [d._id, d])), transactions: PublicationTransaction[] = [];
  const used = new Set<string>();
  for (const proposal of packet.proposals) {
    if (!record(proposal) || !record(proposal.sourceBinding) || !record(proposal.suggestedFields) || proposal.targetLanguage !== "en") throw new Error("INVALID_ARTICLE_PROPOSAL");
    const source = sourceOf(proposal.sourceBinding, documents, "article");
    const variants = documents.filter(d => d._type === "article" && d.contentId === source.contentId && d.language === "en");
    if (source.language !== "fi" || variants.length !== 1 || !variants[0]._id.startsWith("drafts.")) throw new Error("AMBIGUOUS_ARTICLE_TARGET");
    const draft = variants[0], publishedId = root(draft._id);
    if (used.has(publishedId) || byId.has(publishedId)) throw new Error("DUPLICATE_ARTICLE_TARGET"); used.add(publishedId);
    for (const [k, originalValue] of Object.entries(proposal.suggestedFields)) {
      if (!["title", "slug", "summary", "body", "tags", "author"].includes(k)) throw new Error("UNDECLARED_REVIEW_FIELD");
      const value = k === "body" && Array.isArray(originalValue) ? originalValue.filter(b => !record(b) || b._type !== "contentPollBlock") : originalValue;
      if (!same(draft[k], value)) throw new Error("ARTICLE_REVIEW_TEXT_MISMATCH");
    }
    const sourceContent = publicationContent(source), draftContent = publicationContent(draft);
    const allowedDifferences = new Set(["_id", "language", "localizedFrom", "localizationReview", ...Object.keys(proposal.suggestedFields)]);
    for (const k of new Set([...Object.keys(sourceContent), ...Object.keys(draftContent)])) if (!allowedDifferences.has(k) && !same(sourceContent[k], draftContent[k])) throw new Error("UNREVIEWED_DRAFT_FIELD_CHANGE");
    for (const k of ["contentId", "canonicalCategory", "secondaryCategories", "cover", "summaryListingOnly", "endGalleryId"]) if (!same(source[k] ?? null, draft[k] ?? null)) throw new Error("ARTICLE_UNRELATED_FIELD_CHANGE");
    const categoryRef = record(draft.canonicalCategory) ? draft.canonicalCategory._ref : undefined;
    if (!identity(draft.slug) || documents.some(d => d._id !== draft._id && ["article", "gallery"].includes(d._type) && d.language === "en" && d.slug === draft.slug && record(d.canonicalCategory) && d.canonicalCategory._ref === categoryRef)) throw new Error("ARTICLE_ROUTE_COLLISION");
    let category = typeof categoryRef === "string" ? byId.get(categoryRef) : undefined; const ancestors = new Set<string>(), categorySources: Document[] = [];
    for (;;) {
      if (!category || category._type !== "category" || root(category._id) !== category._id || ancestors.has(category._id) || ancestors.size >= 5) throw new Error("ARTICLE_CATEGORY_UNPUBLISHED_OR_CYCLIC");
      ancestors.add(category._id);
      categorySources.push(category);
      for (const field of ["label", "slug"]) if (!Array.isArray(category[field]) || category[field].filter(v => record(v) && v.language === "en" && typeof v.value === "string" && v.value.trim()).length !== 1) throw new Error("ARTICLE_CATEGORY_LANGUAGE_MISSING");
      if (!category.parent) break;
      category = record(category.parent) && typeof category.parent._ref === "string" ? byId.get(category.parent._ref) : undefined;
    }
    const placements = documents.filter(d => d._type === "articleEndGalleryPlacement" && record(d.article) && d.article._ref === publishedId);
    const sourcePlacements = documents.filter(d => d._type === "articleEndGalleryPlacement" && record(d.article) && d.article._ref === source._id);
    if (placements.length !== sourcePlacements.length || placements.length > 100 || new Set(placements.map(d => d.placementId)).size !== placements.length || new Set(sourcePlacements.map(d => d.placementId)).size !== sourcePlacements.length || placements.some(d => !sourcePlacements.some(s => s.placementId === d.placementId))) throw new Error("PLACEMENT_COVERAGE_MISMATCH");
    const tx: PublicationTransaction = { kind: "article", identity: String(source.contentId), sources: [source, draft, ...sourcePlacements, ...placements, ...categorySources], created: [], removedDraftIds: [], mutations: [languageGuard(source)] };
    for (const doc of [draft, ...placements]) {
      if (!doc._id.startsWith("drafts.") || byId.has(root(doc._id)) || !record(doc.localizationReview) || !Array.isArray(doc.localizationReview.pendingFields) || doc.localizationReview.sourceLanguage !== "fi") throw new Error("INVALID_PUBLICATION_DRAFT");
      if (doc === draft && doc.localizationReview.pendingFields.some(p => typeof p !== "string" || p.length > 300 || !Object.hasOwn(proposal.suggestedFields as object, p.split(/[.\[]/, 1)[0]))) throw new Error("UNAPPROVED_PENDING_FIELD");
      if (doc !== draft) {
        const original = sourcePlacements.find(d => d.placementId === doc.placementId);
        if (!original || sourcePlacements.filter(d => d.placementId === doc.placementId).length !== 1 || doc.localizationReview.pendingFields.length || ["media", "order", "visible", "caption"].some(k => !same(doc[k] ?? null, original[k] ?? null))) throw new Error("PLACEMENT_SOURCE_OR_REVIEW_MISMATCH");
        const allowed = new Set(["_id", "article", "localizedFrom", "localizationReview"]);
        const originalContent = publicationContent(original), editingContent = publicationContent(doc);
        if (Object.keys({ ...originalContent, ...editingContent }).some(k => !allowed.has(k) && !same(originalContent[k], editingContent[k]))) throw new Error("UNREVIEWED_PLACEMENT_FIELD_CHANGE");
        tx.mutations.push({ patch: { id: original._id, ifRevisionID: original._rev, set: { order: original.order } } });
      }
      const created: Record<string, unknown> & { _id: string } = { ...publicationContent(doc), _id: root(doc._id), localizationReview: { ...doc.localizationReview, pendingFields: [] } };
      if (doc !== draft) created.article = { _type: "reference", _ref: publishedId };
      tx.created.push(created); tx.removedDraftIds.push(doc._id);
      tx.mutations.push({ patch: { id: doc._id, ifRevisionID: doc._rev, set: doc === draft ? { language: "en" } : { order: doc.order } } }, { create: created }, { delete: { id: doc._id } });
    }
    transactions.push(tx);
  }
  return finish(target, bytes, packet, transactions);
}
