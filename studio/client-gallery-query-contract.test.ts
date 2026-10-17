import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { CLIENT_GALLERY_QUERY, createClientGalleryReader } from "../src/lib/client-gallery-sanity";
import { ClientGalleryChangedError, ClientGalleryDataError } from "../src/lib/client-gallery-model";
import { CLIENT_DELIVERY_ERRORS, validateClientDeliveryGallery } from "../sanity/schemas/client-delivery-gallery";
import type { SanityQueryRequest } from "../src/lib/sanity-client";

// In-memory published fixtures model query semantics, not provider perspective/ACLs.
type Row = Record<string, unknown>;
const handle = "a".repeat(32), id = "client-one", now = Date.parse("2026-10-17T00:00:00Z");
const config = { projectId: "example1", dataset: "fixture", datasetVisibility: "public" as const, apiVersion: "v2026-06-24" };
const external = vi.fn<typeof fetch>(async () => { throw new Error("External requests are forbidden in query fixtures"); });
beforeEach(() => { external.mockClear(); vi.stubGlobal("fetch", external); });
afterEach(() => { vi.unstubAllGlobals(); expect(external).not.toHaveBeenCalled(); });
function asset(number = 1) {
  const hash = number.toString(16).padStart(40, "0");
  return { _id: `image-${hash}-1600x1000-webp`, _type: "sanity.imageAsset", sha1hash: hash, extension: "webp", mimeType: "image/webp",
    metadata: { dimensions: { width: 1600, height: 1000 } }, originalFilename: "source-only-marker.webp", url: "https://never-fetch.example/asset" };
}
function gallery(count = 1) {
  return { _id: id, _type: "clientDeliveryGallery", _rev: "r1", handle, available: true, availabilityMode: "indefinite",
    items: Array.from({ length: count }, (_, index) => ({ _key: `image${index}`, _type: "clientDeliveryItem", mediaType: "image",
      image: { _type: "image", asset: { _type: "reference", _ref: asset()._id } },
      alt: [{ _key: "en", _type: "localizedText", language: "en", value: "Coast" }, { _key: "fi", _type: "localizedText", language: "fi", value: "Rannikko" }] })) };
}
function media(reference: string, privateOnly: unknown, suffix = "one") {
  return { _id: `media-${suffix}`, _type: "media", privateOnly, image: { asset: { _ref: reference } } };
}
async function query(dataset: Row[], source: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> {
  const value = await evaluate(parse(source), { dataset, params: { ...params }, timestamp: new Date(now) });
  return value.get();
}
function runtime(dataset: Row[], fresh: unknown = gallery()) {
  const fetch = vi.fn(async (request: SanityQueryRequest) => query(dataset, request.query, request.params));
  const read = vi.fn(async () => fresh);
  const reader = createClientGalleryReader({ config, query: { query: fetch }, documents: { read }, now: () => now });
  return { fetch, read, run: () => reader.read(handle, "fi", "en") };
}
function native(dataset: Row[], value: unknown = gallery()) {
  const fetch = vi.fn(async (source: string, params?: Readonly<Record<string, unknown>>) => query(dataset, source, params));
  const client = { withConfig() { return this; }, fetch };
  return { fetch, run: () => validateClientDeliveryGallery(value, { getClient: () => client as never }) };
}

describe("actual GROQ asset and snapshot projections", () => {
  it("evaluates both real query paths and publishes only the closed display projection", async () => {
    const document = gallery(), dataset = [document, asset()], before = structuredClone(dataset);
    const f = runtime(dataset, document), view = await f.run();
    expect(f.fetch).toHaveBeenCalledTimes(1); expect(f.read).toHaveBeenCalledTimes(1);
    expect(view).toMatchObject({ kind: "web", images: [{ itemId: "image0", alt: "Rannikko", width: 1600, height: 1000, src: `https://cdn.sanity.io/images/example1/fixture/${asset().sha1hash}-1600x1000.webp`, enquiryAllowed: false }] });
    expect(view).not.toHaveProperty("title"); expect(view).not.toHaveProperty("zipUrl");
    for (const marker of ["source-only-marker", "never-fetch.example", "_rev", "restricted"]) expect(JSON.stringify(view)).not.toContain(marker);
    const studio = native(dataset, document); expect(await studio.run()).toBe(true); expect(studio.fetch).toHaveBeenCalledTimes(2);
    expect(dataset).toEqual(before);
  });
  it.each([undefined, false])("keeps absent/false privateOnly eligible: %j", async (flag) => {
    const document = gallery(), dataset = [document, asset(), media(asset()._id, flag)];
    expect((await runtime(dataset, document).run())?.images).toHaveLength(1); expect(await native(dataset, document).run()).toBe(true);
  });
  it.each([true, "false", 1, {}])("rejects marked or malformed restrictions from the correct parent: %j", async (flag) => {
    const document = gallery(), dataset = [document, asset(), media(asset()._id, false), media(asset()._id, flag, "restricted")];
    await expect(runtime(dataset, document).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
    expect(await native(dataset, document).run()).toBe(CLIENT_DELIVERY_ERRORS.assets);
  });
  it("does not confuse a different restricted asset with the dereferenced gallery asset", async () => {
    const document = gallery(), dataset = [document, asset(), asset(2), media(asset(2)._id, true)];
    expect((await runtime(dataset, document).run())?.images).toHaveLength(1); expect(await native(dataset, document).run()).toBe(true);
  });
  it("refuses a missing reference through both actually evaluated query paths", async () => {
    const document = gallery(), dataset = [document];
    await expect(runtime(dataset, document).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
    expect(await native(dataset, document).run()).toBe(CLIENT_DELIVERY_ERRORS.assets);
  });
  it("keeps all 256 repeated occurrences but bounds overflow projections to 257", async () => {
    const document = gallery(256), dataset = [document, asset()];
    const result = await runtime(dataset, document).run(); expect(result?.images).toHaveLength(256);
    expect(new Set(result?.images.map((image) => image.itemId)).size).toBe(256);
    expect(new Set(result?.images.map((image) => image.mediaId)).size).toBe(1);
    expect(await native(dataset, document).run()).toBe(true);
    const tooMany = gallery(300), rows = await query([tooMany, asset()], CLIENT_GALLERY_QUERY, { handle }) as { document: { items: unknown[] }; assets: unknown[] }[];
    expect(rows[0].document.items).toHaveLength(257); expect(rows[0].assets).toHaveLength(257);
    await expect(runtime([tooMany, asset()], tooMany).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
  });
  it.each([{ available: false }, { availabilityMode: "until", expiryInstant: "2026-10-17T00:00:00Z" }])("fresh unavailable authority wins over an indexed active projection %#", async (change) => {
    const indexed = gallery(), current = { ...indexed, ...change }, f = runtime([indexed, asset()], current);
    expect(await f.run()).toBeUndefined(); expect(f.fetch).toHaveBeenCalledTimes(1);
  });
  it("keeps persistent indexed revision lag a transient error", async () => {
    const indexed = gallery(), f = runtime([indexed, asset()], { ...indexed, _rev: "r2" });
    await expect(f.run()).rejects.toBeInstanceOf(ClientGalleryChangedError); expect(f.fetch).toHaveBeenCalledTimes(2);
  });
});

describe("actual GROQ identity collision queries", () => {
  it("bounds duplicate/new/legacy discovery and never adopts an unregistered legacy record", async () => {
    const document = gallery(), legacy = { _id: "legacy-one", _type: "legacyDeliveryGallery", handle };
    const rows = await query([document, legacy, { ...document, _id: "another" }, asset()], CLIENT_GALLERY_QUERY, { handle });
    expect(rows).toHaveLength(2);
    await expect(runtime([document, legacy, asset()], document).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
    const onlyLegacy = runtime([legacy, asset()]); expect(await onlyLegacy.run()).toBeUndefined(); expect(onlyLegacy.read).not.toHaveBeenCalled();
  });
  it("excludes this document's own draft and release versions from native handle conflicts", async () => {
    const document = gallery();
    const dataset = [document, { ...document, _id: `drafts.${id}` }, { ...document, _id: `versions.release.${id}` }, asset()];
    expect(await native(dataset, { ...document, _id: `drafts.${id}` }).run()).toBe(true);
  });
  it.each(["drafts.other", "versions.release.other", "versions.release.other-client-one"])("refuses the other document's reserved handle %s", async (otherId) => {
    const document = gallery();
    expect(await native([document, { ...document, _id: otherId }, asset()], document).run()).toBe(CLIENT_DELIVERY_ERRORS.identity);
  });
  it("refuses a legacy collision and changing a previously published handle", async () => {
    const document = gallery();
    expect(await native([document, { _id: "legacy-one", _type: "legacyDeliveryGallery", handle }, asset()], document).run()).toBe(CLIENT_DELIVERY_ERRORS.identity);
    expect(await native([document, asset()], { ...document, handle: "b".repeat(32) }).run()).toBe(CLIENT_DELIVERY_ERRORS.identity);
  });
});
