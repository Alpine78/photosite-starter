import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { planLocalizedDraft } from "../scripts/localized-draft-plan.mts";
import { planBrowserLocalizedDraft } from "./localized-draft-crypto";
import {
  actionFailure, createPreparedLocalizedDraft, documentSnapshot, DraftActionError,
  loadLocalizedDraftSource, PLACEMENT_LIMIT, prepareLocalizedDraft, type LocalizedDraftPort,
} from "./localized-draft-action-model";
import { localizedDraftActionCopy, localizedDraftNotice } from "./localized-draft-action-copy";

const source = {
  _id: "article-fi", _rev: "revision1", _type: "article", contentId: "summer-trip", language: "fi",
  title: "Kesä ja yö 🌙", slug: "kesa", summary: "Johdanto", endGalleryId: "summer-images",
  canonicalCategory: { _type: "reference", _ref: "category" }, cover: { _type: "reference", _ref: "photo" },
  body: [{ _key: "first", _type: "contentParagraphBlock", text: "Yö järvellä" }],
};
const category = { _id: "category", slug: [{ language: "fi", value: "tarinat" }], label: [{ language: "fi", value: "Tarinat" }] };
const media = { _id: "photo", alt: [{ language: "fi", value: "Yö" }] };
const placement = { _id: "placement", _rev: "p1", _type: "articleEndGalleryPlacement", placementId: "first", article: { _ref: source._id }, media: { _ref: "photo" }, order: 5, captionOverride: "Kesä" };
function fixture() {
  const data = { versions: [structuredClone(source)] as Record<string, unknown>[], placements: [structuredClone(placement)] as Record<string, unknown>[], categories: [structuredClone(category)] as Record<string, unknown>[], media: [structuredClone(media)] as Record<string, unknown>[] };
  const writes: (readonly Record<string, unknown>[])[] = [];
  const queries: { query: string; params: Record<string, unknown> }[] = [];
  const port: LocalizedDraftPort = {
    fetch: async (query, params, signal) => {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      queries.push({ query, params });
      return structuredClone(query.includes("contentId ==") ? data.versions : query.includes("._ref in") ? data.placements : query.includes('"category"') ? data.categories : data.media);
    },
    create: async (documents) => { writes.push(documents); },
  };
  return { data, writes, port, queries };
}
const signal = () => new AbortController().signal;
const prepare = (port: LocalizedDraftPort) => prepareLocalizedDraft(port, source, "en", ["fi", "en"], signal());

describe("native browser planner parity", () => {
  it("matches the synchronous Node planner including UTF-8 identifiers, text and weak parent links", async () => {
    const input = { source, targetLanguage: "en", configuredLanguages: ["fi", "en"], existingVersions: [source], placements: [placement], categories: [category], media: [media] };
    const result = await planBrowserLocalizedDraft(input);
    expect(result).toEqual(planLocalizedDraft(input));
    expect(result.placementDrafts[0].article).toMatchObject({ _weak: true, _strengthenOnPublish: { type: "article" } });
    expect(result.reviewPaths).toEqual(expect.arrayContaining(["title", "summary", "slug", "body[0].text", "placements[first].captionOverride"]));
  });
  it("preserves seeded order with non-ASCII HMAC keys and placement identities", async () => {
    const seed = "yö 🌙";
    const gallery = { ...source, _id: "gallery-fi", _type: "gallery", orderingRule: "seeded-random", orderingSeed: seed };
    const itemId = "äö🌙";
    const item = { ...placement, _type: "galleryPlacement", placementId: itemId, gallery: { _ref: gallery._id }, shuffledOrderSeed: seed, shuffledOrder: createHmac("sha256", seed).update(itemId).digest("hex") };
    const input = { source: gallery, targetLanguage: "en", configuredLanguages: ["fi", "en"], existingVersions: [gallery], placements: [item], categories: [category], media: [media] };
    expect(await planBrowserLocalizedDraft(input)).toEqual(planLocalizedDraft(input));
  });
  it("refuses unavailable browser cryptography without a placeholder plan", async () => {
    const input = { source, targetLanguage: "en", configuredLanguages: ["fi", "en"], existingVersions: [source], placements: [], categories: [], media: [] };
    await expect(planBrowserLocalizedDraft(input, null as unknown as SubtleCrypto)).rejects.toThrow("crypto-unavailable");
  });
});

describe("saved-source authoring", () => {
  it("previews without writes, reports category/media ownership and creates only linked drafts", async () => {
    const f = fixture(); const before = structuredClone(f.data);
    const preview = await prepare(f.port);
    expect(f.writes).toEqual([]);
    expect(preview.plan.notices).toEqual(expect.arrayContaining([expect.stringContaining("Canonical category"), expect.stringContaining("Shared media photo")]));
    await createPreparedLocalizedDraft(f.port, preview, source, "en", ["fi", "en"], signal());
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toHaveLength(2);
    for (const document of f.writes[0]) expect(document._id).toMatch(/^drafts\.localized-/);
    expect(f.data).toEqual(before);
    expect(f.queries.every(({ query }) => !query.includes(source.contentId))).toBe(true);
  });
  it.each(["source", "placement", "category", "media"])("refuses a changed %s after preview without writing", async (kind) => {
    const f = fixture(); const preview = await prepare(f.port);
    if (kind === "source") f.data.versions[0]._rev = "changed";
    if (kind === "placement") f.data.placements[0].captionOverride = "New";
    if (kind === "category") f.data.categories[0].slug = [];
    if (kind === "media") f.data.media[0].alt = [];
    await expect(createPreparedLocalizedDraft(f.port, preview, source, "en", ["fi", "en"], signal())).rejects.toMatchObject({ code: "changed" });
    expect(f.writes).toEqual([]);
  });
  it("refuses drafts, published and release target versions before any mutation", async () => {
    for (const id of ["drafts.target", "target", "versions.release1.target"]) {
      const f = fixture(); f.data.versions.push({ ...source, _id: id, language: "en" });
      await expect(prepare(f.port)).rejects.toMatchObject({ code: "exists" });
      expect(f.writes).toEqual([]);
    }
  });
  it("uses the saved draft rather than a different published snapshot", async () => {
    const f = fixture(); const draft = { ...source, _id: `drafts.${source._id}`, _rev: "draft-revision" }; f.data.versions.push(draft);
    await expect(prepare(f.port)).rejects.toMatchObject({ code: "changed" });
    expect((await loadLocalizedDraftSource(f.port, draft, signal())).source).toEqual(draft);
  });
  it("refuses source release versions and invalid or same-language targets", async () => {
    const f = fixture();
    await expect(prepareLocalizedDraft(f.port, { ...source, _id: "versions.release1.source" }, "en", ["fi", "en"], signal())).rejects.toMatchObject({ code: "source" });
    for (const locale of ["fi", "de"]) await expect(prepareLocalizedDraft(f.port, source, locale, ["fi", "en"], signal())).rejects.toMatchObject({ code: "source" });
  });
  it("refuses overflow reads and oversized UTF-8 content without writes", async () => {
    const f = fixture(); f.data.placements = Array.from({ length: PLACEMENT_LIMIT + 1 }, () => placement);
    await expect(prepare(f.port)).rejects.toMatchObject({ code: "bounds" });
    f.data.placements = []; f.data.versions[0].summary = "ä".repeat(1_800_000);
    await expect(prepare(f.port)).rejects.toMatchObject({ code: "bounds" });
    expect(f.writes).toEqual([]);
  });
  it("does not invent empty successful reads on transport/permission errors", async () => {
    for (const statusCode of [403, 503]) {
      const f = fixture(); f.port.fetch = async () => { throw { statusCode, message: "secret provider body" }; };
      await expect(prepare(f.port)).rejects.toMatchObject({ code: statusCode === 403 ? "permission" : "unavailable" });
      expect(f.writes).toEqual([]);
    }
  });
  it("reports ambiguous provider conflicts as a neutral refusal and never retries", async () => {
    const f = fixture(); const preview = await prepare(f.port); let attempts = 0;
    f.port.create = async () => { attempts++; throw { statusCode: 409, message: "untrusted provider data" }; };
    await expect(createPreparedLocalizedDraft(f.port, preview, source, "en", ["fi", "en"], signal())).rejects.toMatchObject({ code: "conflict" });
    expect(attempts).toBe(1);
  });
  it("refuses an aborted creation and never copies a language-specific poll", async () => {
    const f = fixture(); const preview = await prepare(f.port); const controller = new AbortController(); controller.abort();
    await expect(createPreparedLocalizedDraft(f.port, preview, source, "en", ["fi", "en"], controller.signal)).rejects.toBeInstanceOf(DraftActionError);
    const pollSource = { ...source, body: [{ _type: "contentPollBlock", poll: { _ref: "poll" } }] }; f.data.versions = [pollSource];
    await expect(prepareLocalizedDraft(f.port, pollSource, "en", ["fi", "en"], signal())).rejects.toMatchObject({ code: "poll" });
    expect(f.writes).toEqual([]);
  });
  it("compares source content independent of object key order and transient timestamps", () => {
    expect(documentSnapshot(source)).toBe(documentSnapshot({ ...source, _updatedAt: "ignored", _originalId: "ignored" }));
    expect(documentSnapshot({ b: 1, a: { z: 1, c: 2 } })).toBe(documentSnapshot({ a: { c: 2, z: 1 }, b: 1 }));
  });
});

describe("localized action copy", () => {
  it("uses Finnish for Finnish locales and English fallback for other UI locales", () => {
    expect(localizedDraftActionCopy("fi-FI").action).toBe("Luo kieliversio");
    expect(localizedDraftActionCopy("de-DE").action).toBe("Create language version");
    expect(localizedDraftNotice("Canonical category category lacks a published en label and slug. Localize it before publishing.", "fi")).toContain("Pääkategorialta");
    expect(localizedDraftNotice("Shared media photo needs a en alt entry; this action does not clone media.", "fi")).toContain("vaihtoehtoinen teksti");
    expect(actionFailure({ statusCode: 403, message: "secret" }).message).toBe("permission");
  });
});
