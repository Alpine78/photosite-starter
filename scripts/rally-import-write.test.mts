import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  buildRallyImportPlan,
  emptyIdentityMap,
  parseRallyManifest,
  type RallyImportPlan,
  type ScannedFile,
} from "./rally-import-plan.mts";
import {
  buildRallyWriteMutations,
  evaluateRallyPreflight,
  evaluateRallyReadBack,
  publishedIdOf,
  recomputeRallyPlanDigest,
  validateRallyPlanContract,
  type RallyPreflightSnapshot,
} from "./rally-import-write.mts";
import { parseArguments } from "./write-rally-import.mts";

const execFileAsync = promisify(execFile);

const manifestJson = {
  version: 1,
  contentId: "rally-example-2024",
  filePrefix: "Rally_Example_2024",
  canonicalCategory: "rally",
  eventDate: "2024-08-01",
  publishedAt: "2024-08-05T09:00:00.000Z",
  title: { fi: "Rally Example 2024", en: "Rally Example 2024" },
  slug: { fi: "rally-esimerkki-2024", en: "rally-example-2024" },
  cover: 2,
  sections: [
    { key: "SS1_Harju_1", label: { fi: "EK 1 Harju 1", en: "SS 1 Harju 1" } },
    { key: "Huoltoparkki", label: { fi: "Huoltoparkki", en: "Service park" } },
  ],
};

function scanned(name: string, hash: string): ScannedFile {
  return { relativePath: name, contentHash: hash.repeat(64).slice(0, 64), format: "jpeg", width: 1600, height: 1067 };
}

function makePlan(): RallyImportPlan {
  const { manifest } = parseRallyManifest(manifestJson);
  if (manifest === undefined) throw new Error("fixture manifest invalid");
  let next = 0;
  const result = buildRallyImportPlan({
    manifest,
    files: [
      scanned("Rally_Example_2024_0001_SS1_Harju_1.jpg", "a"),
      scanned("Rally_Example_2024_0002_SS1_Harju_1.jpg", "b"),
      scanned("Rally_Example_2024_0003_Huoltoparkki.jpg", "c"),
    ],
    identities: emptyIdentityMap(),
    now: new Date("2026-09-23T00:00:00.000Z"),
    acceptInterleavedSections: false,
    mintMediaId: (contentId) => `${contentId}-${String((next += 1)).padStart(16, "0")}`,
  });
  if (result.plan === undefined) throw new Error("fixture plan blocked");
  return result.plan;
}

const CATEGORY_DOC = "category-doc-rally";
const GALLERY_FI = "rally--gallery-rally-example-2024-fi";
const GALLERY_EN = "rally--gallery-rally-example-2024-en";
const MEDIA_1 = "rally--media-rally-example-2024-0000000000000001";

function emptySnapshot(overrides: Partial<RallyPreflightSnapshot> = {}): RallyPreflightSnapshot {
  return {
    plannedIdDocuments: [],
    contentIdClaims: [],
    mediaIdClaims: [],
    routeClaims: [],
    childCategories: [],
    placementCount: 0,
    memberMedia: [],
    ...overrides,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("validateRallyPlanContract", () => {
  it("accepts exactly what the planner emits", () => {
    const plan = makePlan();
    expect(validateRallyPlanContract(clone(plan))).toEqual({ plan: clone(plan), issues: [] });
  });

  it("refuses a hand-edited plan", () => {
    type Key = string | number;
    const setAt = (root: unknown, keys: readonly Key[], value: unknown): void => {
      let node = root as Record<Key, unknown>;
      for (const key of keys.slice(0, -1)) node = node[key] as Record<Key, unknown>;
      node[keys.at(-1) as Key] = value;
    };
    const tamper = (edit: (plan: unknown) => void): readonly string[] => {
      const plan = clone(makePlan());
      edit(plan);
      return validateRallyPlanContract(plan).issues;
    };
    const galleryIndex = makePlan().documents.findIndex((document) => document._id === GALLERY_FI);

    expect(tamper((plan) => setAt(plan, ["extra"], 1))).toContainEqual(expect.stringMatching(/unknown field "extra"/));
    expect(tamper((plan) => setAt(plan, ["documents", 0, "caption"], "x"))).toContainEqual(
      expect.stringMatching(/unexpected field "caption"/),
    );
    expect(tamper((plan) => setAt(plan, ["documents", 0, "image", "asset", "_ref"], "image-abc"))).toContainEqual(
      expect.stringMatching(/pending asset/),
    );
    expect(tamper((plan) => setAt(plan, ["documents", 0, "captureSequence", "sectionId"], "ss9"))).toContainEqual(
      expect.stringMatching(/does not declare section ss9/),
    );
    expect(tamper((plan) => setAt(plan, ["documents", 1, "captureSequence", "sequence"], 1))).toContainEqual(
      expect.stringMatching(/repeats sequence 1/),
    );
    expect(
      tamper((plan) => setAt(plan, ["assetRequirements"], (plan as RallyImportPlan).assetRequirements.slice(1))),
    ).toContainEqual(expect.stringMatching(/exactly one asset requirement/));
    expect(tamper((plan) => setAt(plan, ["assetRequirements", 0, "relativePath"], "../etc/passwd"))).toContainEqual(
      expect.stringMatching(/unsafe relativePath/),
    );
    expect(tamper((plan) => setAt(plan, ["assetRequirements", 0, "width"], 4000))).toContainEqual(
      expect.stringMatching(/invalid width/),
    );
    expect(tamper((plan) => setAt(plan, ["documents", galleryIndex, "cover", "_ref"], "some-other-document"))).toContainEqual(
      expect.stringMatching(/cover that is not one of the plan's photographs/),
    );
    expect(tamper((plan) => setAt(plan, ["documents", galleryIndex, "orderingRule"], "manual"))).toContainEqual(
      expect.stringMatching(/not capture-sequence/),
    );
    expect(tamper((plan) => setAt(plan, ["version"], "rally-import-plan-v0"))).toContainEqual(
      expect.stringMatching(/version/),
    );
  });

  it("recomputes the digest from content, so an edit with an updated digest field still fails", () => {
    const plan = clone(makePlan());
    expect(recomputeRallyPlanDigest(plan)).toBe(plan.documentsDigest);
    const edited = clone(plan);
    const alt = (edited.documents[0] as unknown as { alt: { value: string }[] }).alt;
    (alt[0] as { value: string }).value = "Edited";
    expect(recomputeRallyPlanDigest({ ...edited, documentsDigest: "0".repeat(64) })).not.toBe(plan.documentsDigest);
  });
});

describe("publishedIdOf", () => {
  it("strips draft and release prefixes", () => {
    expect(publishedIdOf("drafts.a")).toBe("a");
    expect(publishedIdOf("versions.rabc.a")).toBe("a");
    expect(publishedIdOf("a")).toBe("a");
  });
});

describe("evaluateRallyPreflight", () => {
  it("passes an empty dataset", () => {
    const result = evaluateRallyPreflight(makePlan(), emptySnapshot(), CATEGORY_DOC);
    expect(result.collisions).toEqual([]);
    expect(result.existingMediaDocumentIds.size).toBe(0);
    expect(result.existingGalleries.size).toBe(0);
  });

  it("accepts its own earlier write and records what exists", () => {
    const plan = makePlan();
    const result = evaluateRallyPreflight(
      plan,
      emptySnapshot({
        plannedIdDocuments: [
          { _id: MEDIA_1, _type: "media", mediaId: "rally-example-2024-0000000000000001" },
          {
            _id: GALLERY_FI,
            _type: "gallery",
            contentId: "rally-example-2024",
            language: "fi",
            slug: "rally-esimerkki-2024",
            categoryRef: CATEGORY_DOC,
            orderingRule: "capture-sequence",
          },
        ],
        contentIdClaims: [{ _id: GALLERY_FI, _type: "gallery" }],
        mediaIdClaims: [{ _id: MEDIA_1, mediaId: "rally-example-2024-0000000000000001" }],
        memberMedia: [{ _id: MEDIA_1, mediaId: "rally-example-2024-0000000000000001" }],
        routeClaims: [{ _id: GALLERY_FI, language: "fi", slug: "rally-esimerkki-2024" }],
      }),
      CATEGORY_DOC,
    );
    expect(result.collisions).toEqual([]);
    expect([...result.existingMediaDocumentIds]).toEqual([MEDIA_1]);
    expect([...result.existingGalleries.keys()]).toEqual([GALLERY_FI]);
  });

  it("refuses every kind of conflict at once", () => {
    const result = evaluateRallyPreflight(
      makePlan(),
      emptySnapshot({
        plannedIdDocuments: [
          { _id: `drafts.${MEDIA_1}`, _type: "media" },
          { _id: "rally--media-rally-example-2024-0000000000000002", _type: "article" },
          {
            _id: GALLERY_EN,
            _type: "gallery",
            contentId: "rally-example-2024",
            language: "en",
            slug: "renamed",
            categoryRef: CATEGORY_DOC,
            orderingRule: "capture-sequence",
          },
        ],
        contentIdClaims: [{ _id: "migrated--gallery-rally-example-2024-fi", _type: "gallery" }],
        mediaIdClaims: [{ _id: "someone-else", mediaId: "rally-example-2024-0000000000000003" }],
        routeClaims: [{ _id: "article-x", language: "fi", slug: "rally-esimerkki-2024" }],
        childCategories: [{ _id: "cat-child", slug: [{ language: "en", value: "rally-example-2024" }] }],
        placementCount: 2,
        memberMedia: [{ _id: "stray-media", mediaId: "stray" }],
      }),
      CATEGORY_DOC,
    );
    expect(result.collisions).toEqual([
      expect.stringMatching(/already exists as a article document/),
      expect.stringMatching(/different slug/),
      expect.stringMatching(/0000000000000001 has an unpublished draft or release/),
      expect.stringMatching(/contentId rally-example-2024 is already used by gallery migrated--/),
      expect.stringMatching(/mediaId rally-example-2024-0000000000000003 is already used by someone-else/),
      expect.stringMatching(/fi address \/rally-esimerkki-2024 .* article-x/),
      expect.stringMatching(/en address \/rally-example-2024 .* subcategory/),
      expect.stringMatching(/2 gallery placement/),
      expect.stringMatching(/1 photograph\(s\) in the dataset belong to this gallery but are not in the plan/),
    ]);
  });

  it("finds a release copy through the raw claim queries", () => {
    const result = evaluateRallyPreflight(
      makePlan(),
      emptySnapshot({ contentIdClaims: [{ _id: `versions.r1.${GALLERY_FI}`, _type: "gallery" }] }),
      CATEGORY_DOC,
    );
    expect(result.collisions).toEqual([expect.stringMatching(/gallery-rally-example-2024-fi has an unpublished draft or release/)]);
  });
});

describe("buildRallyWriteMutations", () => {
  const assetIdByMediaId = new Map([
    ["rally-example-2024-0000000000000001", "image-1-1600x1067-jpg"],
    ["rally-example-2024-0000000000000002", "image-2-1600x1067-jpg"],
    ["rally-example-2024-0000000000000003", "image-3-1600x1067-jpg"],
  ]);

  it("creates everything on a first write, with real references", () => {
    const mutations = buildRallyWriteMutations(makePlan(), {
      categoryDocumentId: CATEGORY_DOC,
      assetIdByMediaId,
      existingMediaDocumentIds: new Set(),
      existingGalleries: new Map(),
    });
    expect(mutations.mediaWave).toHaveLength(3);
    expect(mutations.galleryWave).toHaveLength(2);
    const first = mutations.mediaWave[0] as { createIfNotExists: Record<string, unknown> };
    expect(first.createIfNotExists.image).toEqual({
      _type: "image",
      asset: { _type: "reference", _ref: "image-1-1600x1067-jpg" },
    });
    const gallery = mutations.galleryWave[0] as { createIfNotExists: Record<string, unknown> };
    expect(gallery.createIfNotExists.canonicalCategory).toEqual({ _type: "reference", _ref: CATEGORY_DOC });
    expect(mutations.summary).toEqual({
      mediaCreated: 3,
      mediaUpdated: 0,
      galleriesCreated: 2,
      galleriesUpdated: 0,
      sectionsAdded: 0,
    });
  });

  it("updates only plan-owned fields on a rerun", () => {
    const intro = [{ _type: "gallerySectionIntroParagraph", children: [] }];
    const mutations = buildRallyWriteMutations(makePlan(), {
      categoryDocumentId: CATEGORY_DOC,
      assetIdByMediaId,
      existingMediaDocumentIds: new Set([MEDIA_1]),
      existingGalleries: new Map([
        [
          GALLERY_FI,
          {
            _id: GALLERY_FI,
            _type: "gallery",
            hasCover: true,
            sections: [{ _key: "ss1-harju-1", sectionId: "ss1-harju-1", slug: "ss1-harju-1", label: "Edited label", intro }],
          },
        ],
        [
          GALLERY_EN,
          {
            _id: GALLERY_EN,
            _type: "gallery",
            hasCover: true,
            sections: [
              { _key: "ss1-harju-1", sectionId: "ss1-harju-1" },
              { _key: "huoltoparkki", sectionId: "huoltoparkki" },
            ],
          },
        ],
      ]),
    });
    expect(mutations.mediaWave[0]).toEqual({
      patch: {
        id: MEDIA_1,
        set: {
          captureSequence: { galleryContentId: "rally-example-2024", sequence: 1, sectionId: "ss1-harju-1" },
          image: { _type: "image", asset: { _type: "reference", _ref: "image-1-1600x1067-jpg" } },
        },
      },
    });
    // The Finnish gallery gains only the missing section; the edited one survives untouched.
    expect(mutations.galleryWave).toEqual([
      {
        patch: {
          id: GALLERY_FI,
          set: {
            sections: [
              { _key: "ss1-harju-1", sectionId: "ss1-harju-1", slug: "ss1-harju-1", label: "Edited label", intro },
              { _key: "huoltoparkki", sectionId: "huoltoparkki", slug: "huoltoparkki", label: "Huoltoparkki" },
            ],
          },
        },
      },
    ]);
    expect(mutations.summary).toMatchObject({ mediaUpdated: 1, galleriesUpdated: 1, sectionsAdded: 1, galleriesCreated: 0 });
  });

  it("refuses to write without every uploaded asset", () => {
    expect(() =>
      buildRallyWriteMutations(makePlan(), {
        categoryDocumentId: CATEGORY_DOC,
        assetIdByMediaId: new Map(),
        existingMediaDocumentIds: new Set(),
        existingGalleries: new Map(),
      }),
    ).toThrow(/no uploaded asset/);
  });
});

describe("evaluateRallyReadBack", () => {
  it("agrees with a complete write and names each disagreement", () => {
    const plan = makePlan();
    expect(
      evaluateRallyReadBack(plan, {
        galleries: [
          { _id: GALLERY_FI, orderingRule: "capture-sequence" },
          { _id: GALLERY_EN, orderingRule: "capture-sequence" },
        ],
        memberMediaCount: 3,
      }),
    ).toEqual([]);
    expect(
      evaluateRallyReadBack(plan, { galleries: [{ _id: GALLERY_FI, orderingRule: "manual" }], memberMediaCount: 2 }),
    ).toEqual([
      expect.stringMatching(/en was not found/),
      expect.stringMatching(/fi is not ordered by capture sequence/),
      expect.stringMatching(/2 photograph\(s\) after the write, the plan has 3/),
    ]);
  });
});

describe("parseArguments", () => {
  const base = ["--plan", "p.json", "--folder", "/r", "--out", "/o", "--approved-digest", "a".repeat(64)];

  it("requires every path and a well-formed digest, and is a dry run unless --yes", () => {
    expect(parseArguments(base)).toMatchObject({ apply: false, approvedDigest: "a".repeat(64) });
    expect(parseArguments([...base, "--yes"]).apply).toBe(true);
    expect(() => parseArguments(base.slice(0, 6))).toThrow(/--approved-digest/);
    expect(() => parseArguments([...base.slice(0, 7), "not-a-digest"])).toThrow(/--approved-digest/);
    expect(() => parseArguments([...base, "--token", "x"])).toThrow(/unknown option/);
  });
});

describe("plan:rally then write:rally, as real Node processes", () => {
  let root: string;
  let folder: string;
  let out: string;
  let digest: string;
  const planScript = path.join(import.meta.dirname, "plan-rally-import.mts");
  const writeScript = path.join(import.meta.dirname, "write-rally-import.mts");
  const noCredentialEnv = { ...process.env, SANITY_MIGRATION_TOKEN: "", SANITY_PROJECT_ID: "" };

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "rally-write-"));
    folder = path.join(root, "rally");
    out = path.join(root, "out");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "rally.json"), JSON.stringify(manifestJson));
    const image = (name: string, shade: number) =>
      sharp({ create: { width: 1600, height: 1067, channels: 3, background: { r: shade, g: 90, b: 60 } } })
        .withMetadata({ exif: { IFD0: { Artist: "Example" } } })
        .jpeg()
        .toFile(path.join(folder, name));
    await image("Rally_Example_2024_0001_SS1_Harju_1.jpg", 10);
    await image("Rally_Example_2024_0002_SS1_Harju_1.jpg", 20);
    await image("Rally_Example_2024_0003_Huoltoparkki.jpg", 30);
    const { stdout } = await execFileAsync(process.execPath, [planScript, "--folder", folder, "--out", out]);
    digest = /documentsDigest: ([0-9a-f]{64})/u.exec(stdout)?.[1] ?? "";
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const run = (args: readonly string[]) =>
    execFileAsync(process.execPath, [writeScript, ...args], { env: noCredentialEnv }).catch(
      (cause: { code?: number; stdout?: string; stderr?: string }) => cause,
    );

  it("verifies the approved plan and every file without any credential or network", async () => {
    const result = (await run([
      "--plan", path.join(out, "rally-import-plan.json"),
      "--folder", folder,
      "--out", path.join(root, "write-out"),
      "--approved-digest", digest,
    ])) as { stdout: string };
    expect(result.stdout).toContain("3 photograph(s) verified locally");
    expect(result.stdout).toContain("Dry run only");
  });

  it("refuses a digest that is not the reviewed plan's", async () => {
    const result = (await run([
      "--plan", path.join(out, "rally-import-plan.json"),
      "--folder", folder,
      "--out", path.join(root, "write-out"),
      "--approved-digest", "b".repeat(64),
    ])) as { code?: number; stderr?: string };
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/does not match --approved-digest/);
  });

  it("refuses a file that changed after the plan was made", async () => {
    const changed = path.join(root, "changed");
    await mkdir(changed, { recursive: true });
    for (const name of [
      "rally.json",
      "Rally_Example_2024_0001_SS1_Harju_1.jpg",
      "Rally_Example_2024_0002_SS1_Harju_1.jpg",
    ]) {
      await writeFile(path.join(changed, name), await readFile(path.join(folder, name)));
    }
    await sharp({ create: { width: 1600, height: 1067, channels: 3, background: { r: 99, g: 9, b: 9 } } })
      .jpeg()
      .toFile(path.join(changed, "Rally_Example_2024_0003_Huoltoparkki.jpg"));
    const result = (await run([
      "--plan", path.join(out, "rally-import-plan.json"),
      "--folder", changed,
      "--out", path.join(root, "changed-out"),
      "--approved-digest", digest,
    ])) as { code?: number };
    expect(result.code).toBe(1);
    const failures = JSON.parse(await readFile(path.join(root, "changed-out", "rally-asset-failures.json"), "utf8"));
    expect(failures).toEqual([
      { relativePath: "Rally_Example_2024_0003_Huoltoparkki.jpg", reason: expect.stringMatching(/changed since the plan/) },
    ]);
  });

  it("strips camera metadata from the public copy", async () => {
    const { generatePublicDerivative } = await import("./joomla-image-derivative.mts");
    const source = await readFile(path.join(folder, "Rally_Example_2024_0001_SS1_Harju_1.jpg"));
    expect((await sharp(source).metadata()).exif).toBeDefined();
    const derivative = await generatePublicDerivative(new Uint8Array(source));
    const metadata = await sharp(derivative.bytes).metadata();
    expect(metadata.exif).toBeUndefined();
    expect([metadata.width, metadata.height]).toEqual([1600, 1067]);
  });
});
