/**
 * A representative keyword archive with no real content (AB#73): about 8000 media under a
 * three-level hierarchy, broad parents down to narrow leaves, with popularity skewed so a root
 * matches thousands and a leaf a few dozen. Deterministic, so a failure reproduces.
 *
 * `assigned` is what an editor chose. The stored closure comes from the application's own
 * `expandKeywordIds`, and a test computes its expected result separately, with `ancestorsOf`.
 *
 * The `excluded` cohort holds every keyword, the newest capture dates and the newest edits, so a
 * leak surfaces at the top of the first page or in the cursor's scope. The `tied` cohort holds five
 * unrelated keywords, with long runs of one capture time and undated rows, so that a multi-keyword
 * selection has page boundaries inside a tie and among undated photographs.
 */
import { buildPublicKeywordTaxonomy, expandKeywordIds, type PublicKeywordTaxonomy } from "../src/lib/media-keywords";

export const ARCHIVE_MEDIA_COUNT = 8000;
export const TIED_KEYWORDS = ["ties-a", "ties-b", "ties-c", "ties-d", "ties-e"] as const;
/** Thirty at one time, twenty at another, then ten undated. */
const TIED_COHORT: readonly (string | null)[] = [
  ...Array.from({ length: 30 }, () => "2025-06-01T08:00:00Z"),
  ...Array.from({ length: 20 }, () => "2025-05-01T08:00:00Z"),
  ...Array.from({ length: 10 }, () => null),
];
export const ARCHIVE_PROJECT = { projectId: "zp7mbokg", dataset: "production", datasetVisibility: "public", apiVersion: "v2026-06-24" } as const;

type Document = Readonly<Record<string, unknown>>;

export type ArchiveKeyword = Readonly<{ keywordId: string; parent: string | null; category: string }>;
export type ArchiveMedia = Readonly<{ mediaId: string; capturedAt: string | null; assigned: readonly string[] }>;

/** A small seeded generator: the same sequence on every machine. */
function mulberry32(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

function buildKeywords(): readonly ArchiveKeyword[] {
  const keywords: ArchiveKeyword[] = [];
  for (const category of ["subject", "place", "season"]) {
    for (let root = 1; root <= 6; root += 1) {
      const rootId = `${category}-r${root}`;
      keywords.push({ keywordId: rootId, parent: null, category });
      for (let middle = 1; middle <= 5; middle += 1) {
        const middleId = `${rootId}-m${middle}`;
        keywords.push({ keywordId: middleId, parent: rootId, category });
        for (let leaf = 1; leaf <= 4; leaf += 1) keywords.push({ keywordId: `${middleId}-l${leaf}`, parent: middleId, category });
      }
    }
  }
  for (const keywordId of TIED_KEYWORDS) keywords.push({ keywordId, parent: null, category: "season" });
  return keywords;
}

export function ancestorsOf(keywordId: string, byId: ReadonlyMap<string, ArchiveKeyword>): readonly string[] {
  const chain: string[] = [];
  for (let current = byId.get(keywordId); current !== undefined; current = current.parent === null ? undefined : byId.get(current.parent)) chain.push(current.keywordId);
  return chain;
}


const assetId = (index: number) => pad(index, 40);
const DIMENSIONS = [[1600, 1067], [1067, 1600], [2048, 1152], [1200, 1200], [2048, 878]] as const;

function buildAssets(): readonly Document[] {
  return Array.from({ length: 40 }, (_, index) => {
    const [width, height] = DIMENSIONS[index % DIMENSIONS.length];
    const path = `images/${ARCHIVE_PROJECT.projectId}/${ARCHIVE_PROJECT.dataset}/${assetId(index)}-${width}x${height}.webp`;
    return { _id: `image-${assetId(index)}-${width}x${height}-webp`, _type: "sanity.imageAsset", url: `https://cdn.sanity.io/${path}`, path, extension: "webp", mimeType: "image/webp", metadata: { dimensions: { width, height } } };
  });
}

function mediaDocument(mediaId: string, capturedAt: string | null, closure: readonly string[], assets: readonly Document[], index: number, overrides: Document = {}): Document {
  return {
    _id: mediaId,
    _type: "media",
    _updatedAt: "2026-11-01T00:00:00Z",
    mediaId,
    mediaType: "image",
    publiclyRenderable: true,
    privateOnly: false,
    dynamicallyDiscoverable: true,
    ...(capturedAt === null ? {} : { capturedAt }),
    expandedKeywordIds: closure,
    // Every document holds what must stay private, because a page reading the wrong field has to show it here.
    internalKeywords: ["private-person"],
    importedKeywords: { dcSubject: ["A private term"] },
    keywordOverrides: { added: [] },
    archiveLocator: "A private location",
    alt: [{ language: "en", value: `Photograph ${index}` }, { language: "fi", value: `Valokuva ${index}` }],
    caption: [{ language: "en", value: `A caption of an ordinary length, the kind a photographer writes under photograph ${index}.` }, { language: "fi", value: `Tavallisen mittainen kuvateksti, jollaisen valokuvaaja kirjoittaa kuvan ${index} alle.` }],
    credit: "Credit Line",
    image: { asset: { _ref: assets[index % assets.length]._id } },
    ...overrides,
  };
}

export type KeywordArchive = Readonly<{
  keywords: readonly ArchiveKeyword[];
  byId: ReadonlyMap<string, ArchiveKeyword>;
  media: readonly ArchiveMedia[];
  excludedIds: readonly string[];
  /** Keywords, categories and state. Separate because the vocabulary query never reads media. */
  vocabularyDataset: readonly Document[];
  mediaDataset: readonly Document[];
}>;

export function buildKeywordArchive(): KeywordArchive {
  const random = mulberry32(73);
  const keywords = buildKeywords();
  const byId = new Map(keywords.map((keyword) => [keyword.keywordId, keyword]));
  const leaves = keywords.filter((keyword) => keyword.keywordId.includes("-l"));
  const taxonomy: PublicKeywordTaxonomy = buildPublicKeywordTaxonomy(keywords.map((keyword) => ({ keywordId: keyword.keywordId, title: keyword.keywordId, categorySlug: keyword.category, parentKeywordId: keyword.parent })));
  // Squaring skews the pick, so early keywords are common and late ones rare, as in a real archive.
  const pickLeaf = () => leaves[Math.floor(random() ** 2 * leaves.length)].keywordId;

  const media: ArchiveMedia[] = [];
  for (let index = 0; index < ARCHIVE_MEDIA_COUNT - TIED_COHORT.length; index += 1) {
    const assigned = [...new Set(Array.from({ length: 1 + Math.floor(random() * 6) }, pickLeaf))];
    // Four photographs share each second and every fiftieth is undated, so the tie-break does real work.
    const capturedAt = index % 50 === 0 ? null : new Date(Date.UTC(2026, 0, 1) - Math.floor(index / 4) * 60_000).toISOString().replace(".000Z", "Z");
    media.push({ mediaId: `archive-${pad(index, 5)}`, capturedAt, assigned });
  }
  TIED_COHORT.forEach((capturedAt, index) => media.push({ mediaId: `tied-${pad(index, 3)}`, capturedAt, assigned: TIED_KEYWORDS }));

  const assets = buildAssets();
  const everyKeyword = keywords.map((keyword) => keyword.keywordId).sort();
  const newest = "2030-01-01T00:00:00Z";
  const excluded: readonly [string, Document][] = [
    ["excluded-opted-out", { dynamicallyDiscoverable: false }],
    ["excluded-never-opted-in", { dynamicallyDiscoverable: undefined }],
    ["excluded-not-renderable", { publiclyRenderable: false }],
    ["excluded-private", { privateOnly: true }],
    ["excluded-video", { mediaType: "video" }],
  ];

  // Stored out of order: an adapter relying on dataset order would fail here, not in production.
  const shuffled = [...media];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other], shuffled[index]];
  }

  return {
    keywords,
    byId,
    media,
    excludedIds: excluded.map(([mediaId]) => mediaId),
    vocabularyDataset: [
      { _id: "keywordTaxonomyState", _type: "keywordTaxonomyState", taxonomyVersion: 4 },
      ...["subject", "place", "season"].map((slug) => ({ _id: `category-${slug}`, _type: "keywordCategory", slug })),
      ...keywords.map((keyword) => ({
        _id: `kw-${keyword.keywordId}`,
        _type: "keyword",
        keywordId: keyword.keywordId,
        status: "active",
        visibility: "public",
        title: [{ language: "en", value: `Name of ${keyword.keywordId}` }, { language: "fi", value: `Nimi ${keyword.keywordId}` }],
        category: { _ref: `category-${keyword.category}` },
        ...(keyword.parent === null ? {} : { parent: { _ref: `kw-${keyword.parent}` } }),
      })),
      // One of each, because the path rule and the visibility rule must each hold alone.
      { _id: "keyword.private-person", _type: "keyword", keywordId: "private-person", status: "active", visibility: "internal", title: [{ language: "en", value: "A private name" }], category: { _ref: "category-subject" } },
      { _id: "kw-private-plain-id", _type: "keyword", keywordId: "private-plain-id", status: "active", visibility: "internal", title: [{ language: "en", value: "Another private name" }], category: { _ref: "category-subject" } },
      { _id: "keyword.public-on-private-path", _type: "keyword", keywordId: "public-on-private-path", status: "active", visibility: "public", title: [{ language: "en", value: "A wrongly placed name" }], category: { _ref: "category-subject" } },
      { _id: "kw-old-name", _type: "keyword", keywordId: "old-name", status: "merged", visibility: "public", mergedInto: { _ref: "kw-subject-r1" }, title: [{ language: "en", value: "Old name" }], category: { _ref: "category-subject" } },
      { _id: "kw-retired-name", _type: "keyword", keywordId: "retired-name", status: "retired", visibility: "public", title: [{ language: "en", value: "Retired name" }], category: { _ref: "category-subject" } },
    ],
    mediaDataset: [
      ...assets,
      ...excluded.map(([mediaId, overrides], index) => mediaDocument(mediaId, newest, everyKeyword, assets, index, { _updatedAt: newest, ...overrides })),
      ...shuffled.map((item, index) => mediaDocument(item.mediaId, item.capturedAt, expandKeywordIds(item.assigned, taxonomy), assets, index)),
    ],
  };
}

/** What a selection must return, computed from the assignments and the hierarchy, in the public order. */
export function expectedMatches(archive: KeywordArchive, canonicalIds: readonly string[]): readonly string[] {
  return archive.media
    .filter((item) => {
      const holds = new Set(item.assigned.flatMap((keywordId) => ancestorsOf(keywordId, archive.byId)));
      return canonicalIds.every((keywordId) => holds.has(keywordId));
    })
    .sort((left, right) => {
      const a = left.capturedAt ?? "", b = right.capturedAt ?? "";
      if (a !== b) return a < b ? 1 : -1;
      return left.mediaId < right.mediaId ? -1 : 1;
    })
    .map((item) => item.mediaId);
}
