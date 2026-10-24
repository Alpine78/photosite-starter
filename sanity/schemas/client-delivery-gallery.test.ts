import { describe, expect, it, vi } from "vitest";
import { defineSchemaTypes } from "./index";
import { clientDeliveryGalleryType, clientDeliveryItemType, CLIENT_DELIVERY_ERRORS as errors, validateClientDeliveryGallery } from "./client-delivery-gallery";
import { inspectValidationRules } from "./validation-test-helper";
import { studioValidationMessage } from "../../studio/interface-locales";
import type { SchemaValidationClient } from "./schema-types";

const assetId = `image-${"a".repeat(40)}-1600x1000-webp`;
const alt = () => [{ _key: "fi", _type: "localizedText", language: "fi", value: "Rantakallio" }];
function gallery() {
  return { _id: "drafts.new-gallery", _type: "clientDeliveryGallery", handle: "b".repeat(32),
    available: false, availabilityMode: "indefinite", title: alt(),
    items: [{ _key: "item1", _type: "clientDeliveryItem", mediaType: "image",
      image: { _type: "image", asset: { _type: "reference", _ref: assetId } }, alt: alt() }] };
}
const asset = () => ({ _id: assetId, _type: "sanity.imageAsset", extension: "webp", mimeType: "image/webp", sha1hash: "a".repeat(40), width: 1600, height: 1000, restricted: false });
function setup(options: { identity?: unknown; assets?: unknown; failure?: boolean } = {}) {
  const fetch = vi.fn(async (query: string) => {
    if (options.failure) throw new Error("SENSITIVE provider response");
    return (query.includes('"conflicts"')
      ? Object.hasOwn(options, "identity") ? options.identity : { conflicts: [], published: null }
      : Object.hasOwn(options, "assets") ? options.assets : [asset()]) as never;
  });
  const withConfig = vi.fn(() => client);
  const client: SchemaValidationClient = { fetch, withConfig };
  const context = { getClient: vi.fn(() => client) };
  return { context, fetch, withConfig, run: (value: unknown) => validateClientDeliveryGallery(value, context) };
}

describe("Sanity client delivery authoring", () => {
  it("registers a separate closed model and reuses the actual document validator", async () => {
    const types = defineSchemaTypes({ datasetVisibility: "public", storyRootPaths: ["/stories"] });
    expect(types).toContainEqual(clientDeliveryGalleryType);
    expect(types).toContainEqual(clientDeliveryItemType);
    const { checks } = inspectValidationRules(clientDeliveryGalleryType.validation);
    const f = setup();
    expect(await checks[0](gallery(), f.context)).toBe(true);
    expect(clientDeliveryGalleryType.fields.map((f) => f.name)).not.toContain("deliveryZip");
    expect(clientDeliveryGalleryType.fields.find((f) => f.name === "available")?.initialValue).toBe(false);
    expect(clientDeliveryGalleryType.fields.find((f) => f.name === "availabilityMode")?.initialValue).toBeUndefined();
    expect(clientDeliveryGalleryType.fields.find((f) => f.name === "handle")?.readOnly).toBe(true);
    expect(clientDeliveryItemType.fields.find((f) => f.name === "image")?.options).toMatchObject({ hotspot: false, storeOriginalFilename: false });
  });
  it("checks raw identities and actual measured asset metadata without requiring private storage", async () => {
    const f = setup(); expect(await f.run(gallery())).toBe(true);
    expect(f.withConfig).toHaveBeenCalledWith({ perspective: "raw", useCdn: false });
    expect(f.fetch.mock.calls[0][0]).toContain('"legacyDeliveryGallery"');
    const calls = f.fetch.mock.calls as unknown as [string, Record<string, unknown>][];
    expect(calls[0][1]).toEqual({ id: "new-gallery", handle: "b".repeat(32) });
    expect(calls[1][1]).toEqual({ ids: [assetId] });
    expect(calls[1][0]).toContain('defined(privateOnly) && privateOnly != false');
  });
  it("accepts native system metadata and typed neutral image geometry", async () => {
    const data = { ...gallery(), _system: { base: { id: "new-gallery", rev: "revision1" } } };
    Object.assign(data.items[0].image, {
      crop: { _type: "sanity.imageCrop", top: 0, right: 0, bottom: 0, left: 0 },
      hotspot: { _type: "sanity.imageHotspot", x: 0.5, y: 0.5, width: 1, height: 1 },
    });
    expect(await setup().run(data)).toBe(true);
  });
  it.each([
    null, [], {}, { ...gallery(), customerEmail: "synthetic@example.test" },
    { ...gallery(), archiveLocator: "sensitive" }, { ...gallery(), available: "true" },
    { ...gallery(), availabilityMode: undefined }, { ...gallery(), availabilityMode: "forever" },
    { ...gallery(), expiryInstant: "2026-12-01T00:00:00Z" },
    { ...gallery(), availabilityMode: "until" },
    { ...gallery(), availabilityMode: "until", expiryInstant: "2026-02-30T00:00:00Z" },
    { ...gallery(), availabilityMode: "until", expiryInstant: "2026-12-01" },
    { ...gallery(), title: [{ ...alt()[0], language: "fi\n" }] },
    { ...gallery(), title: [{ ...alt()[0], value: "x".repeat(201) }] },
    { ...gallery(), title: [...alt(), ...alt()] },
    { ...gallery(), title: [alt()[0], { ...alt()[0], language: "en" }] },
    { ...gallery(), title: Object.assign(Array(1), { extra: alt()[0] }) },
    { ...gallery(), items: [] }, { ...gallery(), items: Array(2) },
    { ...gallery(), items: Array.from({ length: 257 }, (_, i) => ({ ...gallery().items[0], _key: `i${i}` })) },
  ])("refuses malformed or private gallery data before provider IO %#", async (value) => {
    const f = setup(); expect(await f.run(value)).toBe(errors.structure); expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each(["", "b".repeat(31), "b".repeat(32) + "\n", "B".repeat(32), "customer-name"])("rejects invalid handles before provider IO: %j", async (handle) => {
    const f = setup(); expect(await f.run({ ...gallery(), handle })).toBe(errors.identity); expect(f.fetch).not.toHaveBeenCalled();
  });
  it.each([
    { mediaType: "video" }, { _key: "" }, { filename: "private" }, { alt: [] },
    { alt: [{ ...alt()[0], value: " " }] }, { alt: [{ ...alt()[0], value: "x".repeat(513) }] },
    { image: { _type: "image", asset: { _type: "reference", _ref: assetId, _weak: true } } },
    { image: { _type: "image", asset: { _type: "reference", _ref: `image-${"a".repeat(40)}-3000x2000-jpg` } } },
    { image: { _type: "image", asset: { _type: "reference", _ref: assetId + "\n" } } },
    { image: { ...gallery().items[0].image, crop: { top: 0.1, right: 0, bottom: 0, left: 0 } } },
    { image: { ...gallery().items[0].image, crop: { _type: "other", top: 0, right: 0, bottom: 0, left: 0 } } },
  ])("refuses unsafe image items before provider IO %#", async (patch) => {
    const f = setup(); expect(await f.run({ ...gallery(), items: [{ ...gallery().items[0], ...patch }] })).toBe(errors.structure); expect(f.fetch).not.toHaveBeenCalled();
  });
  it("allows repeated photographs with distinct occurrence keys but rejects duplicate keys", async () => {
    const data = gallery(); data.items.push({ ...data.items[0], _key: "item2" });
    expect(await setup().run(data)).toBe(true);
    data.items[1]._key = "item1"; expect(await setup().run(data)).toBe(errors.structure);
  });
  it.each(["2026-12-01T00:00:00Z", "2026-12-01T00:00:00.123Z"])("accepts explicit canonical UTC deadlines without inventing durations: %s", async (expiryInstant) => {
    expect(await setup().run({ ...gallery(), availabilityMode: "until", expiryInstant })).toBe(true);
  });
  it.each(["new-gallery", "drafts.new-gallery"])("keeps the same published identity for %s", async (_id) => {
    const f = setup({ identity: { conflicts: [], published: { _type: "clientDeliveryGallery", handle: "b".repeat(32) } } });
    expect(await f.run({ ...gallery(), _id })).toBe(true);
  });
  it.each([
    { conflicts: [{ _id: "legacy-gallery" }], published: null },
    { conflicts: [], published: { _type: "clientDeliveryGallery", handle: "c".repeat(32) } },
    { conflicts: [], published: { _type: "legacyDeliveryGallery", handle: "b".repeat(32) } },
    { conflicts: false, published: null }, {}, [],
  ])("blocks handle collisions, changes and malformed identity evidence %#", async (identity) => {
    expect(await setup({ identity }).run(gallery())).toBe(errors.identity);
  });
  it.each([
    [], [null], [asset(), asset()], [{ ...asset(), mimeType: "image/tiff" }],
    [{ ...asset(), _type: "sanity.fileAsset" }], [{ ...asset(), width: 0 }],
    [{ ...asset(), restricted: true }], [{ ...asset(), restricted: undefined }], [{ ...asset(), restricted: "false" }],
    [{ ...asset(), width: 1601 }], [{ ...asset(), height: 1000.1 }],
    [{ ...asset(), sha1hash: "c".repeat(40) }], [{ ...asset(), extension: "jpeg" }],
    [{ ...asset(), _id: "not-assigned" }],
  ].map((assets) => ({ assets })))("blocks missing, substituted and contradictory measured assets %#", async ({ assets }) => {
    expect(await setup({ assets }).run(gallery())).toBe(errors.assets);
  });
  it("redacts provider/input failures and localizes all custom refusals", async () => {
    expect(await setup({ failure: true }).run(gallery())).toBe(errors.unavailable);
    const hostile = Object.defineProperty({}, "_type", { get() { throw new Error("SENSITIVE"); }, enumerable: true });
    expect(await setup().run(hostile)).toBe(errors.unavailable);
    for (const message of Object.values(errors)) {
      expect(studioValidationMessage(message)["fi-FI"]).not.toBe(message);
      expect(studioValidationMessage(message)["en-US"]).toBe(message);
    }
  });
  it("bounds the entire UTF-8 document before provider IO, including translated texts", async () => {
    const data = gallery();
    data.items = Array.from({ length: 256 }, (_, i) => ({ ...data.items[0], _key: `item${i}`,
      alt: Array.from({ length: 20 }, (_, j) => ({ _key: `text${j}`, _type: "localizedText", language: `a${String.fromCharCode(97 + j)}`, value: "漢".repeat(512) })) }));
    const f = setup(); expect(await f.run(data)).toBe(errors.size); expect(f.fetch).not.toHaveBeenCalled();
  });
});
