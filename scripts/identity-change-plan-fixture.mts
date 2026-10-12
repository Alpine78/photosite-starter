/** Synthetic local data for AB#259 tests; no owner content. */
import { digest } from "./identity-retirement-reconciliation.mts";

export const encode = (value: unknown) => Buffer.from(JSON.stringify(value));
export const ndjson = (documents: unknown[]) => Buffer.from(documents.map(doc => JSON.stringify(doc)).join("\n") + "\n");
export function fixture() {
  const mapping = [
    { field: "categoryId", oldId: "joomla-category-1", newId: "category-trips" },
    { field: "contentId", oldId: "joomla-content-1", newId: "article-coast" },
    { field: "endGalleryId", oldId: "joomla-end-1", newId: "article-coast-end" },
    { field: "contentId", oldId: "joomla-content-2", newId: "gallery-coast" },
    { field: "placementId", oldId: "joomla-content-1-0001", newId: "article-coast-image-0001" },
  ];
  const documents: (Record<string, unknown> & { _id: string; _rev: string; _type: string })[] = [
    { _id: "category", _rev: "r1", _type: "category", categoryId: "joomla-category-1", _key: "tree", label: null },
    ...["fi", "en"].map(language => ({ _id: `article-${language}`, _rev: "r1", _type: "article", contentId: "joomla-content-1", endGalleryId: "joomla-end-1", language, slug: { current: "coast" }, canonicalCategory: { _ref: "category" }, order: 1 })),
    ...["fi", "en"].map(language => ({ _id: `gallery-${language}`, _rev: "r1", _type: "gallery", contentId: "joomla-content-2", language })),
    ...["fi", "en"].map(language => ({ _id: `placement-${language}`, _rev: "r1", _type: "articleEndGalleryPlacement", placementId: "joomla-content-1-0001", article: { _ref: `article-${language}` }, media: { _ref: "media" }, language, order: 1 })),
    { _id: "settings", _rev: "r1", _type: "siteSettings", featuredGalleryId: "joomla-content-2" },
    { _id: "drafts.unrelated-settings", _rev: "r1", _type: "siteSettings", label: "Unrelated draft" },
    { _id: "media", _rev: "r1", _type: "media", mediaId: "coast", width: 1536, height: 1024 },
  ];
  const changes = () => documents.flatMap(doc => {
    const fields = Object.fromEntries(mapping.filter(row => doc[row.field] === row.oldId || (doc._type === "siteSettings" && row.field === "contentId" && doc.featuredGalleryId === row.oldId))
      .map(row => [doc._type === "siteSettings" ? "featuredGalleryId" : row.field, { before: row.oldId, after: row.newId }]));
    return Object.keys(fields).length ? [{ documentId: doc._id, expectedRevision: doc._rev, fields }] : [];
  });
  const makeInput = () => {
    const baseline = ndjson(documents), proposedChanges = changes();
    const map = encode({ version: "ab257-private-proposal-v1", writable: false, snapshotSha256: digest(baseline), mapping, proposedChanges });
    const approval = encode({ candidateFileSha256: digest(map), snapshotFileSha256: digest(baseline), productionWriteApproved: false,
      acceptedScope: { retainSanityDocumentIds: true, retainSanityReferences: true, contentId: 2, categoryId: 1, endGalleryId: 1, placementId: 1, totalDomainIdentities: 5,
        documents: proposedChanges.length, fieldChanges: proposedChanges.reduce((sum, row) => sum + Object.keys(row.fields).length, 0) } });
    return { map, approval, baseline, snapshot: baseline, approvedDigest: digest(map) };
  };
  return { documents, mapping, makeInput };
}
