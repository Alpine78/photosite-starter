/** Synthetic offline fixtures, never production source records. */
import { digest } from "./identity-retirement-reconciliation.mts";
export function adoptionFixture() {
  const reference = (_ref: string) => ({ _type: "reference", _ref });
  const documents: Record<string, unknown>[] = [
    { _id: "article-fi", _type: "article", _rev: "a1", contentId: "image-notes", language: "fi", endGalleryId: "image-notes-end", body: [{ _type: "block", text: "Unchanged prose" }], canonicalCategory: reference("category-one") },
    { _id: "article-en", _type: "article", _rev: "a2", contentId: "image-notes", language: "en", endGalleryId: "image-notes-end" },
    { _id: "placement-a", _type: "articleEndGalleryPlacement", _rev: "p1", article: reference("article-fi"), placementId: "occurrence-a", order: 0, visible: true, media: reference("media-one"), captionOverride: "Unchanged caption" },
    { _id: "placement-b", _type: "articleEndGalleryPlacement", _rev: "p2", article: reference("article-fi"), placementId: "occurrence-b", order: 1, visible: true, media: reference("media-one") },
    { _id: "placement-hidden", _type: "articleEndGalleryPlacement", _rev: "p3", article: reference("article-fi"), placementId: "occurrence-hidden", order: 2, visible: false, media: reference("media-one") },
    { _id: "peer-a", _type: "articleEndGalleryPlacement", _rev: "p4", article: reference("article-en"), placementId: "occurrence-a", order: 0, visible: true, media: reference("media-one") },
    { _id: "media-one", _type: "media", _rev: "m1", mediaId: "photograph-one", mediaType: "image", publiclyRenderable: true, image: { _type: "image", asset: reference("image-fixture-1200x800-webp") } },
    { _id: "image-fixture-1200x800-webp", _type: "sanity.imageAsset", _rev: "i1", metadata: { dimensions: { width: 1200, height: 800 } } },
    { _id: "category-one", _type: "category", _rev: "c1", categoryId: "notes" },
  ];
  const manifest = {
    format: "article-end-adoption-intent-v1", snapshot: { sha256: "", documentCount: 0, observedAt: "2026-01-01T00:00:00.000Z" },
    article: { documentId: "article-fi", expectedRevision: "a1", contentId: "image-notes", language: "fi", endGalleryId: "image-notes-end" },
    sourceEvidenceSha256: "e".repeat(64), heading: "Kuvien teemat",
    sections: [{ sectionId: "soft", slug: "pehmea-valo", label: "Pehmeä valo" }, { sectionId: "texture", slug: "pinnat", label: "Pinnat" }, { sectionId: "empty", slug: "tyhja", label: "Tyhjä" }],
    members: ["a", "b"].map((suffix, i) => ({ sourceItemId: `source-${suffix}`, sourceImageSha256: "f".repeat(64), documentId: `placement-${suffix}`, expectedRevision: `p${i + 1}`, placementId: `occurrence-${suffix}`, mediaDocumentId: "media-one", mediaRevision: "m1", mediaId: "photograph-one", assetRef: "image-fixture-1200x800-webp", sectionId: i ? "texture" : "soft" })),
  };
  return { documents, manifest, input() {
    const snapshot = Buffer.from(documents.map(d => JSON.stringify(d)).join("\n") + "\n");
    manifest.snapshot.sha256 = digest(snapshot); manifest.snapshot.documentCount = documents.length;
    return { snapshot, manifest: Buffer.from(JSON.stringify(manifest)) };
  } };
}
