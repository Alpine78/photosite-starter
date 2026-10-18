import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { readSanityArticleEndGalleryPage, SanityArticleEndGalleryError } from "../src/lib/sanity-article-end-gallery";
import { createHmacGalleryCursorCodec } from "../src/lib/gallery-pagination";
import { ARTICLE_DETAIL_PROJECTION, projectArticleContentPage } from "../src/lib/sanity-article";
import { validateArticleEndSections, validateArticleEndMembership } from "../sanity/schemas/article-end-sections";
import type { SanityQueryRequest } from "../src/lib/sanity-client";
import type { SchemaValidationContext } from "../sanity/schemas/schema-types";
import { studioInterfaceText } from "./interface-locales";

vi.mock("../src/lib/deployment-config", () => ({ getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }) }));
type Row = Record<string, unknown>;
const now = new Date("2026-10-18T12:00:00Z");
const config = { projectId: "example1", dataset: "fixture", datasetVisibility: "public" as const, apiVersion: "v2026-06-24" };
const codec = createHmacGalleryCursorCodec("k".repeat(32));
const query = { locale: "fi-FI", contentId: "review", endGalleryId: "ending" };
const network = vi.fn(async () => { throw new Error("External requests forbidden"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(() => { vi.unstubAllGlobals(); expect(network).not.toHaveBeenCalled(); });
const sections = Array.from({ length: 5 }, (_, i) => ({ _key: `key${i}`, sectionId: `group-${i + 1}`, slug: `category-${i + 1}`, label: `Group ${i + 1}` }));
function article(overrides: Row = {}): Row {
  return { _id: "article-fi", _type: "article", contentId: "review", language: "fi", endGalleryId: "ending",
    endGallerySectionHeading: "Author's assessment", endGallerySections: structuredClone(sections),
    title: "A comparison", publishedAt: "2026-10-01", body: [{ _key: "body", _type: "contentParagraphBlock", text: "Introduction" }], ...overrides };
}
function asset(i: number): Row {
  const hash = i.toString(16).padStart(40, "0"), path = `images/example1/fixture/${hash}-1600x1067.webp`;
  return { _id: `asset-${i}`, _type: "sanity.imageAsset", url: `https://cdn.sanity.io/${path}`, path, extension: "webp", mimeType: "image/webp",
    metadata: { dimensions: { width: 1600, height: 1067 } }, archiveLocator: "private-archive-marker" };
}
function dataset(): Row[] {
  const result: Row[] = [article()];let i = 0;
  for (const [group, count] of [2, 6, 7, 16, 10].entries()) for (let n = 0; n < count; n++) {
    i++;
    result.push(asset(i), { _id: `media-${i}`, _type: "media", mediaId: `photo-${i}`, mediaType: "image", publiclyRenderable: true,
      privateOnly: false, alt: [{ language: "fi", value: "Photograph" }], image: { asset: { _ref: `asset-${i}` } }, providerSecret: "private-provider-marker" },
    { _id: `placement-${i}`, _type: "articleEndGalleryPlacement", article: { _ref: "article-fi" }, placementId: `end-${i}`, order: i,
      visible: true, sectionId: `group-${group + 1}`, media: { _ref: `media-${i}` } });
  }
  return result;
}
// This models published fixture visibility, not hosted perspective/ACL behavior.
async function execute(data: Row[], source: string, params?: Readonly<Record<string, unknown>>) {
  return (await evaluate(parse(source, { params: { ...params } }), { dataset: data.filter((row) => !String(row._id).startsWith("drafts.") && !String(row._id).startsWith("versions.")), params: { ...params }, timestamp: now })).get();
}
function runtime(data: Row[]) {
  const requests: SanityQueryRequest[] = [];
  const client = { query: async (request: SanityQueryRequest) => { requests.push(request);return execute(data, request.query, request.params); } };
  return { requests, client, read: (selection: Partial<typeof query> & { sectionId?: string; cursor?: string; pageSize?: number } = {}) =>
    readSanityArticleEndGalleryPage({ query: { ...query, ...selection }, client, config, cursorCodec: codec }) };
}
function studio(data: Row[], document: Row) {
  const requests: { query: string; params?: Readonly<Record<string, unknown>> }[] = [], perspectives: unknown[] = [];
  const client = { withConfig(options: unknown) { perspectives.push(options);return client; }, async fetch(source: string, params?: Readonly<Record<string, unknown>>) { requests.push({ query: source, params });return execute(data, source, params); } };
  const context = { document, getClient: () => client } as unknown as SchemaValidationContext;
  return { context, requests, perspectives };
}

describe("evaluated article-end candidate/boundary queries", () => {
  it("keeps All at 24+17 and strips all provider/internal fields", async () => {
    const r = runtime(dataset()), first = await r.read();
    expect(first?.items).toHaveLength(24);expect(first?.page.hasNextPage).toBe(true);
    const next = await r.read({ cursor: first!.page.endCursor });
    expect(next?.items).toHaveLength(17);expect(next?.page.hasNextPage).toBe(false);
    expect(new Set([...first!.items, ...next!.items].map((x) => x.itemId)).size).toBe(41);
    for (const request of r.requests.filter((x) => x.tag === "article.end-gallery.window")) {
      expect(request.params).not.toHaveProperty("sectionId");expect(request.query).not.toContain("sectionId == $sectionId");
    }
    for (const marker of ["private-archive-marker", "private-provider-marker", "_rev"]) expect(JSON.stringify(first)).not.toContain(marker);
  });
  it("accepts the same issued All token before and after adding a catalog", async () => {
    const old = dataset();delete old[0]!.endGallerySections;delete old[0]!.endGallerySectionHeading;
    const oldPage = await runtime(old).read(), r = runtime(dataset()), catalogued = await r.read();
    expect(catalogued!.page.endCursor).toBe(oldPage!.page.endCursor);
    expect((await r.read({ cursor: oldPage!.page.endCursor }))!.items).toHaveLength(17);
  });
  it.each([2, 6, 7, 16, 10].map((count, index) => ({ count, group: index + 1 })))("filters the full collection before every 3-row page: $group", async ({ count, group }) => {
    const r = runtime(dataset()), seen: string[] = [];let cursor: string | undefined;
    do {
      const page = await r.read({ sectionId: `group-${group}`, pageSize: 3, cursor });
      expect(page).toBeDefined();expect(page!.items.length).toBeLessThanOrEqual(3);
      seen.push(...page!.items.map((x) => x.itemId));cursor = page!.page.hasNextPage ? page!.page.endCursor : undefined;
    } while (cursor);
    const offset = [2, 6, 7, 16, 10].slice(0, group - 1).reduce((sum, n) => sum + n, 0);
    expect(seen).toEqual(Array.from({ length: count }, (_, i) => `end-${offset + i + 1}`));
    for (const req of r.requests.filter((x) => x.tag === "article.end-gallery.window")) {
      expect(req.params?.candidateLimit).toBe(4);
      expect(req.params?.sectionId).toBe(`group-${group}`);
      expect(req.query.indexOf("sectionId == $sectionId")).toBeLessThan(req.query.indexOf("[0...$candidateLimit]"));
      if (req.params?.afterPlacementId) expect(req.query.match(/sectionId == \$sectionId/g)).toHaveLength(2);
    }
  });
  it("rejects a removed selected boundary and cross-section cursor rather than widening", async () => {
    const data = dataset(), r = runtime(data), first = await r.read({ sectionId: "group-5", pageSize: 3 });
    const token = first!.page.endCursor;
    await expect(r.read({ sectionId: "group-4", pageSize: 3, cursor: token })).rejects.toMatchObject({ code: "wrong-scope" });
    const boundary = data.find((x) => x._id === "placement-34")!;boundary.sectionId = "group-4";
    await expect(r.read({ sectionId: "group-5", pageSize: 3, cursor: token })).rejects.toMatchObject({ code: "stale" });
  });
  it("refuses unknown selectors before any candidate window", async () => {
    const r = runtime(dataset());await expect(r.read({ sectionId: "unknown" })).rejects.toThrow();expect(r.requests).toHaveLength(1);
  });
  it("rejects a source that drops the selected predicate instead of showing All", async () => {
    const data = dataset();
    const client = { query: async (request: SanityQueryRequest) => execute(data,
      request.query.replaceAll(" && sectionId == $sectionId", ""), request.params) };
    await expect(readSanityArticleEndGalleryPage({ query: { ...query, sectionId: "group-5", pageSize: 3 }, client, config, cursorCodec: codec })).rejects.toThrow(TypeError);
  });
  it("includes unassigned items in All and refuses dangling catalogued references", async () => {
    const data = dataset();data.find((x) => x._id === "placement-1")!.sectionId = undefined;
    expect((await runtime(data).read())?.items).toHaveLength(24);
    expect((await runtime(data).read({ sectionId: "group-1" }))?.items.map((x) => x.itemId)).toEqual(["end-2"]);
    data.find((x) => x._id === "placement-1")!.sectionId = "undeclared";
    await expect(runtime(data).read()).rejects.toBeInstanceOf(SanityArticleEndGalleryError);
  });
  it("preserves uncatalogued legacy reads and ignores fields never requested by that projection", async () => {
    const data = dataset();delete data[0]!.endGallerySections;delete data[0]!.endGallerySectionHeading;
    data.find((x) => x._id === "placement-1")!.sectionId = { invalid: true };
    const r = runtime(data);expect((await r.read())?.items).toHaveLength(24);
    expect(r.requests[1]!.query).not.toContain("sectionId");
  });
  it.each([{}, "not-an-array", [null], Array.from({ length: 21 }, (_, i) => ({ sectionId: `g-${i}`, slug: `g-${i}`, label: "Group" }))].map((value) => ({ value })))("does not hide malformed raw catalog containers behind a GROQ traversal: %j", async ({ value }) => {
    const data = dataset();data[0]!.endGallerySections = value;
    await expect(runtime(data).read()).rejects.toBeInstanceOf(SanityArticleEndGalleryError);
  });
  it("excludes private/nonpublic/hidden rows and expired articles in the actual query", async () => {
    const data = dataset();data.find((x) => x._id === "media-1")!.privateOnly = true;data.find((x) => x._id === "media-2")!.publiclyRenderable = false;data.find((x) => x._id === "placement-3")!.visible = false;
    expect((await runtime(data).read({ pageSize: 100 }))?.items).toHaveLength(38);
    data[0]!.endDate = "2026-10-17T00:00:00Z";expect(await runtime(data).read()).toBeUndefined();
  });
  it("projects an article's bounded catalog through the actual detail query and mapper", async () => {
    const data = dataset();(data[0]!.endGallerySections as Row[])[0]!.intro = "private-intro-marker";
    const raw = await execute(data, `*[_id == "article-fi"][0]${ARTICLE_DETAIL_PROJECTION}`);
    const view = projectArticleContentPage(raw, { language: "fi", fallbackLanguage: "fi", config });
    expect(view.endGallerySections).toHaveLength(5);expect(view.endGallerySectionHeading).toBe("Author's assessment");
    expect(JSON.stringify(view)).not.toContain("private-intro-marker");expect(view.endGallerySections![0]).not.toHaveProperty("_key");
  });
});

describe("evaluated Studio catalog/membership witnesses", () => {
  it.each([{}, "bad-list", Array.from({ length: 21 }, (_, i) => ({ _key: `x${i}`, sectionId: `group-${i + 1}`, slug: `category-${i + 1}`, label: "Group" }))].map((bad) => ({ bad })))("does not exempt a malformed declared peer catalog: %j", async ({ bad }) => {
    const own = article(), peer = article({ _id: "article-en", language: "en", endGallerySections: bad });
    const doc = { _id: "drafts.own-p", article: { _ref: "article-fi" }, placementId: "same", sectionId: "group-1" };
    const data = [own, peer, { _id: "peer-p", _type: "articleEndGalleryPlacement", article: { _ref: "article-en" }, placementId: "same", sectionId: "group-1" }];
    expect(await validateArticleEndSections(own, studio(data, own).context)).not.toBe(true);
    expect(await validateArticleEndMembership(doc, studio(data, doc).context)).not.toBe(true);
  });
  it("compares translated sets without depending on their order, labels or slugs", async () => {
    const own = article(), peer = article({ _id: "article-en", language: "en", endGallerySections: sections.toReversed().map((x) => ({ ...x, slug: `english-${x.slug}`, label: "English group" })) });
    const f = studio([own, peer], own);expect(await validateArticleEndSections(own, f.context)).toBe(true);
    peer.endGallerySections = sections.slice(1);const message = await validateArticleEndSections(own, f.context);
    expect(message).toContain("same section IDs");
    expect(studioInterfaceText(message as string, "fi-FI")).not.toBe(message);
    expect(f.perspectives[0]).toEqual({ perspective: "published", useCdn: false });
  });
  it("bounds malformed catalog output and reports unsupported introductions only as a boolean", async () => {
    const own = article(), published = article();(published.endGallerySections as Row[])[0]!.intro = "private-intro-marker";
    const f = studio([published], own);expect(await validateArticleEndSections(own, f.context)).toContain("could not be completed");
    const raw = await execute([published], f.requests[0]!.query, f.requests[0]!.params);
    expect(JSON.stringify(raw)).not.toContain("private-intro-marker");
    expect(raw.published.endGallerySections[0].hasUnsupportedIntro).toBe(true);
  });
  it("refuses assigning a published slug to a replacement section ID with a fresh key", async () => {
    const published = article({ endGallerySections: [sections[0]] });
    const own = article({ endGallerySections: [{ ...sections[0], _key: "replacement-key", sectionId: "replacement-id" }] });
    expect(await validateArticleEndSections(own, studio([published], own).context)).toContain("cannot be changed in place");
  });
  it("blocks clearing/removal with a hidden reference and allows removal after reassignment", async () => {
    const data = dataset(), own = article({ endGallerySections: sections.slice(1) });data.find((x) => x._id === "placement-1")!.visible = false;
    expect(await validateArticleEndSections(own, studio(data, own).context)).toContain("including hidden");
    for (const row of data) if (row._type === "articleEndGalleryPlacement" && row.sectionId === "group-1") row.sectionId = "group-2";
    expect(await validateArticleEndSections(own, studio(data, own).context)).toBe(true);
  });
  it.each([true, false])("detects catalog adoption conflicts in either assignment direction: own assigned=$0", async (assigned) => {
    const old = article({ endGallerySections: undefined, endGallerySectionHeading: undefined }), own = article(), peer = article({ _id: "article-en", language: "en" });
    const data = [old, peer, { _id: "own-p", _type: "articleEndGalleryPlacement", article: { _ref: "article-fi" }, placementId: "same", ...(assigned ? { sectionId: "group-1" } : {}) },
      { _id: "peer-p", _type: "articleEndGalleryPlacement", article: { _ref: "article-en" }, placementId: "same", ...(!assigned ? { sectionId: "group-1" } : {}) }];
    expect(await validateArticleEndSections(own, studio(data, own).context)).toContain("matching sections");
  });
  it("exempts an unclassified locale without a catalog and compares only shared occurrences", async () => {
    const own = article(), peer = article({ _id: "article-en", language: "en", endGallerySections: undefined, endGallerySectionHeading: undefined });
    const doc = { _id: "drafts.own-p", article: { _ref: "article-fi" }, placementId: "same", sectionId: "group-1" };
    const data = [own, peer, { _id: "peer-p", _type: "articleEndGalleryPlacement", article: { _ref: "article-en" }, placementId: "same" }];
    expect(await validateArticleEndMembership(doc, studio(data, doc).context)).toBe(true);
    peer.endGallerySections = sections;peer.endGallerySectionHeading = "Groups";
    expect(await validateArticleEndMembership(doc, studio(data, doc).context)).toContain("matching sections");
    data[2]!.placementId = "different";expect(await validateArticleEndMembership(doc, studio(data, doc).context)).toBe(true);
  });
});
