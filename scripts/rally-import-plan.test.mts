import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseArguments } from "./plan-rally-import.mts";
import {
  buildRallyImportPlan,
  CAPTURE_SEQUENCE_ORDERING_RULE,
  emptyIdentityMap,
  findInterleavedSections,
  IDENTITY_PATTERN,
  MAX_GALLERY_SECTIONS,
  parseIdentityMap,
  parseRallyFileName,
  parseRallyManifest,
  sectionIdFromKey,
  type RallyManifest,
  type ScannedFile,
} from "./rally-import-plan.mts";
import { CAPTURE_SEQUENCE_ORDERING_RULE as SCHEMA_CAPTURE_SEQUENCE_ORDERING_RULE } from "../sanity/schemas/capture-sequence";
import { MAX_GALLERY_SECTIONS as SCHEMA_MAX_GALLERY_SECTIONS } from "../sanity/schemas/gallery";
import { LOCALIZED_SLUG_PATTERN } from "../sanity/schemas/localized-slug";

const execFileAsync = promisify(execFile);

const manifestJson = {
  version: 1,
  contentId: "rally-example-2024",
  filePrefix: "Rally_Example_2024",
  canonicalCategory: "rally",
  eventDate: "2024-08-01",
  title: { fi: "Rally Example 2024", en: "Rally Example 2024" },
  slug: { fi: "rally-example-2024", en: "rally-example-2024" },
  cover: 2,
  sections: [
    { key: "SS1_Harju_1", label: { fi: "EK 1 Harju 1", en: "SS 1 Harju 1" } },
    { key: "Huoltoparkki", label: { fi: "Huoltoparkki", en: "Service park" } },
  ],
};

function manifestOf(overrides: Record<string, unknown> = {}): RallyManifest {
  const { manifest, issues } = parseRallyManifest({ ...manifestJson, ...overrides });
  if (manifest === undefined) throw new Error(issues.join("; "));
  return manifest;
}

function issuesOf(overrides: Record<string, unknown>): readonly string[] {
  return parseRallyManifest({ ...manifestJson, ...overrides }).issues;
}

function hashOf(seed: string): string {
  return seed.padEnd(64, "0").replace(/[^0-9a-f]/gu, "a").slice(0, 64);
}

function file(name: string, overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    relativePath: name,
    contentHash: hashOf(name.replace(/[^0-9]/gu, "")),
    format: name.endsWith(".webp") ? "webp" : "jpeg",
    width: 2048,
    height: 1365,
    ...overrides,
  };
}

function counterMint(): (contentId: string) => string {
  let next = 0;
  return (contentId) => {
    next += 1;
    return `${contentId}-${String(next).padStart(16, "0")}`;
  };
}

const NOW = new Date("2026-09-23T10:00:00.000Z");

function plan(
  files: readonly ScannedFile[],
  options: { manifest?: RallyManifest; accept?: boolean; identities?: ReturnType<typeof emptyIdentityMap> } = {},
) {
  return buildRallyImportPlan({
    manifest: options.manifest ?? manifestOf(),
    files,
    identities: options.identities ?? emptyIdentityMap(),
    now: NOW,
    acceptInterleavedSections: options.accept ?? false,
    mintMediaId: counterMint(),
  });
}

const goodFiles = [
  file("Rally_Example_2024_0003_Huoltoparkki.jpg"),
  file("SS1/Rally_Example_2024_0001_SS1_Harju_1.jpg"),
  file("SS1/Rally_Example_2024_0002_SS1_Harju_1.webp"),
];

describe("restated schema rules stay pinned", () => {
  it("matches the Studio identity pattern, section bound, and ordering rule", () => {
    expect(IDENTITY_PATTERN.source).toBe(LOCALIZED_SLUG_PATTERN.source);
    expect(MAX_GALLERY_SECTIONS).toBe(SCHEMA_MAX_GALLERY_SECTIONS);
    expect(CAPTURE_SEQUENCE_ORDERING_RULE).toBe(SCHEMA_CAPTURE_SEQUENCE_ORDERING_RULE);
  });
});

describe("parseRallyManifest", () => {
  it("accepts a complete manifest and derives section ids", () => {
    const manifest = manifestOf();
    expect(manifest.languages).toEqual(["en", "fi"]);
    expect(manifest.eventDate).toBe("2024-08-01T12:00:00.000Z");
    expect(manifest.photoWord).toEqual({ en: "photograph", fi: "kuva" });
    expect(manifest.sections.map((section) => [section.sectionId, section.slug])).toEqual([
      ["ss1-harju-1", "ss1-harju-1"],
      ["huoltoparkki", "huoltoparkki"],
    ]);
  });

  it("refuses unknown fields, a wrong version, and bad identities", () => {
    expect(issuesOf({ extra: true })).toContainEqual(expect.stringMatching(/unknown field "extra"/));
    expect(issuesOf({ version: 2 })).toContainEqual(expect.stringMatching(/version/));
    expect(issuesOf({ contentId: "Rally 2024" })).toContainEqual(expect.stringMatching(/contentId/));
    expect(issuesOf({ filePrefix: "Rally Ralli" })).toContainEqual(expect.stringMatching(/filePrefix/));
    expect(issuesOf({ canonicalCategory: "" })).toContainEqual(expect.stringMatching(/canonicalCategory/));
  });

  it("refuses an impossible event date and a malformed publishedAt", () => {
    expect(issuesOf({ eventDate: "2024-02-30" })).toContainEqual(expect.stringMatching(/eventDate/));
    expect(issuesOf({ publishedAt: "2024-08-05" })).toContainEqual(expect.stringMatching(/publishedAt/));
    expect(manifestOf({ publishedAt: "2024-08-05T09:00:00.000Z" }).publishedAt).toBe(
      "2024-08-05T09:00:00.000Z",
    );
  });

  it("requires the same languages everywhere and a photo word for unknown languages", () => {
    expect(issuesOf({ slug: { fi: "rally-example-2024" } })).toContainEqual(
      expect.stringMatching(/slug must have exactly the languages/),
    );
    expect(issuesOf({ slug: { fi: "Rally", en: "rally" } })).toContainEqual(
      expect.stringMatching(/slug.fi/),
    );
    const swedish = {
      title: { fi: "T", sv: "T" },
      slug: { fi: "t", sv: "t" },
      sections: [{ key: "SS1", label: { fi: "EK 1", sv: "SS 1" } }],
    };
    expect(issuesOf(swedish)).toContainEqual(expect.stringMatching(/photoWord.sv is required/));
    expect(issuesOf({ ...swedish, photoWord: { sv: "bild" } })).toEqual([]);
  });

  it("refuses duplicate or reserved sections, too many sections, and a bad cover", () => {
    expect(
      issuesOf({
        sections: [
          { key: "SS1_A", label: { fi: "a", en: "a" } },
          { key: "ss1-a", label: { fi: "b", en: "b" } },
        ],
      }),
    ).toContainEqual(expect.stringMatching(/share the section id/));
    expect(issuesOf({ sections: [{ key: "All", label: { fi: "a", en: "a" } }] })).toContainEqual(
      expect.stringMatching(/reserved/),
    );
    expect(
      issuesOf({
        sections: Array.from({ length: 21 }, (_u, i) => ({ key: `S${i}`, label: { fi: "a", en: "a" } })),
      }),
    ).toContainEqual(expect.stringMatching(/at most 20/));
    expect(issuesOf({ cover: 0 })).toContainEqual(expect.stringMatching(/cover/));
    expect(issuesOf({ sections: [{ key: "SS1", label: { fi: "a", en: "a" }, note: "x" }] })).toContainEqual(
      expect.stringMatching(/unknown field "note"/),
    );
  });

  it("derives lowercase hyphenated section ids from file-name keys", () => {
    expect(sectionIdFromKey("SS2_Milzkalne_1")).toBe("ss2-milzkalne-1");
    expect(sectionIdFromKey("Podium__Ceremony")).toBe("podium-ceremony");
  });
});

describe("parseRallyFileName", () => {
  const prefix = "Tet_Rally_Latvia_2024";

  it("reads the running number and section key", () => {
    expect(parseRallyFileName("Tet_Rally_Latvia_2024_0327_SS2_Milzkalne_1.jpg", prefix)).toEqual({
      ok: true,
      sequence: 327,
      sectionKey: "SS2_Milzkalne_1",
      format: "jpeg",
    });
    expect(parseRallyFileName("Tet_Rally_Latvia_2024_0001_Start.JPEG", prefix)).toMatchObject({
      ok: true,
      format: "jpeg",
    });
    expect(parseRallyFileName("Tet_Rally_Latvia_2024_0002_Start.webp", prefix)).toMatchObject({
      ok: true,
      format: "webp",
    });
  });

  it("names the problem for every refused shape", () => {
    const reason = (name: string) => {
      const parsed = parseRallyFileName(name, prefix);
      return parsed.ok ? "" : parsed.reason;
    };
    expect(reason("Tet_Rally_Latvia_2024_0327_SS2.dng")).toMatch(/camera master/);
    expect(reason("Tet_Rally_Latvia_2024_0327_SS2.png")).toMatch(/only exported/);
    expect(reason("Other_2024_0327_SS2.jpg")).toMatch(/expected Tet_Rally_Latvia_2024_/);
    expect(reason("Tet_Rally_Latvia_2024_327_SS2.jpg")).toMatch(/expected/);
    expect(reason("Tet_Rally_Latvia_2024_0000_SS2.jpg")).toMatch(/starts at 0001/);
    expect(reason("Tet_Rally_Latvia_2024_0327_Päijälä.jpg")).toMatch(/ASCII/);
    expect(reason("Tet_Rally_Latvia_2024_0327.jpg")).toMatch(/expected/);
  });
});

describe("buildRallyImportPlan", () => {
  it("plans media in running-number order and two capture-sequence galleries", () => {
    const result = plan(goodFiles);
    expect(result.refusals).toEqual([]);
    expect(result.problems).toEqual([]);
    const documents = result.plan?.documents ?? [];
    const media = documents.filter((document) => document._type === "media");
    const galleries = documents.filter((document) => document._type === "gallery");

    expect(media.map((document) => (document.captureSequence as { sequence: number }).sequence)).toEqual([1, 2, 3]);
    expect(media[0]).toMatchObject({
      _id: "rally--media-rally-example-2024-0000000000000001",
      mediaId: "rally-example-2024-0000000000000001",
      mediaType: "image",
      publiclyRenderable: true,
      captureSequence: { galleryContentId: "rally-example-2024", sequence: 1, sectionId: "ss1-harju-1" },
      image: { _type: "image", asset: { _type: "reference", _ref: "pending-asset:rally-example-2024-0000000000000001" } },
    });
    expect(media[2]?.alt).toEqual([
      { _key: "alt-en", _type: "localizedText", language: "en", value: "Rally Example 2024: Service park, photograph 3" },
      { _key: "alt-fi", _type: "localizedText", language: "fi", value: "Rally Example 2024: Huoltoparkki, kuva 3" },
    ]);

    expect(galleries.map((document) => document._id)).toEqual([
      "rally--gallery-rally-example-2024-en",
      "rally--gallery-rally-example-2024-fi",
    ]);
    expect(galleries[1]).toMatchObject({
      contentId: "rally-example-2024",
      language: "fi",
      title: "Rally Example 2024",
      slug: "rally-example-2024",
      publishedAt: NOW.toISOString(),
      eventDate: "2024-08-01T12:00:00.000Z",
      orderingRule: "capture-sequence",
      canonicalCategory: { _type: "reference", _ref: "pending-category:rally" },
      cover: { _type: "reference", _ref: "rally--media-rally-example-2024-0000000000000002" },
      sections: [
        { _key: "ss1-harju-1", sectionId: "ss1-harju-1", slug: "ss1-harju-1", label: "EK 1 Harju 1" },
        { _key: "huoltoparkki", sectionId: "huoltoparkki", slug: "huoltoparkki", label: "Huoltoparkki" },
      ],
    });
    expect(galleries[0]?.sections).toContainEqual(expect.objectContaining({ label: "Service park" }));
    expect(galleries[0]).not.toHaveProperty("summary");

    expect(result.plan?.assetRequirements.map((asset) => asset.relativePath)).toEqual([
      "SS1/Rally_Example_2024_0001_SS1_Harju_1.jpg",
      "SS1/Rally_Example_2024_0002_SS1_Harju_1.webp",
      "Rally_Example_2024_0003_Huoltoparkki.jpg",
    ]);
    expect(result.counts).toMatchObject({ files: 3, photographs: 3, newIdentities: 3, reusedIdentities: 0 });
    expect(result.plan?.documentsDigest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("reuses identities by content hash, so a rename keeps the mediaId", () => {
    const first = plan(goodFiles);
    const renamed = goodFiles.map((entry) =>
      entry.relativePath.includes("0003")
        ? { ...entry, relativePath: "Rally_Example_2024_0004_Huoltoparkki.jpg" }
        : entry,
    );
    const second = plan(renamed, { identities: first.identities });
    expect(second.counts).toMatchObject({ reusedIdentities: 3, newIdentities: 0 });
    const idOf = (result: typeof first, sequence: number) =>
      result.plan?.documents.find(
        (document) => (document.captureSequence as { sequence?: number } | undefined)?.sequence === sequence,
      )?.mediaId;
    expect(idOf(second, 4)).toBe(idOf(first, 3));
  });

  it("produces the same digest for the same input", () => {
    expect(plan(goodFiles).plan?.documentsDigest).toBe(plan(goodFiles).plan?.documentsDigest);
  });

  it("refuses every problem file at once and writes no plan", () => {
    const result = plan([
      ...goodFiles,
      file("Rally_Example_2024_0004_SS9_Unknown.jpg"),
      file("Rally_Example_2024_0001_Huoltoparkki.jpg", { contentHash: hashOf("99") }),
      file("Rally_Example_2024_0005_Huoltoparkki.jpg", {
        contentHash: (goodFiles[1] as ScannedFile).contentHash,
      }),
      file("Rally_Example_2024_0006_Huoltoparkki.jpg", { width: 4000, height: 3000 }),
      file("Rally_Example_2024_0007_Huoltoparkki.jpg", { format: "png" }),
      file("Rally_Example_2024_0008_Huoltoparkki.jpg", { format: undefined }),
      file("Rally_Example_2024_0009_Huoltoparkki.dng"),
    ]);
    expect(result.plan).toBeUndefined();
    const reasons = result.refusals.map((refusal) => refusal.reason);
    expect(reasons).toEqual([
      expect.stringMatching(/"SS9_Unknown" is not declared/),
      expect.stringMatching(/0001 is also used by/),
      expect.stringMatching(/identical bytes/),
      expect.stringMatching(/at most 2048 px/),
      expect.stringMatching(/is png/),
      expect.stringMatching(/could not be decoded/),
      expect.stringMatching(/camera master/),
    ]);
  });

  it("reports a declared section with no files and a cover that names nothing", () => {
    const result = plan([goodFiles[1] as ScannedFile], { manifest: manifestOf({ cover: 9 }) });
    expect(result.plan).toBeUndefined();
    expect(result.problems).toEqual([
      'section "Huoltoparkki" is declared but has no files',
      "cover 0009 names no photograph in the folder",
    ]);
  });

  it("blocks interleaved sections unless the owner accepts them", () => {
    const interleaved = [
      file("Rally_Example_2024_0001_SS1_Harju_1.jpg"),
      file("Rally_Example_2024_0002_Huoltoparkki.jpg"),
      file("Rally_Example_2024_0003_SS1_Harju_1.jpg"),
    ];
    const blocked = plan(interleaved);
    expect(blocked.plan).toBeUndefined();
    expect(blocked.warnings).toHaveLength(1);
    const accepted = plan(interleaved, { accept: true });
    expect(accepted.plan?.acceptedInterleavedSections).toBe(true);
  });

  it("uses the owner's publishedAt when given", () => {
    const result = plan(goodFiles, { manifest: manifestOf({ publishedAt: "2024-08-05T09:00:00.000Z" }) });
    expect(result.plan?.documents.find((document) => document._type === "gallery")?.publishedAt).toBe(
      "2024-08-05T09:00:00.000Z",
    );
  });
});

describe("findInterleavedSections", () => {
  it("is silent for consecutive ranges and names overlapping ones", () => {
    expect(
      findInterleavedSections([
        { sequence: 1, sectionKey: "A" },
        { sequence: 2, sectionKey: "A" },
        { sequence: 3, sectionKey: "B" },
      ]),
    ).toEqual([]);
    expect(
      findInterleavedSections([
        { sequence: 1, sectionKey: "A" },
        { sequence: 5, sectionKey: "A" },
        { sequence: 3, sectionKey: "B" },
      ]),
    ).toEqual(['sections "A" (1–5) and "B" (3–3) interleave']);
  });
});

describe("parseIdentityMap", () => {
  it("accepts a well-formed map and refuses a malformed or ambiguous one", () => {
    const hash = "a".repeat(64);
    expect(parseIdentityMap({ version: 1, byContentHash: { [hash]: "rally-x-1" } }).identities).toBeDefined();
    expect(parseIdentityMap({ version: 1, byContentHash: { nothex: "rally-x-1" } }).issues).not.toEqual([]);
    expect(
      parseIdentityMap({ version: 1, byContentHash: { [hash]: "rally-x-1", ["b".repeat(64)]: "rally-x-1" } }).issues,
    ).toContainEqual(expect.stringMatching(/two different files/));
  });
});

describe("parseArguments", () => {
  it("requires both folders, keeps --out outside the rally folder, and rejects typos", () => {
    expect(parseArguments(["--folder", "/r", "--out", "/o"])).toEqual({
      folder: "/r",
      out: "/o",
      acceptInterleavedSections: false,
    });
    expect(parseArguments(["--folder", "/r", "--out", "/o", "--accept-interleaved-sections"]).acceptInterleavedSections).toBe(true);
    expect(() => parseArguments(["--folder", "/r"])).toThrow(/--out/);
    expect(() => parseArguments(["--folder", "/r", "--out", "/r/reports"])).toThrow(/outside --folder/);
    expect(() => parseArguments(["--folder", "/r", "--out", "/o", "--folders", "/x"])).toThrow(/unknown option/);
  });
});

describe("npm run plan:rally, as a real Node process", () => {
  let root: string;

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "rally-plan-"));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  async function image(filePath: string, width: number, height: number, shade: number): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true });
    await sharp({ create: { width, height, channels: 3, background: { r: shade, g: 80, b: 120 } } })
      .jpeg()
      .toFile(filePath);
  }

  it("scans a folder, writes private reports, and reuses identities on a rerun", async () => {
    const folder = path.join(root, "rally");
    const out = path.join(root, "out");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "rally.json"), JSON.stringify(manifestJson));
    await writeFile(path.join(folder, ".DS_Store"), "ignored");
    await image(path.join(folder, "SS1", "Rally_Example_2024_0001_SS1_Harju_1.jpg"), 1600, 1067, 10);
    await image(path.join(folder, "SS1", "Rally_Example_2024_0002_SS1_Harju_1.jpg"), 1067, 1600, 20);
    await image(path.join(folder, "Rally_Example_2024_0003_Huoltoparkki.jpg"), 2048, 1152, 30);

    const script = path.join(import.meta.dirname, "plan-rally-import.mts");
    const first = await execFileAsync(process.execPath, [script, "--folder", folder, "--out", out]);
    expect(first.stdout).toContain("photographs: 3, refused: 0");
    expect(first.stdout).toMatch(/documentsDigest: [0-9a-f]{64}/u);
    expect(first.stdout).not.toContain("Rally_Example_2024_0001");

    const planFile = JSON.parse(await readFile(path.join(out, "rally-import-plan.json"), "utf8"));
    expect(planFile.assetRequirements[1]).toMatchObject({ width: 1067, height: 1600 });
    expect((await stat(path.join(out, "rally-import-plan.json"))).mode & 0o777).toBe(0o600);
    expect((await stat(out)).mode & 0o777).toBe(0o700);

    const second = await execFileAsync(process.execPath, [script, "--folder", folder, "--out", out]);
    expect(second.stdout).toContain("identities: 3 reused, 0 new");
  });

  it("exits non-zero and writes no plan when a file is refused", async () => {
    const folder = path.join(root, "bad");
    const out = path.join(root, "bad-out");
    await mkdir(folder, { recursive: true });
    await writeFile(path.join(folder, "rally.json"), JSON.stringify(manifestJson));
    await image(path.join(folder, "Rally_Example_2024_0001_SS1_Harju_1.jpg"), 3000, 2000, 40);
    await image(path.join(folder, "Rally_Example_2024_0002_Huoltoparkki.jpg"), 1600, 1067, 50);

    const script = path.join(import.meta.dirname, "plan-rally-import.mts");
    const error = await execFileAsync(process.execPath, [script, "--folder", folder, "--out", out]).catch(
      (cause: { code?: number; stderr?: string }) => cause,
    );
    expect((error as { code?: number }).code).toBe(1);
    await expect(stat(path.join(out, "rally-import-plan.json"))).rejects.toThrow();
    const report = JSON.parse(await readFile(path.join(out, "rally-import-report.json"), "utf8"));
    expect(report.refusals[0].reason).toMatch(/2048 px/);
  });
});
