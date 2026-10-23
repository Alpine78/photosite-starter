import { describe, expect, it, vi } from "vitest";
import { createClientGalleryReader, CLIENT_GALLERY_MISS_CAPACITY, CLIENT_GALLERY_MISS_TTL_MS, CLIENT_GALLERY_QUERY } from "@/lib/client-gallery-sanity";
import { ClientGalleryBudgetError, ClientGalleryChangedError, ClientGalleryDataError, parseClientGallery } from "@/lib/client-gallery-model";
import { validateClientDeliveryGallery, CLIENT_DELIVERY_MAX_DOCUMENT_BYTES, CLIENT_DELIVERY_MAX_ITEMS } from "../../sanity/schemas/client-delivery-gallery";
import { CLIENT_GALLERY_MAX_DOCUMENT_BYTES, CLIENT_GALLERY_MAX_ITEMS } from "@/lib/client-gallery-model";
import { createSanityClient, createSanityDocumentReader, SanityQueryError } from "@/lib/sanity-client";

const handle = "a".repeat(32), id = "client1", assetId = `image-${"b".repeat(40)}-1600x1000-webp`;
const now = Date.parse("2026-10-17T00:00:00Z");
const config = { projectId: "abcdefgh", dataset: "fixture", datasetVisibility: "public" as const, apiVersion: "v2026-06-24" };
function document() {
  return { _id: id, _type: "clientDeliveryGallery", _rev: "rev1", _createdAt: "2026-10-16T12:00:00Z", _updatedAt: "2026-10-16T12:00:00Z",
    handle, available: true, availabilityMode: "indefinite",
    title: [{ _key: "en", _type: "localizedText", language: "en", value: "Delivery" }, { _key: "fi", _type: "localizedText", language: "fi", value: "Toimitus" }],
    items: [{ _key: "one", _type: "clientDeliveryItem", mediaType: "image",
      image: { _type: "image", asset: { _type: "reference", _ref: assetId } },
      alt: [{ _key: "en", _type: "localizedText", language: "en", value: "Coast" }, { _key: "fi", _type: "localizedText", language: "fi", value: "Rannikko" }] }] };
}
const metadata = () => ({ _id: assetId, _type: "sanity.imageAsset", sha1hash: "b".repeat(40), extension: "webp", mimeType: "image/webp", width: 1600, height: 1000, restricted: false });
function row(doc = document()) {
  return { _id: id, _type: "clientDeliveryGallery", document: structuredClone(doc), assets: doc.items.map(() => ({ asset: metadata() })) };
}
function setup(options: { doc?: unknown; rows?: unknown; wall?: () => number; tick?: () => number; missing?: Map<string, number>; visibility?: "public" | "private" } = {}) {
  const controller = new AbortController();
  const query = vi.fn(async () => Object.hasOwn(options, "rows") ? options.rows : [row()]);
  const read = vi.fn(async () => Object.hasOwn(options, "doc") ? options.doc : document());
  const reader = createClientGalleryReader({ config: { ...config, datasetVisibility: options.visibility ?? "public" }, query: { query }, documents: { read },
    now: options.wall ?? (() => now), missClock: options.tick ?? (() => 0), missing: options.missing, signal: () => controller.signal });
  return { query, read, reader, controller, run: (value = handle, language = "en-GB", fallback = "en") => reader.read(value, language, fallback) };
}

describe("fresh unlisted Sanity client reading", () => {
  it("projects only a validated finite deadline and invents none for indefinite delivery", async () => {
    const doc = { ...document(), availabilityMode: "until", expiryInstant: "2026-10-17T00:00:01.123Z" };
    expect(await setup({ doc, rows: [row(doc)] }).run()).toMatchObject({ kind: "web", availableUntil: doc.expiryInstant });
    expect(await setup().run()).not.toHaveProperty("availableUntil");
  });
  it("uses two bounded reads and projects only full-frame presentation data", async () => {
    const f = setup(), view = await f.run();
    expect(f.query).toHaveBeenCalledTimes(1); expect(f.read).toHaveBeenCalledTimes(1);
    expect(f.query).toHaveBeenCalledWith({ query: CLIENT_GALLERY_QUERY, tag: "client.gallery", params: { handle }, signal: f.controller.signal });
    expect(f.read).toHaveBeenCalledWith(id, f.controller.signal);
    expect(view).toMatchObject({ title: "Delivery", images: [{ itemId: "one", src: `https://cdn.sanity.io/images/abcdefgh/fixture/${"b".repeat(40)}-1600x1000.webp`, width: 1600, height: 1000, alt: "Coast", enquiryAllowed: false }] });
    expect(view).not.toHaveProperty("zipUrl");
    const payload = JSON.stringify(view);
    for (const internal of ["_rev", "_system", "restricted", "clientDeliveryGallery", assetId]) expect(payload).not.toContain(internal);
  });
  it("integrates both actual HTTP transports without caching or exposing credentials", async () => {
    const send = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      return new Response(JSON.stringify(url.pathname.includes("/data/query/") ? { result: [row()] } : { documents: [document()] }));
    });
    const privateConfig = { ...config, datasetVisibility: "private" as const, readToken: "synthetic-read-credential" };
    const settings = { config: privateConfig, fetchImplementation: send, maxResponseBytes: 1024 * 1024, rejectDuplicateJsonKeys: true };
    const reader = createClientGalleryReader({ config: privateConfig, query: createSanityClient(settings), documents: createSanityDocumentReader(settings), now: () => now });
    expect((await reader.read(handle, "fi", "en"))?.title).toBe("Toimitus"); expect(send).toHaveBeenCalledTimes(2);
    for (const [url, request] of send.mock.calls) {
      expect(request).toMatchObject({ cache: "no-store", redirect: "manual" }); expect(request).not.toHaveProperty("next");
      expect(request?.signal).toBeInstanceOf(AbortSignal); expect(String(url)).not.toContain("synthetic-read-credential");
      expect(new Headers(request?.headers).get("authorization")).toBe("Bearer synthetic-read-credential");
    }
  });
  it("resolves real authored FI text and uses a generic heading rather than another language's title", async () => {
    expect((await setup().run(handle, "fi-FI"))?.title).toBe("Toimitus");
    expect((await setup().run(handle, "fi-FI"))?.images[0].alt).toBe("Rannikko");
    const view = await setup().run(handle, "sv", "fi");
    expect(view?.title).toBeUndefined(); expect(view?.images[0].alt).toBe("Rannikko");
  });
  it.each(["", "A".repeat(32), "a".repeat(32) + "\n", "a/../b"])("refuses malformed handle %j without provider IO", async (input) => {
    const f = setup(); expect(await f.run(input)).toBeUndefined(); expect(f.query).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
  });
  it.each([null, { ...document(), available: false }, { ...document(), availabilityMode: "until", expiryInstant: "2026-10-17T00:00:00Z" }])("fresh missing/paused/expired authority wins over indexed content %#", async (doc) => {
    expect(await setup({ doc }).run()).toBeUndefined();
  });
  it("rechecks the exclusive deadline after projection work", async () => {
    const doc = { ...document(), availabilityMode: "until", expiryInstant: "2026-10-17T00:00:01Z" };
    let calls = 0;
    expect(await setup({ doc, rows: [row(doc)], wall: () => calls++ === 0 ? now : now + 1000 }).run()).toBeUndefined();
  });
  it("retries one stale indexed revision but never calls it a missing gallery", async () => {
    const current = { ...document(), _rev: "rev2" }, f = setup({ doc: current });
    f.query.mockResolvedValueOnce([row()]).mockResolvedValueOnce([row(current)]);
    expect((await f.run())?.images).toHaveLength(1); expect(f.query).toHaveBeenCalledTimes(2); expect(f.read).toHaveBeenCalledTimes(2);
    const stale = setup({ doc: current });
    await expect(stale.run()).rejects.toBeInstanceOf(ClientGalleryChangedError); expect(stale.query).toHaveBeenCalledTimes(2);
  });
  it("detects a contradictory same-revision snapshot and checks a known ID lost by the index", async () => {
    const f = setup(), altered = row(); altered.document.title[0].value = "Different";
    f.query.mockResolvedValue([altered]); await expect(f.run()).rejects.toBeInstanceOf(ClientGalleryChangedError);
    const current = { ...document(), _rev: "rev2" }, lost = setup({ doc: current });
    lost.query.mockResolvedValueOnce([row()]).mockResolvedValueOnce([]);
    await expect(lost.run()).rejects.toBeInstanceOf(ClientGalleryChangedError); expect(lost.read).toHaveBeenCalledTimes(2);
    const closed = setup(); closed.query.mockResolvedValueOnce([altered]).mockResolvedValueOnce([]); closed.read.mockResolvedValueOnce(document()).mockResolvedValueOnce(null);
    expect(await closed.run()).toBeUndefined();
  });
  it.each([null, {}, [row(), row()], [null], [{ ...row(), _id: "drafts.client1" }]].map((rows) => ({ rows })))("rejects malformed/ambiguous discovery %#", async ({ rows }) => {
    await expect(setup({ rows }).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
  });
  it("does not adopt a legacy-only result outside the deployed legacy registry", async () => {
    const f = setup({ rows: [{ _id: "legacy1", _type: "legacyDeliveryGallery" }] });
    expect(await f.run()).toBeUndefined(); expect(f.read).not.toHaveBeenCalled();
  });
  it.each([
    null, [], [{ asset: null }], [{ asset: { ...metadata(), _id: "foreign" } }],
    [{ asset: { ...metadata(), restricted: true } }], [{ asset: { ...metadata(), restricted: "false" } }],
    [{ asset: { ...metadata(), width: 1599 } }], [{ asset: { ...metadata(), mimeType: "image/tiff" } }],
    [{ asset: { ...metadata(), sha1hash: "c".repeat(40) } }], [{ asset: metadata() }, { asset: metadata() }],
  ].map((assets) => ({ assets })))("refuses missing/substituted/private metadata without exposing it %#", async ({ assets }) => {
    await expect(setup({ rows: [{ ...row(), assets }] }).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
  });
  it("keeps repeated-source media identity stable and supports 256 complete occurrences in one query", async () => {
    const doc = document(); doc.items = Array.from({ length: 256 }, (_, i) => ({ ...doc.items[0], _key: `item${i}` }));
    const f = setup({ doc, rows: [row(doc)] }), view = await f.run();
    expect(view?.images).toHaveLength(256); expect(new Set(view?.images.map((image) => image.itemId)).size).toBe(256);
    expect(new Set(view?.images.map((image) => image.mediaId)).size).toBe(1); expect(f.query).toHaveBeenCalledTimes(1);
  });
  it("shares one end-to-end abort signal and propagates redacted upstream failures", async () => {
    const aborted = setup(); aborted.controller.abort(new Error("PRIVATE"));
    await expect(aborted.run()).rejects.toBeInstanceOf(ClientGalleryBudgetError); expect(aborted.query).not.toHaveBeenCalled();
    const during = setup(); during.query.mockImplementation(async () => { during.controller.abort(); return [row()]; });
    await expect(during.run()).rejects.toBeInstanceOf(ClientGalleryBudgetError); expect(during.read).not.toHaveBeenCalled();
    const denied = setup(), error = new SanityQueryError({ errorClass: "unauthorized", retryable: false, correlationId: "synthetic" });
    denied.query.mockRejectedValue(error); await expect(denied.run()).rejects.toBe(error);
    const unknown = setup(); unknown.query.mockRejectedValue(new Error("PRIVATE"));
    await expect(unknown.run()).rejects.toThrow("Client gallery provider unavailable");
  });
});

describe("bounded absent-discovery cache", () => {
  it("does not reuse misses across projects, datasets or API versions", async () => {
    const missing = new Map<string, number>();
    await setup({ rows: [], missing }).run();
    for (const changed of [{ projectId: "other123" }, { dataset: "other" }, { apiVersion: "v2026-01-01" }]) {
      const query = vi.fn(async () => [row()]);
      const reader = createClientGalleryReader({ config: { ...config, ...changed }, query: { query }, documents: { read: async () => document() }, missing, missClock: () => 0, now: () => now });
      expect((await reader.read(handle, "en", "en"))?.images).toHaveLength(1);
      expect(query).toHaveBeenCalledTimes(1);
    }
  });
  it("caches only public empty discovery for ten seconds, with explicit publication delay", async () => {
    let tick = 0; const f = setup({ rows: [], tick: () => tick });
    expect(await f.run()).toBeUndefined(); f.query.mockResolvedValue([row()]);
    tick = CLIENT_GALLERY_MISS_TTL_MS - 1; expect(await f.run()).toBeUndefined(); expect(f.query).toHaveBeenCalledTimes(1);
    tick++; expect((await f.run())?.images).toHaveLength(1); expect(f.query).toHaveBeenCalledTimes(2);
    const privateReader = setup({ rows: [], visibility: "private" }); await privateReader.run(); await privateReader.run(); expect(privateReader.query).toHaveBeenCalledTimes(2);
  });
  it("bounds misses and never caches publication state or errors", async () => {
    const missing = new Map<string, number>(), f = setup({ rows: [], missing });
    for (let i = 0; i < CLIENT_GALLERY_MISS_CAPACITY + 5; i++) await f.run(i.toString(16).padStart(32, "0"));
    expect(missing.size).toBe(CLIENT_GALLERY_MISS_CAPACITY);
    const positive = setup(); await positive.run(); positive.read.mockResolvedValue(null); expect(await positive.run()).toBeUndefined(); expect(positive.query).toHaveBeenCalledTimes(2);
    const bad = setup({ rows: [row(), row()] }); await expect(bad.run()).rejects.toBeInstanceOf(ClientGalleryDataError); await expect(bad.run()).rejects.toBeInstanceOf(ClientGalleryDataError); expect(bad.query).toHaveBeenCalledTimes(2);
  });
});

describe("authoring/runtime structural corpus", () => {
  it("accepts exactly the authored byte limit despite platform metadata and refuses one extra byte", async () => {
    const doc = document();
    doc.items = Array.from({ length: 256 }, (_, i) => structuredClone({ ...doc.items[0], _key: `item${i}` }));
    const authoredBytes = () => new TextEncoder().encode(JSON.stringify(Object.fromEntries(Object.entries(doc).filter(([name]) => !["_id", "_rev", "_createdAt", "_updatedAt", "_system"].includes(name))))).byteLength;
    let remaining = CLIENT_GALLERY_MAX_DOCUMENT_BYTES - authoredBytes();
    for (const item of doc.items) for (const alt of item.alt) {
      const added = Math.min(remaining, 511 - alt.value.length);
      alt.value += "x".repeat(added); remaining -= added;
    }
    expect(remaining).toBe(0); expect(authoredBytes()).toBe(CLIENT_GALLERY_MAX_DOCUMENT_BYTES);
    const withPlatform = { ...doc, _system: { publicationMetadata: "p".repeat(100_000) } };
    const client = { withConfig() { return this; }, async fetch(query: string) { return (query.includes('"conflicts"') ? { conflicts: [], published: { _type: "clientDeliveryGallery", handle } } : [metadata()]) as never; } };
    expect(await validateClientDeliveryGallery(withPlatform, { getClient: () => client })).toBe(true);
    expect(() => parseClientGallery(withPlatform, id, handle)).not.toThrow();
    withPlatform.items[0].alt[0].value += "x";
    expect(await validateClientDeliveryGallery(withPlatform, { getClient: () => client })).not.toBe(true);
    expect(() => parseClientGallery(withPlatform, id, handle)).toThrow(ClientGalleryDataError);
  });
  const vectors = [
    document(), { ...document(), _system: { base: { id, rev: "rev0" } } },
    { ...document(), availabilityMode: "until", expiryInstant: "2026-12-01T00:00:00.123Z" },
    { ...document(), customerEmail: "synthetic@example.test" }, { ...document(), available: "true" },
    { ...document(), availabilityMode: "until" }, { ...document(), expiryInstant: "2026-12-01T00:00:00Z" },
    { ...document(), title: [{ ...document().title[0], value: "x".repeat(201) }] },
    { ...document(), items: Array(1) }, { ...document(), items: [] },
    { ...document(), items: [{ ...document().items[0], mediaType: "video" }] },
    { ...document(), items: [{ ...document().items[0], alt: [{ ...document().items[0].alt[0], value: "x".repeat(513) }] }] },
    { ...document(), items: [document().items[0], document().items[0]] },
  ];
  it("pins independent schema and runtime bounds", () => {
    expect(CLIENT_GALLERY_MAX_ITEMS).toBe(CLIENT_DELIVERY_MAX_ITEMS); expect(CLIENT_GALLERY_MAX_DOCUMENT_BYTES).toBe(CLIENT_DELIVERY_MAX_DOCUMENT_BYTES);
  });
  it.each(vectors.map((doc) => ({ doc })))("gives native published documents the same structural verdict %#", async ({ doc }) => {
    const client = { withConfig() { return this; }, async fetch(query: string) { return (query.includes('"conflicts"') ? { conflicts: [], published: { _type: "clientDeliveryGallery", handle } } : [metadata()]) as never; } };
    const schema = await validateClientDeliveryGallery(doc, { getClient: () => client });
    let accepted = true; try { parseClientGallery(doc, id, handle); } catch { accepted = false; }
    expect(accepted).toBe(schema === true);
  });

  it("answers a proof replacement check only for the expected document", async () => {
    expect(await setup().reader.read(handle, "en-GB", "en", id)).toMatchObject({ kind: "web" });
    const f = setup(); expect(await f.reader.read(handle, "en-GB", "en", "another-document")).toBeUndefined();
    expect(f.read).not.toHaveBeenCalled();
  });
});
