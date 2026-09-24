import { describe, expect, it } from "vitest";

import { collectArtifactAssets, parseArguments } from "./plan-rally-conversion.mts";
import {
  buildRallyConversionPlan,
  stayingInPlace,
  type ArtifactAsset,
  type ProductionGallery,
  type ProductionPlacement,
  type ProductionSnapshot,
} from "./rally-conversion-plan.mts";
import { parseRallyManifest, type RallyManifest, type ScannedFile } from "./rally-import-plan.mts";
import { runPublicReadQuery } from "./sanity-read-http.mts";

const CONTENT_ID = "rally-example-2021";

const manifestJson = {
  version: 1,
  contentId: CONTENT_ID,
  filePrefix: "Rally_Example_2021",
  canonicalCategory: "joomla-category-147",
  eventDate: "2021-10-01",
  title: { fi: "Rally Example 2021", en: "Rally Example 2021" },
  slug: { fi: "rally-example-2021", en: "rally-example-2021" },
  sections: [
    { key: "SS1", sectionId: "category-1", slug: "ss-1", label: { fi: "EK 1", en: "SS 1" } },
    { key: "SS2", sectionId: "category-2", slug: "ss-2", label: { fi: "EK 2", en: "SS 2" } },
  ],
};

function manifest(overrides: Record<string, unknown> = {}): RallyManifest {
  const result = parseRallyManifest({ ...manifestJson, ...overrides });
  if (result.manifest === undefined) throw new Error(result.issues.join("; "));
  return result.manifest;
}

const hash = (n: number) => n.toString(16).padStart(64, "0");
const mediaIdOf = (n: number) => `${CONTENT_ID}-m${n}`;

function file(n: number, section: "SS1" | "SS2", contentHash = hash(n)): ScannedFile {
  return {
    relativePath: `Rally_Example_2021_${String(n).padStart(4, "0")}_${section}.jpg`,
    contentHash,
    format: "jpeg",
    width: 1600,
    height: 1067,
  };
}

function placement(
  language: string,
  n: number,
  order: number,
  sectionId: string,
  overrides: Partial<ProductionPlacement> = {},
): ProductionPlacement {
  return {
    _id: `placement-${language}-${order}`,
    placementId: `${CONTENT_ID}-p${order}`,
    order,
    sectionId,
    visible: true,
    pinned: false,
    altOverride: language === "fi" ? `kuva ${n}` : `photograph ${n}`,
    captionOverride: null,
    mediaDocumentId: `migrated--media-${mediaIdOf(n)}`,
    mediaId: mediaIdOf(n),
    mediaAlt: [
      { _key: "alt-fi", language: "fi", value: `kuva ${n}` },
      { _key: "alt-en", language: "en", value: `photograph ${n}` },
    ],
    mediaCaption: null,
    ...overrides,
  };
}

const sections = [
  { sectionId: "category-1", slug: "ss-1", label: "SS 1" },
  { sectionId: "category-2", slug: "ss-2", label: "SS 2" },
];

/** Photographs 1–4, placed in order 1..4, 1–2 in SS1 and 3–4 in SS2, in both languages. */
function gallery(
  language: string,
  placements?: readonly ProductionPlacement[],
  overrides: Partial<ProductionGallery> = {},
): ProductionGallery {
  return {
    _id: `migrated--gallery-${CONTENT_ID}-${language}`,
    language,
    orderingRule: "manual",
    sections,
    placements: placements ?? [
      placement(language, 1, 1, "category-1"),
      placement(language, 2, 2, "category-1"),
      placement(language, 3, 3, "category-2"),
      placement(language, 4, 4, "category-2"),
    ],
    ...overrides,
  };
}

const artifacts: readonly ArtifactAsset[] = [1, 2, 3, 4, 5].map((n) => ({
  mediaId: mediaIdOf(n),
  contentHash: hash(n),
  sourceLocator: `stories/rally/${n}.jpg`,
}));

const files = [file(1, "SS1"), file(2, "SS1"), file(3, "SS2"), file(4, "SS2")];

function convert(options: {
  readonly files?: readonly ScannedFile[];
  readonly production?: ProductionSnapshot;
  readonly manifest?: RallyManifest;
  readonly acceptRemovedDuplicates?: boolean;
  readonly allowNewPhotographs?: boolean;
} = {}) {
  let minted = 0;
  return buildRallyConversionPlan({
    manifest: options.manifest ?? manifest(),
    files: options.files ?? files,
    artifacts,
    production: options.production ?? { galleries: [gallery("fi"), gallery("en")], placementsElsewhere: [] },
    acceptInterleavedSections: false,
    acceptRemovedDuplicates: options.acceptRemovedDuplicates ?? false,
    allowNewPhotographs: options.allowNewPhotographs ?? false,
    now: new Date("2026-09-23T00:00:00.000Z"),
    mintMediaId: (contentId) => `${contentId}-new${(minted += 1)}`,
  });
}

describe("stayingInPlace", () => {
  it("keeps the longest already-ordered run so one moved photograph is reported once", () => {
    expect([...stayingInPlace([0, 1, 2, 3])].toSorted()).toEqual([0, 1, 2, 3]);
    // The photograph now last (index 3 in the new order) was first.
    expect([...stayingInPlace([3, 0, 1, 2])].toSorted()).toEqual([1, 2, 3]);
    expect(stayingInPlace([]).size).toBe(0);
  });
});

describe("buildRallyConversionPlan", () => {
  it("converts an unchanged gallery with no deviations, keeping identities and document ids", () => {
    const result = convert();
    expect(result.blockers).toEqual([]);
    expect(result.deviations).toEqual([]);
    expect(result.counts).toMatchObject({
      photographs: 4,
      existing: 4,
      added: 0,
      placementsDeleted: 8,
      moved: 0,
      redundantAltOverrides: 8,
      captionsMoved: 0,
    });
    expect(result.plan?.mediaPatches[0]).toEqual({
      _id: `migrated--media-${mediaIdOf(1)}`,
      mediaId: mediaIdOf(1),
      captureSequence: { galleryContentId: CONTENT_ID, sequence: 1, sectionId: "category-1" },
    });
    expect(result.plan?.galleries.map((entry) => entry.language)).toEqual(["en", "fi"]);
    expect(result.plan?.newMediaDocuments).toEqual([]);
    expect(result.plan?.conversionDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("reports a photograph whose position changes", () => {
    // Photograph 4 was placed first; its file number puts it last.
    const production = {
      galleries: ["fi", "en"].map((language) =>
        gallery(language, [
          placement(language, 4, 1, "category-2"),
          placement(language, 1, 2, "category-1"),
          placement(language, 2, 3, "category-1"),
          placement(language, 3, 4, "category-2"),
        ]),
      ),
      placementsElsewhere: [],
    };
    const result = convert({ production });
    expect(result.deviations).toEqual([
      expect.objectContaining({ mediaId: mediaIdOf(4), reason: "moved", currentPositions: [1], newPosition: 4 }),
    ]);
    expect(result.counts.moved).toBe(1);
  });

  it("blocks a photograph placed twice until the owner accepts removing the duplicate", () => {
    const withDuplicate = (language: string) =>
      gallery(language, [
        placement(language, 1, 1, "category-1"),
        placement(language, 2, 2, "category-1"),
        placement(language, 3, 3, "category-2"),
        placement(language, 1, 4, "category-2"),
        placement(language, 4, 5, "category-2"),
      ]);
    const production = { galleries: [withDuplicate("fi"), withDuplicate("en")], placementsElsewhere: [] };
    const blocked = convert({ production });
    expect(blocked.plan).toBeUndefined();
    expect(blocked.blockers).toContainEqual(expect.stringMatching(/placed twice/));
    const accepted = convert({ production, acceptRemovedDuplicates: true });
    expect(accepted.plan?.acceptedRemovedDuplicates).toBe(true);
    expect(accepted.deviations).toContainEqual(
      expect.objectContaining({ mediaId: mediaIdOf(1), reason: "duplicate-removed", currentPositions: [1, 4] }),
    );
    expect(accepted.plan?.placementDeletions).toHaveLength(10);
  });

  it("does not block on the overrides of a duplicate the folder places in another section, but still blocks a kept one", () => {
    const withDuplicate = (language: string, keptAlt: string | null) =>
      gallery(language, [
        placement(language, 1, 1, "category-1", keptAlt === null ? {} : { altOverride: keptAlt }),
        placement(language, 2, 2, "category-1"),
        placement(language, 3, 3, "category-2"),
        placement(language, 1, 4, "category-2", { altOverride: "another stage, photograph 1" }),
        placement(language, 4, 5, "category-2"),
      ]);
    const production = (keptAlt: string | null) => ({
      galleries: [withDuplicate("fi", keptAlt), withDuplicate("en", keptAlt)],
      placementsElsewhere: [],
    });
    // The folder keeps photograph 1 in SS1 (its first placement); the SS2 copy and its alt text go away.
    const kept = convert({ production: production(null), acceptRemovedDuplicates: true });
    expect(kept.blockers).toEqual([]);
    expect(kept.plan?.placementDeletions).toHaveLength(10);
    // A differing alt text on the placement that survives is still refused.
    const lost = convert({ production: production("a hand-written alt"), acceptRemovedDuplicates: true });
    expect(lost.blockers).toContainEqual(expect.stringMatching(/^placements whose own alt text differs.*: 2 \(/u));
  });

  it("adds new photographs only with explicit permission", () => {
    const withNew = [...files, file(9, "SS2", hash(999))];
    expect(convert({ files: withNew }).blockers).toContainEqual(expect.stringMatching(/--allow-new-photographs/));
    const allowed = convert({ files: withNew, allowNewPhotographs: true });
    expect(allowed.plan?.newMediaDocuments).toHaveLength(1);
    expect(allowed.plan?.newMediaDocuments[0]).toMatchObject({
      _id: `rally--media-${CONTENT_ID}-new1`,
      captureSequence: { sequence: 9, sectionId: "category-2" },
    });
    expect(allowed.plan?.newAssetRequirements).toHaveLength(1);
    expect(allowed.deviations).toContainEqual(expect.objectContaining({ reason: "added", newPosition: 5 }));
  });

  it("blocks a published photograph whose file is missing from the folder", () => {
    const result = convert({ files: files.slice(0, 3) });
    expect(result.plan).toBeUndefined();
    expect(result.blockers).toContainEqual(expect.stringMatching(/m4 .* not in the folder/));
  });

  it("moves a placement caption onto the photograph when the photograph has none", () => {
    const production = {
      galleries: ["fi", "en"].map((language) =>
        gallery(language, [
          placement(language, 1, 1, "category-1", { captionOverride: language === "fi" ? "Hyppy" : "Jump" }),
          placement(language, 2, 2, "category-1"),
          placement(language, 3, 3, "category-2"),
          placement(language, 4, 4, "category-2"),
        ]),
      ),
      placementsElsewhere: [],
    };
    const result = convert({ production });
    expect(result.blockers).toEqual([]);
    expect(result.counts.captionsMoved).toBe(2);
    expect(result.plan?.mediaPatches[0]?.caption).toEqual([
      { _key: "caption-en", _type: "localizedText", language: "en", value: "Jump" },
      { _key: "caption-fi", _type: "localizedText", language: "fi", value: "Hyppy" },
    ]);
    expect(result.plan?.mediaPatches[1]).not.toHaveProperty("caption");
  });

  it("blocks what a conversion would lose, one summarized line per kind", () => {
    const production = {
      galleries: ["fi", "en"].map((language) =>
        gallery(language, [
          placement(language, 1, 1, "category-1", { visible: false }),
          placement(language, 2, 2, "category-1", { altOverride: "something else" }),
          placement(language, 3, 3, "category-2", {
            captionOverride: "New",
            mediaCaption: [{ _key: "c", language, value: "Old" }],
          }),
          placement(language, 4, 4, "category-2", { mediaCaptureGallery: "another-rally" }),
        ]),
      ),
      placementsElsewhere: [],
    };
    const result = convert({ production });
    expect(result.plan).toBeUndefined();
    expect(result.blockers).toEqual([
      expect.stringMatching(/^hidden placements.*: 2 \(/u),
      expect.stringMatching(/^photographs already in another capture-sequence gallery: 1 \(.*another-rally\)/u),
      expect.stringMatching(/^placements whose own alt text differs.*: 2 \(/u),
      expect.stringMatching(/^placement captions that conflict.*: 2 \(/u),
    ]);
  });

  it("blocks sections that disagree between languages or with rally.json, and a gallery that is not manual", () => {
    const fiSections = gallery("fi");
    const enMoved = gallery("en", [
      placement("en", 1, 1, "category-2"),
      placement("en", 2, 2, "category-1"),
      placement("en", 3, 3, "category-2"),
      placement("en", 4, 4, "category-2"),
    ]);
    expect(convert({ production: { galleries: [fiSections, enMoved], placementsElsewhere: [] } }).blockers).toContainEqual(
      expect.stringMatching(/m1 sits in different sections in the fi gallery than in the en one/),
    );
    const renamed = manifest({
      sections: [
        { key: "SS1", sectionId: "category-1", slug: "ss-one", label: { fi: "EK 1", en: "SS 1" } },
        { key: "SS2", sectionId: "category-9", label: { fi: "EK 2", en: "SS 2" } },
      ],
    });
    const sectionBlockers = convert({ manifest: renamed }).blockers;
    expect(sectionBlockers).toContainEqual(expect.stringMatching(/\?section=ss-1 to \?section=ss-one/));
    expect(sectionBlockers).toContainEqual(expect.stringMatching(/"category-9", which the fi gallery does not have/));
    const seeded = { galleries: [gallery("fi", undefined, { orderingRule: "seeded-random" }), gallery("en")], placementsElsewhere: [] };
    expect(convert({ production: seeded }).blockers).toContainEqual(expect.stringMatching(/fi gallery is seeded-random/));
  });

  it("reports use in other galleries without blocking", () => {
    const result = convert({
      production: {
        galleries: [gallery("fi"), gallery("en")],
        placementsElsewhere: [
          { mediaId: mediaIdOf(2), galleryContentId: "rally-finland-2001-2019" },
          { mediaId: mediaIdOf(2), galleryContentId: "rally-finland-2001-2019" },
        ],
      },
    });
    expect(result.blockers).toEqual([]);
    expect(result.reusedElsewhere).toEqual([{ mediaId: mediaIdOf(2), galleries: ["rally-finland-2001-2019"] }]);
  });

  it("warns about a declared section that will be empty", () => {
    const result = convert({ files: [file(1, "SS1"), file(2, "SS1")], allowNewPhotographs: true });
    expect(result.warnings).toContainEqual(expect.stringMatching(/"SS 2" \(category-2\) will have no photographs/));
  });
});

describe("collectArtifactAssets", () => {
  it("reads assetRequirements from any artifact and ignores everything else", () => {
    expect(
      collectArtifactAssets([
        { assetRequirements: [{ mediaId: "a", contentHash: "ABC", sourceLocator: "x.jpg", extra: 1 }] },
        { assetRequirements: [{ mediaId: "b" }] },
        { documents: [] },
        null,
      ]),
    ).toEqual([{ mediaId: "a", contentHash: "abc", sourceLocator: "x.jpg" }]);
  });
});

describe("parseArguments", () => {
  it("requires the gallery, folders, and artifacts, and knows its three permissions", () => {
    const options = parseArguments([
      "--gallery", "rally-estonia-2023", "--folder", "/r", "--artifacts", "/a", "--out", "/o",
      "--allow-new-photographs", "--accept-removed-duplicates",
    ]);
    expect(options).toMatchObject({
      gallery: "rally-estonia-2023",
      allowNewPhotographs: true,
      acceptRemovedDuplicates: true,
      acceptInterleavedSections: false,
    });
    expect(() => parseArguments(["--folder", "/r", "--artifacts", "/a", "--out", "/o"])).toThrow(/--gallery/);
    expect(() => parseArguments(["--gallery", "g", "--folder", "/r", "--artifacts", "/a", "--out", "/r/x"])).toThrow(/outside/);
    expect(() => parseArguments(["--gallery", "g", "--folder", "/r", "--artifacts", "/a", "--out", "/o", "--yes"])).toThrow(/unknown option/);
  });
});

describe("runPublicReadQuery", () => {
  it("sends no credential and always asks for the published perspective", async () => {
    const seen: { url: string; headers: Record<string, string> }[] = [];
    const fetchImplementation = (async (url: string, init: RequestInit) => {
      seen.push({ url, headers: init.headers as Record<string, string> });
      return new Response(JSON.stringify({ result: [] }), { status: 200 });
    }) as unknown as typeof fetch;
    const result = await runPublicReadQuery(
      { projectId: "zp7mbokg", dataset: "production", apiVersion: "v2025-02-19" },
      { query: "*[_type == $type]", params: { type: "gallery" } },
      { fetchImplementation },
    );
    expect(result).toEqual([]);
    expect(seen[0]?.headers).not.toHaveProperty("Authorization");
    expect(seen[0]?.url).toContain("perspective=published");
    expect(seen[0]?.url).toContain("%24type=%22gallery%22");
  });
});
