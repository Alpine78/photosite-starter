import { describe, expect, it } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { PUBLICATION_RELATED_QUERY, PUBLICATION_STATE_QUERY } from "../src/lib/proof-publication-sanity";

// Executes the publication route's actual query strings over a synthetic raw dataset.
const handle = "c".repeat(32);
const asset = (n: string) => `image-${n.repeat(40)}-1600x1000-webp`;
const dataset = [
  { _id: "drafts.g1", _type: "clientProofGallery", _rev: "d1", handle },
  { _id: "g1", _type: "clientProofGallery", _rev: "p1", handle },
  { _id: "versions.r1.g1", _type: "clientProofGallery", _rev: "v1", handle },
  { _id: "proofTerms.g1", _type: "clientProofTerms", _rev: "t1", galleryId: "g1", selectionKeyHash: "secret-hash-not-projected" },
  { _id: "other-delivery", _type: "clientDeliveryGallery", handle: "d".repeat(32) },
  { _id: asset("a"), _type: "sanity.imageAsset", extension: "webp", mimeType: "image/webp", sha1hash: "a".repeat(40), metadata: { dimensions: { width: 1600, height: 1000 } } },
  { _id: asset("b"), _type: "sanity.imageAsset", extension: "webp", mimeType: "image/webp", sha1hash: "b".repeat(40), metadata: { dimensions: { width: 1600, height: 1000 } } },
  { _id: "media-b", _type: "media", privateOnly: true, image: { asset: { _ref: asset("b") } } },
];
async function run(query: string, params: Record<string, unknown>, documents: Record<string, unknown>[] = dataset) {
  return (await evaluate(parse(query, { params }), { dataset: documents, params })).get();
}
const stateParams = { id: "g1", draftId: "drafts.g1", termsId: "proofTerms.g1", versionsPath: "versions.*.g1" };
const relatedParams = { id: "g1", draftId: "drafts.g1", versionsPath: "versions.*.g1", handle, assetIds: [asset("a"), asset("b")] };

describe("proof publication query contract", () => {
  it("reads the draft, published gallery, private record identity and release versions", async () => {
    const result = await run(PUBLICATION_STATE_QUERY, stateParams);
    expect(result.draft._id).toBe("drafts.g1");
    expect(result.published._id).toBe("g1");
    expect(result.terms).toEqual({ _id: "proofTerms.g1", _rev: "t1", _type: "clientProofTerms", galleryId: "g1" });
    expect(result.versions).toBe(1);
    const none = await run(PUBLICATION_STATE_QUERY, stateParams, dataset.filter((doc) => !String(doc._id).includes("g1")));
    expect(none).toEqual({ draft: null, published: null, terms: null, versions: 0 });
  });
  it("finds a handle used elsewhere but never the gallery's own draft, published or release copies", async () => {
    expect((await run(PUBLICATION_RELATED_QUERY, relatedParams)).conflicts).toEqual([]);
    const clash = [...dataset, { _id: "legacy-x", _type: "legacyDeliveryGallery", handle }];
    expect((await run(PUBLICATION_RELATED_QUERY, relatedParams, clash)).conflicts).toEqual([{ _id: "legacy-x" }]);
  });
  it("projects measured asset metadata and private-only use", async () => {
    const assets = (await run(PUBLICATION_RELATED_QUERY, relatedParams)).assets as Record<string, unknown>[];
    expect(assets.find((entry) => entry._id === asset("a"))).toMatchObject({ width: 1600, height: 1000, restricted: false });
    expect(assets.find((entry) => entry._id === asset("b"))).toMatchObject({ restricted: true });
  });
});
