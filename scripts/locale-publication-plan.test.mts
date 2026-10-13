import { describe, expect, it } from "vitest";
import { planLocaleAdditions, planReviewedArticlePublication, publicationPlanDigest } from "./locale-publication-plan.mts";
const target = { projectId: "fixture", dataset: "production", apiVersion: "v2026-03-01" };
const encode = (rows: unknown[]) => Buffer.from(rows.map(d => JSON.stringify(d)).join("\n") + "\n");
const category = { _id: "category", _rev: "r", _type: "category", categoryId: "blog", label: [{ _key: "fi", language: "fi", value: "Fixture" }], slug: [{ _key: "fi", language: "fi", value: "fixture" }] };
const service = { _id: "service-fi", _rev: "r", _type: "service", serviceId: "portraits", language: "fi", name: "Fixture", shortDescription: "Fixture", slug: "fixture", order: 1, description: ["Fixture source"], coverMedia: { _ref: "public-media" }, pricing: [{ _key: "package", _type: "object", name: "Fixture", price: "100" }] };
const packet = () => ({ category: { sourceDocument: structuredClone(category), englishAdditions: { label: { _key: "en", _type: "localizedText", language: "en", value: "Blog" }, slug: { _key: "en", _type: "localizedSlug", language: "en", value: "blog" }, description: { _key: "en", _type: "categoryDescription", language: "en", blocks: [{ _key: "p", _type: "categoryDescriptionParagraph", spans: [{ _key: "s", _type: "categoryDescriptionInlineSpan", text: "Reviewed paragraph." }] }] } } }, services: [{ sourceDocument: structuredClone(service), targetEditingFields: { _type: "service", serviceId: service.serviceId, order: service.order, coverMedia: structuredClone(service.coverMedia), pricing: structuredClone(service.pricing), language: "en", name: "Portraits", shortDescription: "Reviewed", slug: "portraits", description: ["Reviewed text"] } }] });
const publishedCategory = { ...category, label: [...category.label, { _key: "en", language: "en", value: "Blog" }], slug: [...category.slug, { _key: "en", language: "en", value: "blog" }] };
const article = { _id: "article-fi", _rev: "r", _type: "article", contentId: "article", language: "fi", title: "Source", slug: "source", body: [{ _key: "paragraph", _type: "contentParagraphBlock", text: "Source" }], canonicalCategory: { _ref: "category" } };
const englishFields = { title: "Reviewed", slug: "reviewed", body: [{ _key: "paragraph", _type: "contentParagraphBlock", text: "Reviewed" }] };
const draft = { ...article, ...englishFields, _id: "drafts.article-en", _rev: "draft-r", language: "en", localizedFrom: "fi", localizationReview: { sourceLanguage: "fi", pendingFields: ["title", "slug", "body[0].text"] } };
const articles = { proposals: [{ sourceBinding: { _id: article._id, _rev: article._rev, contentId: article.contentId, language: "fi" }, suggestedFields: englishFields, targetLanguage: "en" }] };
describe("revision-bound locale publication", () => {
  it("plans only appended category locale and strict service creation", () => {
    const plan = planLocaleAdditions(encode([category, service]), packet(), target);
    expect(publicationPlanDigest(plan)).toBe(plan.digest);
    expect(plan.transactions[0].mutations[0]).toMatchObject({ patch: { id: "category", ifRevisionID: "r", set: { label: [category.label[0], { _key: "en", _type: "localizedText", language: "en", value: "Blog" }] } } });
    expect(plan.transactions[0].created[0]).toMatchObject({ serviceId: "portraits", language: "en", coverMedia: service.coverMedia, order: 1 });
    expect(plan.transactions[0].mutations.some(m => "createOrReplace" in m)).toBe(false);
  });
  it("refuses stale source, duplicate language, modified media and undeclared fields", () => {
    const modified = packet(); modified.services[0].targetEditingFields.coverMedia = { _ref: "other" };
    expect(() => planLocaleAdditions(encode([category, service]), modified, target)).toThrow();
    for (const rows of [[{ ...category, _rev: "changed" }, service], [publishedCategory, service], [category, service, { ...service, _id: "drafts.service-fi" }]]) expect(() => planLocaleAdditions(encode(rows), packet(), target)).toThrow();
    const unknown = packet(); Object.assign(unknown.services[0].targetEditingFields, { unknown: "private" });
    expect(() => planLocaleAdditions(encode([category, service]), unknown, target)).toThrow("UNDECLARED_SERVICE_FIELD");
  });
  it("refuses duplicate service pairs/slugs and unpublished parent", () => {
    const duplicate = packet(); duplicate.services.push(duplicate.services[0]);
    expect(() => planLocaleAdditions(encode([category, service]), duplicate, target)).toThrow();
    const parent = packet(); Object.assign(parent.services[0].sourceDocument, { parentServiceId: "missing" }); Object.assign(parent.services[0].targetEditingFields, { parentServiceId: "missing" });
    expect(() => planLocaleAdditions(encode([category, parent.services[0].sourceDocument]), parent, target)).toThrow("SERVICE_PARENT_UNPUBLISHED");
  });
  it("publishes a reviewed article with revision guards and strict create/delete in one transaction", () => {
    const plan = planReviewedArticlePublication(encode([publishedCategory, article, draft]), articles, target), tx = plan.transactions[0];
    expect(tx.created[0]).toMatchObject({ _id: "article-en", title: "Reviewed", localizationReview: { pendingFields: [] } });
    expect(tx.removedDraftIds).toEqual([draft._id]); expect(tx.mutations).toContainEqual({ patch: { id: draft._id, ifRevisionID: "draft-r", set: { language: "en" } } });
    expect(publicationPlanDigest(plan)).toBe(plan.digest);
  });
  it("refuses missing English category, changed approved prose and new unreviewed draft fields", () => {
    for (const rows of [[category, article, draft], [publishedCategory, article, { ...draft, title: "Unreviewed" }], [publishedCategory, article, { ...draft, privateField: "private" }], [publishedCategory, article, draft, { ...draft, _id: "versions.release.article-en" }]]) expect(() => planReviewedArticlePublication(encode(rows), articles, target)).toThrow();
  });
  it("keeps every end-gallery placement atomic and strengthens only its approved parent", () => {
    const source = { _id: "placement-fi", _rev: "r", _type: "articleEndGalleryPlacement", article: { _ref: article._id }, placementId: "placement", media: { _ref: "media" }, order: 1, visible: true };
    const editing = { ...source, _id: "drafts.placement-en", article: { _ref: "article-en", _weak: true, _strengthenOnPublish: { type: "article" } }, localizedFrom: "fi", localizationReview: { sourceLanguage: "fi", pendingFields: [] } };
    const rows = [publishedCategory, article, draft, source, editing];
    const tx = planReviewedArticlePublication(encode(rows), articles, target).transactions[0];
    expect(tx.created).toHaveLength(2); expect(tx.created[1]).toMatchObject({ article: { _type: "reference", _ref: "article-en" }, media: source.media, order: 1 });
    for (const changed of [{ ...editing, media: { _ref: "other" } }, { ...editing, privateAsset: "unreviewed" }, { ...editing, localizationReview: { sourceLanguage: "fi", pendingFields: ["caption"] } }]) expect(() => planReviewedArticlePublication(encode([...rows.slice(0, -1), changed]), articles, target)).toThrow();
    expect(() => planReviewedArticlePublication(encode(rows.slice(0, -1)), articles, target)).toThrow("PLACEMENT_COVERAGE_MISMATCH");
  });
});

it("refuses malformed category blocks and an unapproved draft pending field", () => {
  const malformed = packet(); Object.assign(malformed.category.englishAdditions.description, { blocks: [{ _key: "p", _type: "contentImageBlock", src: "unreviewed" }] });
  expect(() => planLocaleAdditions(encode([category, service]), malformed, target)).toThrow("INVALID_CATEGORY_DESCRIPTION");
  expect(() => planReviewedArticlePublication(encode([publishedCategory, article, { ...draft, localizationReview: { sourceLanguage: "fi", pendingFields: ["cover"] } }]), articles, target)).toThrow("UNAPPROVED_PENDING_FIELD");
});

it("refuses a canonical English route already used by another article or gallery", () => {
  for (const type of ["article", "gallery"]) expect(() => planReviewedArticlePublication(encode([publishedCategory, article, draft, { ...draft, _id: "other-content", _type: type, contentId: "different" }]), articles, target)).toThrow("ARTICLE_ROUTE_COLLISION");
});

it("appends explicitly reviewed source prices without replacing existing entries or unrelated content", () => {
  const copy = packet();
  const addition = { _key: "extra", _type: "object", name: "Source option", price: "250" };
  Object.assign(copy.services[0], { sourcePricingAdditions: [addition] });
  copy.services[0].targetEditingFields.pricing.push({ ...addition, name: "Translated option" });
  const tx = planLocaleAdditions(encode([category, service]), copy, target).transactions[0];
  expect(tx.mutations[1]).toEqual({ patch: { id: service._id, ifRevisionID: service._rev, set: { pricing: [...service.pricing, addition] } } });
  expect(tx.created[0].coverMedia).toEqual(service.coverMedia);
  expect(tx.created[0].pricing).toEqual(copy.services[0].targetEditingFields.pricing);
  const wrongPrice = structuredClone(copy); wrongPrice.services[0].targetEditingFields.pricing[1].price = "999";
  expect(() => planLocaleAdditions(encode([category, service]), wrongPrice, target)).toThrow("SOURCE_TARGET_PRICE_MISMATCH");
  Object.assign(copy.services[0], { sourcePricingAdditions: [{ ...addition, _key: "package" }] });
  expect(() => planLocaleAdditions(encode([category, service]), copy, target)).toThrow("INVALID_SERVICE_PRICING");
});
