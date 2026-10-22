import { describe, expect, it, vi } from "vitest";
import { defineSchemaTypes } from "./index";
import { clientProofGalleryType, clientProofItemType, CLIENT_PROOF_ERRORS as errors, validateClientProofGallery } from "./client-proof-gallery";
import type { SchemaValidationClient } from "./schema-types";

const assetId = (n: string) => `image-${n.repeat(40)}-1600x1000-webp`;
const proof = (key: string, filename: string, asset: string, reference?: string) => ({
  _key: key, _type: "clientProofItem", mediaType: "image", originalFilename: filename,
  image: { _type: "image", asset: { _type: "reference", _ref: asset } }, ...(reference ? { reference } : {}),
});
function gallery(overrides: Record<string, unknown> = {}) {
  return { _id: "drafts.proofs", _type: "clientProofGallery", handle: "c".repeat(32), available: false,
    availabilityMode: "indefinite", referenceHighWater: 2,
    items: [proof("k1", "IMG_10.jpg", assetId("a"), "002"), proof("k2", "IMG_9.jpg", assetId("b"), "001")], ...overrides };
}
const asset = (n: string) => ({ _id: assetId(n), _type: "sanity.imageAsset", extension: "webp", mimeType: "image/webp", sha1hash: n.repeat(40), width: 1600, height: 1000, restricted: false });
function setup(options: { identity?: unknown; assets?: unknown } = {}) {
  const fetch = vi.fn(async (query: string) =>
    (query.includes('"conflicts"')
      ? Object.hasOwn(options, "identity") ? options.identity : { conflicts: [], published: null }
      : Object.hasOwn(options, "assets") ? options.assets : [asset("a"), asset("b")]) as never);
  const client: SchemaValidationClient = { fetch, withConfig: vi.fn(() => client) };
  const context = { getClient: vi.fn(() => client) };
  return { fetch, run: (value: unknown) => validateClientProofGallery(value, context) };
}

describe("Sanity proof gallery authoring (ADR-0038, AB#130)", () => {
  it("registers a closed model with indefinite default availability and read-only numbers", () => {
    const types = defineSchemaTypes({ datasetVisibility: "public", storyRootPaths: ["/stories"] });
    expect(types).toContainEqual(clientProofGalleryType);
    expect(types).toContainEqual(clientProofItemType);
    const field = (name: string) => clientProofGalleryType.fields.find((f) => f.name === name);
    expect(field("availabilityMode")?.initialValue).toBe("indefinite");
    expect(field("available")?.initialValue).toBe(false);
    expect(field("handle")?.readOnly).toBe(true);
    expect(field("referenceHighWater")?.readOnly).toBe(true);
    expect(clientProofItemType.fields.find((f) => f.name === "reference")?.readOnly).toBe(true);
    expect(clientProofGalleryType.fields.map((f) => f.name)).not.toEqual(expect.arrayContaining(["price", "email", "customer"]));
  });
  it("accepts a first publication numbered in natural filename order", async () => {
    const f = setup();
    expect(await f.run(gallery())).toBe(true);
    expect(f.fetch.mock.calls[0][0]).toContain('"clientProofGallery"');
  });
  it("refuses numbers that do not follow the published state", async () => {
    expect(await setup().run(gallery({ items: [proof("k1", "IMG_10.jpg", assetId("a"), "001"), proof("k2", "IMG_9.jpg", assetId("b"), "002")] }))).toBe(errors.references);
    expect(await setup().run(gallery({ items: [proof("k1", "IMG_10.jpg", assetId("a")), proof("k2", "IMG_9.jpg", assetId("b"), "001")] }))).toBe(errors.references);
    expect(await setup().run(gallery({ referenceHighWater: 5 }))).toBe(errors.references);
    const published = { _type: "clientProofGallery", handle: "c".repeat(32), referenceHighWater: 2,
      items: [{ _key: "k1", reference: "002", assetRef: assetId("a") }, { _key: "k2", reference: "001", assetRef: assetId("b") }] };
    const removedAndAdded = gallery({ referenceHighWater: 3, items: [proof("k1", "IMG_10.jpg", assetId("a"), "002"), proof("k3", "IMG_1.jpg", assetId("b"), "003")] });
    expect(await setup({ identity: { conflicts: [], published } }).run(removedAndAdded)).toBe(true);
    const reused = gallery({ referenceHighWater: 2, items: [proof("k1", "IMG_10.jpg", assetId("a"), "002"), proof("k3", "IMG_1.jpg", assetId("b"), "001")] });
    expect(await setup({ identity: { conflicts: [], published } }).run(reused)).toBe(errors.references);
    const replaced = gallery({ items: [proof("k1", "IMG_10.jpg", assetId("b"), "002"), proof("k2", "IMG_9.jpg", assetId("b"), "001")] });
    expect(await setup({ identity: { conflicts: [], published }, assets: [asset("b")] }).run(replaced)).toBe(errors.references);
  });
  it("refuses an inconsistent published state instead of numbering from it", async () => {
    const draft = gallery({ referenceHighWater: 1, items: [proof("k1", "IMG_1.jpg", assetId("a"), "001"), proof("k2", "IMG_2.jpg", assetId("b"), "001")] });
    const belowHighWater = { _type: "clientProofGallery", handle: "c".repeat(32), referenceHighWater: 0,
      items: [{ _key: "k1", reference: "001", assetRef: assetId("a") }] };
    expect(await setup({ identity: { conflicts: [], published: belowHighWater } }).run(draft)).toBe(errors.identity);
    const duplicated = { _type: "clientProofGallery", handle: "c".repeat(32), referenceHighWater: 2,
      items: [{ _key: "k1", reference: "001", assetRef: assetId("a") }, { _key: "k2", reference: "001", assetRef: assetId("b") }] };
    expect(await setup({ identity: { conflicts: [], published: duplicated } }).run(gallery({ items: [proof("k1", "IMG_1.jpg", assetId("a"), "001"), proof("k2", "IMG_2.jpg", assetId("b"), "001")] }))).toBe(errors.identity);
  });
  it("refuses a handle used by any client, legacy or proof gallery and a published document of another shape", async () => {
    expect(await setup({ identity: { conflicts: [{ _id: "other" }], published: null } }).run(gallery())).toBe(errors.identity);
    expect(await setup({ identity: { conflicts: [], published: { _type: "clientDeliveryGallery", handle: "c".repeat(32) } } }).run(gallery())).toBe(errors.identity);
  });
  it("refuses unknown fields, missing filenames and oversized or cropped images", async () => {
    expect(await setup().run(gallery({ price: 10 }))).toBe(errors.structure);
    expect(await setup().run(gallery({ items: [{ ...proof("k1", "IMG_1.jpg", assetId("a"), "001"), originalFilename: "" }] }))).toBe(errors.structure);
    expect(await setup().run(gallery({ items: [proof("k1", "IMG_1.jpg", `image-${"a".repeat(40)}-4000x1000-webp`, "001")], referenceHighWater: 1 }))).toBe(errors.structure);
    expect(await setup({ assets: [] }).run(gallery())).toBe(errors.assets);
  });
});
