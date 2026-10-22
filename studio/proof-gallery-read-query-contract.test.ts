import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { createProofGalleryReader, PROOF_GALLERY_QUERY } from "../src/lib/proof-gallery-sanity";
import { ClientGalleryDataError } from "../src/lib/client-gallery-model";
import { clientProofGalleryType, clientProofItemType } from "../sanity/schemas/client-proof-gallery";
import type { SanityQueryRequest } from "../src/lib/sanity-client";

// In-memory published fixtures model query semantics, not provider perspective/ACLs.
type Row = Record<string, unknown>;
const handle = "a".repeat(32), id = "proof-one", now = Date.parse("2026-10-23T00:00:00Z");
const config = { projectId: "example1", dataset: "fixture", datasetVisibility: "public" as const, apiVersion: "v2026-06-24" };
const external = vi.fn<typeof fetch>(async () => { throw new Error("External requests are forbidden in query fixtures"); });
beforeEach(() => { external.mockClear(); vi.stubGlobal("fetch", external); });
afterEach(() => { vi.unstubAllGlobals(); expect(external).not.toHaveBeenCalled(); });
function asset(number = 1) {
  const hash = number.toString(16).padStart(40, "0");
  return { _id: `image-${hash}-1600x1000-webp`, _type: "sanity.imageAsset", sha1hash: hash, extension: "webp", mimeType: "image/webp",
    metadata: { dimensions: { width: 1600, height: 1000 } }, originalFilename: "asset-only-marker.webp", url: "https://never-fetch.example/asset" };
}
function gallery(extra: Row = {}) {
  return { _id: id, _type: "clientProofGallery", _rev: "r1", handle, available: true, availabilityMode: "indefinite", referenceHighWater: 3,
    items: [{ _key: "first", _type: "clientProofItem", mediaType: "image", originalFilename: "item-only-marker.jpg", reference: "003",
      image: { _type: "image", asset: { _type: "reference", _ref: asset()._id } } }], ...extra };
}
function media(reference: string, privateOnly: unknown, suffix = "one") {
  return { _id: `media-${suffix}`, _type: "media", privateOnly, image: { asset: { _ref: reference } } };
}
async function query(dataset: Row[], source: string, params?: Readonly<Record<string, unknown>>): Promise<unknown> {
  return (await evaluate(parse(source), { dataset, params: { ...params }, timestamp: new Date(now) })).get();
}
function runtime(dataset: Row[], fresh: unknown) {
  const fetch = vi.fn(async (request: SanityQueryRequest) => query(dataset, request.query, request.params));
  const reader = createProofGalleryReader({ config, query: { query: fetch }, documents: { read: async () => fresh }, now: () => now });
  return { fetch, run: () => reader.read(handle, "fi", "en") };
}

describe("actual GROQ proof projection", () => {
  it("evaluates the real query and publishes only the numbered display projection", async () => {
    const document = gallery(), dataset = [document, asset()];
    const view = await runtime(dataset, document).run();
    expect(view).toMatchObject({ images: [{ itemId: "first", reference: "003", width: 1600, height: 1000, src: `https://cdn.sanity.io/images/example1/fixture/${asset().sha1hash}-1600x1000.webp` }] });
    for (const marker of ["item-only-marker", "asset-only-marker", "never-fetch.example", "_rev", "restricted"]) expect(JSON.stringify(view)).not.toContain(marker);
  });

  it("does not see a delivery gallery with the same handle", async () => {
    const delivery = { ...gallery(), _id: "delivery-one", _type: "clientDeliveryGallery" };
    expect(await runtime([delivery, asset()], null).run()).toBeUndefined();
  });

  it.each([true, "false", 1])("refuses a proof whose asset is marked private-only: %j", async (flag) => {
    const document = gallery(), dataset = [document, asset(), media(asset()._id, flag)];
    await expect(runtime(dataset, document).run()).rejects.toBeInstanceOf(ClientGalleryDataError);
  });

  it("projects only fields the schema declares", () => {
    const declared = new Set(["_id", "_type", "_rev", ...clientProofGalleryType.fields.map(({ name }) => name)]);
    const item = new Set(["_key", "_type", ...clientProofItemType.fields.map(({ name }) => name)]);
    const projection = /"document": \{([^"]*)"title"/u.exec(PROOF_GALLERY_QUERY)?.[1] ?? "";
    for (const name of projection.split(",").map((field) => field.trim()).filter(Boolean)) expect(declared.has(name), name).toBe(true);
    const itemProjection = /"items": items\[0\.\.\.257\]\{([^\n]*)\n/u.exec(PROOF_GALLERY_QUERY)?.[1] ?? "";
    for (const name of itemProjection.split(",").map((field) => field.trim()).filter(Boolean)) expect(item.has(name), name).toBe(true);
    expect(projection).toContain("referenceHighWater"); expect(itemProjection).toContain("reference");
  });
});
