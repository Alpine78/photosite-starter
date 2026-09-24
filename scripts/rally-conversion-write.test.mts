import { describe, expect, it } from "vitest";

import {
  buildRallyConversionPlan,
  type ArtifactAsset,
  type ProductionGallery,
  type ProductionPlacement,
  type ProductionSnapshot,
} from "./rally-conversion-plan.mts";
import {
  buildGalleryDeletionAndSwitchBatches,
  buildMediaWaves,
  CONVERSION_MUTATION_BATCH_SIZE,
  evaluateConversionReadBack,
  publishedIdOf,
  reconcileRallyConversion,
  recomputeConversionPlanDigest,
  validateRallyConversionPlanContract,
  type CurrentGalleryState,
  type CurrentMediaState,
  type RallyConversionSnapshot,
} from "./rally-conversion-write.mts";
import { parseRallyManifest, type RallyManifest, type ScannedFile } from "./rally-import-plan.mts";
import { parseArguments } from "./write-rally-conversion.mts";

const CONTENT_ID = "rally-example-2021";
const GALLERY_FI = `migrated--gallery-${CONTENT_ID}-fi`;
const GALLERY_EN = `migrated--gallery-${CONTENT_ID}-en`;

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
const mediaDocIdOf = (n: number) => `migrated--media-${mediaIdOf(n)}`;

function file(n: number, section: "SS1" | "SS2"): ScannedFile {
  return {
    relativePath: `Rally_Example_2021_${String(n).padStart(4, "0")}_${section}.jpg`,
    contentHash: hash(n),
    format: "jpeg",
    width: 1600,
    height: 1067,
  };
}

function placement(language: string, n: number, order: number, sectionId: string): ProductionPlacement {
  return {
    _id: `placement-${language}-${order}`,
    placementId: `${CONTENT_ID}-p${order}`,
    order,
    sectionId,
    visible: true,
    pinned: false,
    altOverride: language === "fi" ? `kuva ${n}` : `photograph ${n}`,
    captionOverride: null,
    mediaDocumentId: mediaDocIdOf(n),
    mediaId: mediaIdOf(n),
    mediaAlt: [
      { _key: "alt-fi", language: "fi", value: `kuva ${n}` },
      { _key: "alt-en", language: "en", value: `photograph ${n}` },
    ],
    mediaCaption: null,
  };
}

const sections = [
  { sectionId: "category-1", slug: "ss-1", label: "SS 1" },
  { sectionId: "category-2", slug: "ss-2", label: "SS 2" },
];

function gallery(language: string): ProductionGallery {
  return {
    _id: `migrated--gallery-${CONTENT_ID}-${language}`,
    language,
    orderingRule: "manual",
    sections,
    placements: [
      placement(language, 1, 1, "category-1"),
      placement(language, 2, 2, "category-1"),
      placement(language, 3, 3, "category-2"),
    ],
  };
}

const artifacts: readonly ArtifactAsset[] = [1, 2, 3].map((n) => ({
  mediaId: mediaIdOf(n),
  contentHash: hash(n),
  sourceLocator: `stories/rally/${n}.jpg`,
}));

const files = [file(1, "SS1"), file(2, "SS1"), file(3, "SS2")];

/** A real conversion plan, built the way AB#169's planner produces one. */
function buildPlan() {
  const production: ProductionSnapshot = { galleries: [gallery("fi"), gallery("en")], placementsElsewhere: [] };
  const result = buildRallyConversionPlan({
    manifest: manifest(),
    files,
    artifacts,
    production,
    acceptInterleavedSections: false,
    acceptRemovedDuplicates: false,
    allowNewPhotographs: false,
    now: new Date("2026-09-24T00:00:00.000Z"),
    mintMediaId: () => "unused",
  });
  if (result.plan === undefined) throw new Error(`fixture plan blocked: ${result.blockers.join("; ")}`);
  return result.plan;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function setAt(root: unknown, keys: readonly (string | number)[], value: unknown): void {
  let node = root as Record<string | number, unknown>;
  for (const key of keys.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[keys.at(-1) as string | number] = value;
}

describe("validateRallyConversionPlanContract", () => {
  it("accepts exactly what the planner emits", () => {
    const plan = buildPlan();
    expect(validateRallyConversionPlanContract(clone(plan))).toEqual({ plan: clone(plan), issues: [] });
  });

  it("refuses a hand-edited plan", () => {
    const tamper = (edit: (plan: unknown) => void): readonly string[] => {
      const plan = clone(buildPlan());
      edit(plan);
      return validateRallyConversionPlanContract(plan).issues;
    };
    expect(tamper((plan) => setAt(plan, ["extra"], 1))).toContainEqual(expect.stringMatching(/unknown field "extra"/));
    expect(tamper((plan) => setAt(plan, ["version"], "rally-conversion-plan-v0"))).toContainEqual(expect.stringMatching(/version/));
    expect(tamper((plan) => setAt(plan, ["galleries", 0, "language"], (plan as { galleries: { language: string }[] }).galleries[1]?.language))).toContainEqual(
      expect.stringMatching(/repeats language/),
    );
    expect(tamper((plan) => setAt(plan, ["galleries", 0, "_id"], ""))).toContainEqual(expect.stringMatching(/has no _id/));
    // A sequence changed to another structurally valid number passes the contract
    // check untouched — it is `reconcileRallyConversion`, not the contract check,
    // that catches a value disagreeing with reality.
    expect(tamper((plan) => setAt(plan, ["mediaPatches", 0, "captureSequence", "sequence"], 99))).toEqual([]);
    expect(tamper((plan) => setAt(plan, ["mediaPatches", 0, "captureSequence", "sectionId"], "Category 9"))).toContainEqual(
      expect.stringMatching(/invalid captureSequence/),
    );
    expect(tamper((plan) => setAt(plan, ["mediaPatches", 0, "extra"], 1))).toContainEqual(
      expect.stringMatching(/unexpected field "extra"/),
    );
    expect(tamper((plan) => setAt(plan, ["placementDeletions", 0, "galleryId"], "not-a-planned-gallery"))).toContainEqual(
      expect.stringMatching(/placementDeletions\[0\] is malformed or names an unknown gallery/),
    );
  });

  it("recomputes the digest from content rather than trusting the field", () => {
    const plan = clone(buildPlan());
    expect(recomputeConversionPlanDigest(plan)).toBe(plan.conversionDigest);
    const edited = clone(plan);
    setAt(edited, ["mediaPatches", 0, "captureSequence", "sequence"], 2);
    expect(recomputeConversionPlanDigest({ ...edited, conversionDigest: "0".repeat(64) })).not.toBe(plan.conversionDigest);
  });
});

describe("publishedIdOf", () => {
  it("strips draft and release prefixes", () => {
    expect(publishedIdOf("drafts.a")).toBe("a");
    expect(publishedIdOf("versions.rabc.a")).toBe("a");
    expect(publishedIdOf("a")).toBe("a");
  });
});

function snapshotOf(plan: ReturnType<typeof buildPlan>, overrides: Partial<RallyConversionSnapshot> = {}): RallyConversionSnapshot {
  const galleries: CurrentGalleryState[] = plan.galleries.map((entry) => ({
    _id: entry._id,
    language: entry.language,
    orderingRule: "manual",
    placementIds: plan.placementDeletions.filter((deletion) => deletion.galleryId === entry._id).map((deletion) => deletion._id),
  }));
  const media: CurrentMediaState[] = plan.mediaPatches.map((patch) => ({ _id: patch._id, mediaId: patch.mediaId }));
  return { galleries, media, unpublishedCopyIds: [], ...overrides };
}

describe("reconcileRallyConversion", () => {
  it("on a fully untouched gallery, everything remains and no gallery is ready without its deletions", () => {
    const plan = buildPlan();
    const { work, conflicts } = reconcileRallyConversion(plan, snapshotOf(plan));
    expect(conflicts).toEqual([]);
    expect(work.mediaPatchesRemaining).toEqual(plan.mediaPatches);
    expect(work.newMediaRemaining).toEqual([]);
    expect([...work.deletionsRemainingByGallery.keys()].toSorted()).toEqual([GALLERY_EN, GALLERY_FI]);
    expect(work.deletionsRemainingByGallery.get(GALLERY_FI)).toHaveLength(3);
    expect(work.galleriesToSwitch).toEqual(new Set([GALLERY_FI, GALLERY_EN]));
  });

  it("recognizes a resumed partial run: applied patches and deleted placements are not redone", () => {
    const plan = buildPlan();
    const media: CurrentMediaState[] = plan.mediaPatches.map((patch, index) =>
      index === 0 ? { _id: patch._id, mediaId: patch.mediaId, captureSequence: patch.captureSequence } : { _id: patch._id, mediaId: patch.mediaId },
    );
    const fiDeletionsAllDone = plan.placementDeletions.filter((deletion) => deletion.galleryId === GALLERY_FI);
    const galleries: CurrentGalleryState[] = [
      { _id: GALLERY_FI, language: "fi", orderingRule: "capture-sequence", placementIds: [] },
      {
        _id: GALLERY_EN,
        language: "en",
        orderingRule: "manual",
        placementIds: plan.placementDeletions.filter((deletion) => deletion.galleryId === GALLERY_EN).map((deletion) => deletion._id),
      },
    ];
    const { work, conflicts } = reconcileRallyConversion(plan, { galleries, media, unpublishedCopyIds: [] });
    expect(conflicts).toEqual([]);
    // The already-patched photograph is not in the remaining set.
    expect(work.mediaPatchesRemaining.map((patch) => patch.mediaId)).not.toContain(plan.mediaPatches[0]?.mediaId);
    expect(work.mediaPatchesRemaining).toHaveLength(plan.mediaPatches.length - 1);
    // fi is fully done (switched, zero placements): no deletion entry, not in galleriesToSwitch.
    expect(work.deletionsRemainingByGallery.has(GALLERY_FI)).toBe(false);
    expect(work.galleriesToSwitch.has(GALLERY_FI)).toBe(false);
    // en still has all its work.
    expect(work.deletionsRemainingByGallery.get(GALLERY_EN)).toHaveLength(fiDeletionsAllDone.length);
    expect(work.galleriesToSwitch.has(GALLERY_EN)).toBe(true);
  });

  it("reports nothing remaining once every gallery is fully converted", () => {
    const plan = buildPlan();
    const media: CurrentMediaState[] = plan.mediaPatches.map((patch) => ({ _id: patch._id, mediaId: patch.mediaId, captureSequence: patch.captureSequence }));
    const galleries: CurrentGalleryState[] = plan.galleries.map((entry) => ({
      _id: entry._id,
      language: entry.language,
      orderingRule: "capture-sequence",
      placementIds: [],
    }));
    const { work, conflicts } = reconcileRallyConversion(plan, { galleries, media, unpublishedCopyIds: [] });
    expect(conflicts).toEqual([]);
    expect(work.mediaPatchesRemaining).toEqual([]);
    expect(work.deletionsRemainingByGallery.size).toBe(0);
    expect(work.galleriesToSwitch.size).toBe(0);
  });

  it("refuses on an unpublished draft, a missing document, a disagreeing capture, and an unexpected placement", () => {
    const plan = buildPlan();
    expect(reconcileRallyConversion(plan, snapshotOf(plan, { unpublishedCopyIds: [plan.mediaPatches[0]?.mediaId as string] })).conflicts).toContainEqual(
      expect.stringMatching(/unpublished draft or release/),
    );
    const base = snapshotOf(plan);
    const missingGallery: RallyConversionSnapshot = { ...base, galleries: base.galleries.filter((g) => g._id !== GALLERY_EN) };
    expect(reconcileRallyConversion(plan, missingGallery).conflicts).toContainEqual(expect.stringMatching(`${GALLERY_EN} no longer exists`));

    const wrongCapture: RallyConversionSnapshot = {
      ...base,
      media: base.media.map((m) =>
        m.mediaId === plan.mediaPatches[0]?.mediaId
          ? { ...m, captureSequence: { galleryContentId: "another-rally", sequence: 1, sectionId: "x" } }
          : m,
      ),
    };
    expect(reconcileRallyConversion(plan, wrongCapture).conflicts).toContainEqual(
      expect.stringMatching(/belongs to a different capture-sequence gallery \(another-rally\)/),
    );

    const unexpected: RallyConversionSnapshot = {
      ...base,
      galleries: base.galleries.map((g) =>
        g._id === GALLERY_FI ? { ...g, placementIds: [...g.placementIds, "surprise-placement"] } : g,
      ),
    };
    expect(reconcileRallyConversion(plan, unexpected).conflicts).toContainEqual(
      expect.stringMatching(/1 placement\(s\) this plan did not expect/),
    );
  });

  it("refuses when a gallery is neither manual nor already capture-sequence", () => {
    const plan = buildPlan();
    const base = snapshotOf(plan);
    const snapshot: RallyConversionSnapshot = {
      ...base,
      galleries: base.galleries.map((g) => (g._id === GALLERY_FI ? { ...g, orderingRule: "seeded-random" } : g)),
    };
    expect(reconcileRallyConversion(plan, snapshot).conflicts).toContainEqual(expect.stringMatching(/is now seeded-random/));
  });
});

describe("buildMediaWaves", () => {
  it("patches captureSequence and any moved caption, batched", () => {
    const plan = buildPlan();
    const { work } = reconcileRallyConversion(plan, snapshotOf(plan));
    const { patchBatches, newMediaBatches } = buildMediaWaves(work, new Map());
    expect(newMediaBatches).toEqual([]);
    expect(patchBatches.flat()).toEqual(
      plan.mediaPatches.map((patch) => ({
        patch: {
          id: patch._id,
          set: { captureSequence: patch.captureSequence, ...(patch.caption === undefined ? {} : { caption: patch.caption }) },
        },
      })),
    );
  });

  it("throws rather than write a new document with no uploaded asset", () => {
    const work = {
      mediaPatchesRemaining: [],
      newMediaRemaining: [{ _id: "x", _type: "media", mediaId: "m" } as never],
      deletionsRemainingByGallery: new Map(),
      galleriesToSwitch: new Set<string>(),
    };
    expect(() => buildMediaWaves(work, new Map())).toThrow(/no uploaded asset/);
  });
});

describe("buildGalleryDeletionAndSwitchBatches", () => {
  it("appends the switch to the last deletion batch, never a batch over the mutation cap", () => {
    const ids = Array.from({ length: CONVERSION_MUTATION_BATCH_SIZE + 5 }, (_u, i) => `p${i}`);
    const batches = buildGalleryDeletionAndSwitchBatches("gallery-fi", ids, true);
    for (const batch of batches) expect(batch.length).toBeLessThanOrEqual(CONVERSION_MUTATION_BATCH_SIZE);
    const flat = batches.flat();
    expect(flat.filter((m) => "delete" in m)).toHaveLength(ids.length);
    const switches = flat.filter((m) => "patch" in m);
    expect(switches).toHaveLength(1);
    expect(switches[0]).toEqual({ patch: { id: "gallery-fi", set: { orderingRule: "capture-sequence" } } });
    // The switch is in the very last batch, together with that batch's own deletions.
    expect(batches.at(-1)).toContainEqual(switches[0]);
  });

  it("sends a standalone switch when there is nothing left to delete", () => {
    expect(buildGalleryDeletionAndSwitchBatches("gallery-fi", [], true)).toEqual([
      [{ patch: { id: "gallery-fi", set: { orderingRule: "capture-sequence" } } }],
    ]);
  });

  it("sends deletion-only batches, at the full cap, when no switch is needed", () => {
    const ids = Array.from({ length: CONVERSION_MUTATION_BATCH_SIZE + 1 }, (_u, i) => `p${i}`);
    const batches = buildGalleryDeletionAndSwitchBatches("gallery-fi", ids, false);
    expect(batches[0]).toHaveLength(CONVERSION_MUTATION_BATCH_SIZE);
    expect(batches[1]).toHaveLength(1);
    expect(batches.flat().every((m) => "delete" in m)).toBe(true);
  });

  it("sends nothing when there is no deletion and no switch", () => {
    expect(buildGalleryDeletionAndSwitchBatches("gallery-fi", [], false)).toEqual([]);
  });
});

describe("evaluateConversionReadBack", () => {
  it("agrees with a complete conversion and names each disagreement", () => {
    const plan = buildPlan();
    expect(
      evaluateConversionReadBack(plan, {
        galleries: plan.galleries.map((g) => ({ _id: g._id, orderingRule: "capture-sequence" })),
        remainingPlacementCount: 0,
        memberMediaCount: plan.mediaPatches.length + plan.newMediaDocuments.length,
      }),
    ).toEqual([]);
    expect(
      evaluateConversionReadBack(plan, {
        galleries: [{ _id: GALLERY_FI, orderingRule: "manual" }],
        remainingPlacementCount: 2,
        memberMediaCount: 1,
      }),
    ).toEqual([
      expect.stringMatching(`${GALLERY_EN} was not found`),
      expect.stringMatching(`${GALLERY_FI} is not ordered by capture sequence`),
      expect.stringMatching(/2 placement\(s\) still reference/),
      expect.stringMatching(/has 1 photograph\(s\) after the write, the plan has 3/),
    ]);
  });
});

describe("parseArguments", () => {
  const base = [
    "--plan", "p.json", "--folder", "/r", "--out", "/o",
    "--approved-digest", "a".repeat(64), "--backup-archive", "/backup.tar.gz",
  ];

  it("requires every path, the digest, and the backup archive; defaults the max age", () => {
    expect(parseArguments(base)).toMatchObject({ apply: false, backupArchive: "/backup.tar.gz", backupMaxAgeHours: 24 });
    expect(parseArguments([...base, "--yes"]).apply).toBe(true);
    expect(parseArguments([...base, "--backup-max-age-hours", "6"]).backupMaxAgeHours).toBe(6);
    expect(() => parseArguments(base.slice(0, 6))).toThrow(/--approved-digest/);
    expect(() => parseArguments(base.slice(0, 8))).toThrow(/--backup-archive/);
    expect(() => parseArguments([...base, "--backup-max-age-hours", "0"])).toThrow(/positive number/);
    expect(() => parseArguments([...base, "--token", "x"])).toThrow(/unknown option/);
  });
});
