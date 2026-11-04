/** Synthetic fixtures only, with the real ExifTool and an in-memory store. Nothing leaves this machine. */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";

import { createImportMetadataTool, prepareJpegForImport } from "./image-import-metadata-edit.mts";
import { inspectJpegImportFacts } from "./image-import-metadata.mts";
import {
  buildPublishedReuploadPlan, indexAssetRequirements, parseSensitiveList, reuploadApprovalDigest,
  type PublishedMedium, type ReuploadPlanned, type ReuploadSource,
} from "./legacy-image-reupload-match.mts";
import { parseArguments, resolveSource, runLegacyImageReupload, type ReuploadPort } from "./write-legacy-image-reupload.mts";

const tool = createImportMetadataTool();
afterAll(() => tool.end());
// ExifTool starts a Perl process and rewrites real files, which takes seconds under the parallel suite.
const TOOL_TIMEOUT_MS = 60_000;

const medium = (mediaId: string, overrides: Partial<PublishedMedium> = {}): PublishedMedium => ({ _id: `doc-${mediaId}`, _rev: `rev-${mediaId}`, mediaId, assetRef: `image-old-${mediaId}`, ...overrides });
const hash = (seed: string) => createHash("sha256").update(seed).digest("hex");
const source = (name: string, overrides: Partial<ReuploadSource> = {}): ReuploadSource => ({ path: name, sha256: hash(name), bytes: 10, action: "keep-compressed-data", gps: "absent", ...overrides });
const requirement = (mediaId: string, file: string) => ({ mediaId, sourceLocator: file, contentHash: hash(file) });

describe("matching published media to sources", () => {
  const requirements = indexAssetRequirements([requirement("a", "a.jpg"), requirement("gone", "gone.jpg"), requirement("changed", "changed.jpg"), requirement("png", "png.png"), requirement("bad", "bad.jpg"), requirement("no-asset", "a.jpg")]);
  const sources = new Map([
    ["a.jpg", source("a.jpg", { gps: "present", bytes: 100 })],
    ["changed.jpg", source("changed.jpg", { sha256: hash("other") })],
    ["png.png", source("png.png", { action: "non-jpeg-no-rule", gps: null })],
    ["bad.jpg", source("bad.jpg", { action: "unreadable", gps: null })],
  ]);
  const published = ["a", "gone", "changed", "png", "bad", "unknown"].map((id) => medium(id));

  it("plans a medium only through its recorded source and hash, and reports every other reason", () => {
    const plan = buildPublishedReuploadPlan([...published, medium("no-asset", { assetRef: null })], requirements, sources);
    expect(plan.planned.map((row) => row.mediaId)).toEqual(["a"]);
    expect(Object.fromEntries(plan.skipped.map((row) => [row.mediaId, row.reason]))).toEqual({
      bad: "unreadable-jpeg", changed: "source-changed", gone: "source-missing", "no-asset": "no-asset", png: "not-a-jpeg", unknown: "no-recorded-source",
    });
    expect(plan.summary).toMatchObject({ published: 7, planned: 1, keepCompressedData: 1, reEncode: 0, gpsReview: 1, sourceBytes: 100 });
  });

  it("lists every planned medium with a location for the owner, by medium and source", () => {
    expect(buildPublishedReuploadPlan(published, requirements, sources).gpsReview).toEqual([{ mediaId: "a", sourceLocator: "a.jpg", gps: "present" }]);
  });

  it("treats a repeated pair as one, and two different files for a medium as a fault", () => {
    const index = indexAssetRequirements([requirement("m", "a.jpg"), requirement("m", "a.jpg"), requirement("n", "a.jpg"), requirement("n", "b.jpg")]);
    expect(index.get("m")).toMatchObject({ sourceLocator: "a.jpg" });
    expect(index.get("n")).toBe("conflict");
    expect(buildPublishedReuploadPlan([medium("n")], index, new Map()).skipped).toEqual([{ mediaId: "n", reason: "conflicting-sources" }]);
  });
});

describe("the approval", () => {
  const planned = [{ ...medium("a"), sourceLocator: "a.jpg", contentHash: hash("a"), action: "keep-compressed-data", gps: "present", sourceBytes: 1 }] as readonly ReuploadPlanned[];

  it("changes with the revision, the bytes, the sensitive list and whether old assets go", () => {
    const base = reuploadApprovalDigest(planned, new Set());
    expect(reuploadApprovalDigest(planned, new Set(), true)).not.toBe(base);
    expect(reuploadApprovalDigest(planned, new Set(["a"]))).not.toBe(base);
    expect(reuploadApprovalDigest([{ ...planned[0], _rev: "other" }], new Set())).not.toBe(base);
    expect(reuploadApprovalDigest([{ ...planned[0], contentHash: "other" }], new Set())).not.toBe(base);
  });

  it("reads a sensitive list, and refuses a line naming no planned medium", () => {
    expect(parseSensitiveList("# comment\n a \n\n", planned)).toEqual(new Set(["a"]));
    expect(() => parseSensitiveList("a\ntypo\n", planned)).toThrow("SENSITIVE_LIST_UNKNOWN_MEDIA:1");
  });
});

const FIXTURE_ARGUMENTS = [
  "-overwrite_original", "-XMP-dc:Subject=term", "-IPTC:Keywords=term", "-EXIF:Make=ExampleMake", "-EXIF:Artist=Exif Artist",
  "-EXIF:GPSLatitude=60.1", "-EXIF:GPSLatitudeRef=N", "-EXIF:GPSLongitude=24.9", "-EXIF:GPSLongitudeRef=E",
  "-XMP-exif:GPSLatitude=60.1 N", "-XMP-exif:GPSLongitude=24.9 E",
  "-XMP-photoshop:City=Shot City", "-XMP-iptcCore:Location=Shot Place", "-IPTC:City=Shot City",
  "-XMP-iptcCore:CreatorCity=Creator City", "-XMP-iptcCore:CreatorAddress=Example Street 1",
];

async function fixture(width: number, height: number): Promise<Uint8Array> {
  const directory = await mkdtemp(path.join(tmpdir(), "reupload-fixture-"));
  try {
    const file = path.join(directory, "fixture.jpg");
    await writeFile(file, await sharp({ create: { width, height, channels: 3, background: { r: 9, g: 90, b: 150 } } }).jpeg().toBuffer());
    await tool.write(file, {}, { writeArgs: FIXTURE_ARGUMENTS });
    return new Uint8Array(await readFile(file));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function tagsOf(bytes: Uint8Array) {
  const directory = await mkdtemp(path.join(tmpdir(), "reupload-read-"));
  try {
    const file = path.join(directory, "read.jpg");
    await writeFile(file, bytes);
    return await tool.readRaw(file, { readArgs: ["-G1", "-u"] }) as unknown as Record<string, unknown>;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function planOf(files: Readonly<Record<string, Uint8Array>>) {
  const entries = Object.entries(files);
  const sources = new Map(entries.map(([name, bytes]): [string, ReuploadSource] => {
    const facts = inspectJpegImportFacts(bytes);
    return [name, { path: name, sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length, action: Math.max(facts.width, facts.height) <= 2048 ? "keep-compressed-data" : "re-encode", gps: facts.gps }];
  }));
  const requirements = indexAssetRequirements(entries.map(([name]) => ({ mediaId: name, sourceLocator: name, contentHash: sources.get(name)!.sha256 })));
  return buildPublishedReuploadPlan(entries.map(([name]) => medium(name)), requirements, sources);
}

function portOf(files: Readonly<Record<string, Uint8Array>>, overrides: Partial<ReuploadPort> = {}) {
  const uploads: Uint8Array[] = [], patches: { id: string; rev: string; assetId: string }[] = [], deletions: string[] = [];
  const port: ReuploadPort = {
    readSource: async (locator) => files[locator],
    upload: async (bytes) => {
      uploads.push(bytes);
      const { width, height } = await sharp(bytes).metadata();
      return { assetId: `image-${createHash("sha1").update(bytes).digest("hex")}-${width}x${height}-jpg`, width, height };
    },
    patchAsset: async (row, assetId) => { patches.push({ id: row._id, rev: row._rev, assetId }); },
    deleteAsset: async (assetId) => { deletions.push(assetId); },
    ...overrides,
  };
  return { port, uploads, patches, deletions };
}

describe("running the re-upload", () => {
  it("prepares everything and uploads nothing without --yes", async () => {
    const files = { "small.jpg": await fixture(400, 200), "large.jpg": await fixture(3000, 1500) };
    const { port, uploads, patches } = portOf(files);
    const result = await runLegacyImageReupload(planOf(files), new Set(), port, tool);
    expect(result).toMatchObject({ outcome: "prepared", prepared: 2, written: 0, failed: [] });
    expect(result.preparedBytes).toBeGreaterThan(0);
    expect(uploads).toEqual([]);
    expect(patches).toEqual([]);
  }, TOOL_TIMEOUT_MS);

  it("needs the digest it reported", async () => {
    const files = { "a.jpg": await fixture(400, 200) };
    const { port, uploads } = portOf(files);
    await expect(runLegacyImageReupload(planOf(files), new Set(), port, tool, { yes: true, approvedDigest: "wrong" })).rejects.toThrow("DIGEST_MISMATCH");
    expect(uploads).toEqual([]);
  }, TOOL_TIMEOUT_MS);

  it("uploads the prepared file, keeping GPS and removing keywords, and patches under the plan's revision", async () => {
    const files = { "a.jpg": await fixture(400, 200) };
    const plan = planOf(files);
    const { port, uploads, patches } = portOf(files);
    const result = await runLegacyImageReupload(plan, new Set(), port, tool, { yes: true, approvedDigest: reuploadApprovalDigest(plan.planned, new Set()) });
    expect(result).toMatchObject({ outcome: "written", written: 1, failed: [] });
    expect(patches).toMatchObject([{ id: "doc-a.jpg", rev: "rev-a.jpg" }]);
    expect(inspectJpegImportFacts(uploads[0])).toMatchObject({ gps: "present", keywordMetadata: false, creatorPostalAddress: false });
  }, TOOL_TIMEOUT_MS);

  it.each([[400, 200], [3000, 1500]])("removes every location from a sensitive %ix%i image, and nothing else", async (width, height) => {
    const files = { "a.jpg": await fixture(width, height) };
    const plan = planOf(files);
    const sensitive = new Set(["a.jpg"]);
    const { port, uploads } = portOf(files);
    await runLegacyImageReupload(plan, sensitive, port, tool, { yes: true, approvedDigest: reuploadApprovalDigest(plan.planned, sensitive) });
    expect(inspectJpegImportFacts(uploads[0]).gps).toBe("absent");
    const tags = await tagsOf(uploads[0]);
    expect(Object.keys(tags).filter((key) => /GPS/i.test(key) && !key.startsWith("Composite"))).toEqual([]);
    expect(tags).not.toHaveProperty("XMP-photoshop:City");
    expect(tags).not.toHaveProperty("XMP-iptcCore:Location");
    expect(tags).not.toHaveProperty("IPTC:City");
    expect(tags).toMatchObject({ "IFD0:Make": "ExampleMake", "IFD0:Artist": "Exif Artist", "XMP-iptcCore:CreatorCity": "Creator City" });
  }, TOOL_TIMEOUT_MS);

  it("keeps the old asset by default, and deletes it only when asked, after its medium moved", async () => {
    const files = { "a.jpg": await fixture(400, 200) };
    const plan = planOf(files);
    const kept = portOf(files);
    await runLegacyImageReupload(plan, new Set(), kept.port, tool, { yes: true, approvedDigest: reuploadApprovalDigest(plan.planned, new Set()) });
    expect(kept.deletions).toEqual([]);
    const order: string[] = [];
    const removing = portOf(files, { patchAsset: async () => { order.push("patch"); }, deleteAsset: async () => { order.push("delete"); } });
    const result = await runLegacyImageReupload(plan, new Set(), removing.port, tool, { yes: true, deleteReplaced: true, approvedDigest: reuploadApprovalDigest(plan.planned, new Set(), true) });
    expect(order).toEqual(["patch", "delete"]);
    expect(result).toMatchObject({ deleted: 1, keptReferenced: 0 });
  }, TOOL_TIMEOUT_MS);

  it("leaves an old asset something still refers to, and surfaces any other failure", async () => {
    const files = { "a.jpg": await fixture(400, 200) };
    const plan = planOf(files);
    const digest = reuploadApprovalDigest(plan.planned, new Set(), true);
    const referenced = portOf(files, { deleteAsset: async () => { throw Object.assign(new Error("x"), { status: 409 }); } });
    expect(await runLegacyImageReupload(plan, new Set(), referenced.port, tool, { yes: true, deleteReplaced: true, approvedDigest: digest })).toMatchObject({ outcome: "written", written: 1, deleted: 0, keptReferenced: 1 });
    const broken = portOf(files, { deleteAsset: async () => { throw Object.assign(new Error("server"), { status: 500 }); } });
    await expect(runLegacyImageReupload(plan, new Set(), broken.port, tool, { yes: true, deleteReplaced: true, approvedDigest: digest })).rejects.toThrow("server");
  }, TOOL_TIMEOUT_MS);

  it("skips a medium already holding the prepared asset, so a repeat writes nothing", async () => {
    const files = { "a.jpg": await fixture(400, 200) };
    const first = portOf(files);
    const plan = planOf(files);
    await runLegacyImageReupload(plan, new Set(), first.port, tool, { yes: true, approvedDigest: reuploadApprovalDigest(plan.planned, new Set()) });
    const done = { ...plan, planned: [{ ...plan.planned[0], assetRef: first.patches[0].assetId }] };
    const second = portOf(files);
    const result = await runLegacyImageReupload(done, new Set(), second.port, tool, { yes: true, approvedDigest: reuploadApprovalDigest(done.planned, new Set()) });
    expect(result).toMatchObject({ alreadyDone: 1, written: 0 });
    expect(second.patches).toEqual([]);
  }, TOOL_TIMEOUT_MS);

  it("reports a changed source and a dimension mismatch per medium, and continues", async () => {
    const files = { "a.jpg": await fixture(400, 200), "b.jpg": await fixture(300, 200) };
    const plan = planOf(files);
    const changed = portOf({ ...files, "a.jpg": await fixture(401, 200) });
    const result = await runLegacyImageReupload(plan, new Set(), changed.port, tool);
    expect(result.failed).toEqual([{ mediaId: "a.jpg", code: "SOURCE_CHANGED" }]);
    expect(result.prepared).toBe(1);
    const digest = reuploadApprovalDigest(plan.planned, new Set());
    const wrong = portOf(files, { upload: async () => ({ assetId: "x", width: 1, height: 1 }) });
    const uploaded = await runLegacyImageReupload(plan, new Set(), wrong.port, tool, { yes: true, approvedDigest: digest });
    expect(uploaded.failed.map((entry) => entry.code)).toEqual(["UPLOADED_DIMENSIONS_DIFFER", "UPLOADED_DIMENSIONS_DIFFER"]);
    expect(wrong.patches).toEqual([]);
  }, TOOL_TIMEOUT_MS);

  it("stops on a conflict rather than overwriting an edit, and surfaces anything else", async () => {
    const files = { "a.jpg": await fixture(400, 200), "b.jpg": await fixture(300, 200) };
    const plan = planOf(files);
    const digest = reuploadApprovalDigest(plan.planned, new Set());
    const conflicting = portOf(files, { patchAsset: async () => { throw Object.assign(new Error("x"), { status: 409 }); } });
    expect(await runLegacyImageReupload(plan, new Set(), conflicting.port, tool, { yes: true, approvedDigest: digest })).toMatchObject({ outcome: "conflict", written: 0 });
    expect(conflicting.uploads).toHaveLength(1);
    const failing = portOf(files, { patchAsset: async () => { throw Object.assign(new Error("server"), { status: 500 }); } });
    await expect(runLegacyImageReupload(plan, new Set(), failing.port, tool, { yes: true, approvedDigest: digest })).rejects.toThrow("server");
  }, TOOL_TIMEOUT_MS);
});

describe("a block left with nothing real in it", () => {
  it("does not count its housekeeping as lost metadata", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "reupload-only-keywords-"));
    try {
      const file = path.join(directory, "fixture.jpg");
      await writeFile(file, await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "red" } }).jpeg().toBuffer());
      await tool.write(file, {}, { writeArgs: ["-overwrite_original", "-IPTC:Keywords=only term"] });
      const { bytes } = await prepareJpegForImport(new Uint8Array(await readFile(file)), tool);
      expect(inspectJpegImportFacts(bytes).keywordMetadata).toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, TOOL_TIMEOUT_MS);
});

describe("the command line", () => {
  it("needs a plan, a root, an output and an approved digest to write", () => {
    expect(() => parseArguments(["--plan", "p"])).toThrow("ARGUMENTS_INVALID");
    expect(() => parseArguments(["--plan", "p", "--image-root", "r", "--out", "o", "--yes"])).toThrow("APPROVED_DIGEST_REQUIRED");
    expect(parseArguments(["--plan", "p", "--image-root", "r", "--out", "o"])).toMatchObject({ plan: "p", yes: false });
  });

  it("keeps a locator inside the image root", () => {
    expect(resolveSource("/root", "a/b.jpg")).toBe(path.resolve("/root/a/b.jpg"));
    expect(() => resolveSource("/root", "../outside.jpg")).toThrow("outside");
    expect(() => resolveSource("/root", "/etc/passwd")).toThrow("outside");
  });
});
