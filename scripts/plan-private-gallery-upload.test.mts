import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, symlink, link, stat, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { runPrivateUploadSourcePlanner, parsePrivateUploadArguments } from "./plan-private-gallery-upload.mts";
const CLI = fileURLToPath(new URL("./plan-private-gallery-upload.mts", import.meta.url));
let root: string, sources: string, input: string, output: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "photosite-private-source-"));
  await chmod(root, 0o700);
  sources = path.join(root, "sources"); await mkdir(sources, { mode: 0o700 });
  input = path.join(root, "input.json"); output = path.join(root, "out");
  await writeFile(path.join(sources, "IMG_0001.JPG"), await sharp({ create: { width: 12, height: 8, channels: 3, background: "#777777" } }).jpeg().toBuffer());
  await writeFile(path.join(sources, "delivery.zip"), Buffer.from("504b030400000000", "hex")); // Signature only; deliberately not a valid ZIP.
  await writeFile(input, JSON.stringify({ mode: "proof", externallyWatermarked: true, images: [{ relativePath: "IMG_0001.JPG", mediaId: "media-1" }] }), { mode: 0o600 });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const options = () => ({ input, sourceRoot: sources, out: output });
describe("offline private upload source CLI", () => {
  it("runs directly on the pinned Node without server-only/alias loaders and saves only a private plan", async () => {
    const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI, "--input", input, "--source-root", sources, "--out", output], { encoding: "utf8" });
    expect(result.status, result.stderr).toBe(0);
    const report = JSON.parse(await readFile(path.join(output, "upload-source-plan.json"), "utf8"));
    expect(report.manifest).toMatchObject([{ filename: "IMG_0001.JPG", mediaId: "media-1", width: 12, height: 8 }]);
    expect(result.stdout).not.toContain("IMG_"); expect(result.stdout).not.toContain(root);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "planned-offline", objects: 1, digest: report.digest });
    expect((await stat(output)).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(output, "upload-source-plan.json"))).mode & 0o777).toBe(0o600);
    expect(report.localAssets[0].sha256).toMatch(/^[a-f0-9]{64}$/);
    const second = await runPrivateUploadSourcePlanner({ ...options(), out: path.join(root, "second") });
    expect(second.digest).toBe(report.digest);
  });
  it("only recognizes ZIP signature and makes no archive/content verification claim", async () => {
    await writeFile(input, JSON.stringify({ mode: "delivery", images: [{ relativePath: "IMG_0001.JPG" }], zipPath: "delivery.zip" }));
    const report = await runPrivateUploadSourcePlanner(options());
    expect(report.manifest.at(-1)).toEqual({ kind: "zip", nominalBytes: 8 });
    expect(report.checks.zip).toBe("signature-only-no-entry-or-crc-verification");
  });
  it("rejects a truncated JPEG even when its intact header still reports valid dimensions", async () => {
    const full = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#777777" } }).jpeg().toBuffer();
    const truncated = full.subarray(0, Math.floor(full.length / 2));
    expect(await sharp(truncated, { failOn: "error" }).metadata()).toMatchObject({ format: "jpeg", width: 800, height: 600 });
    await writeFile(path.join(sources, "IMG_0001.JPG"), truncated);
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "INVALID_MEDIA", ordinal: 1 });
    expect(await readFile(path.join(sources, "IMG_0001.JPG"))).toEqual(truncated);
  });
  it("rejects warning-grade scan corruption in a native-size JPEG and accepts the untouched bytes", async () => {
    const clean = await sharp({ create: { width: 800, height: 600, channels: 3, background: "#777777" } }).jpeg().toBuffer();
    const corrupt = Buffer.from(clean);
    for (let i = 2000; i < Math.min(2400, corrupt.length); i++) corrupt[i] ^= 0xff;
    expect(corrupt.equals(clean)).toBe(false);
    // The corruption is warning-grade: a failOn "error" decode still accepts it, so only failOn "warning" protects.
    const tolerant = sharp(corrupt, { failOn: "error" });
    expect(await tolerant.metadata()).toMatchObject({ format: "jpeg", width: 800, height: 600 });
    await expect(sharp(corrupt, { failOn: "error" }).stats()).resolves.toBeDefined();
    await expect(sharp(corrupt, { failOn: "warning" }).stats()).rejects.toThrow();
    await writeFile(path.join(sources, "IMG_0001.JPG"), clean);
    const planned = await runPrivateUploadSourcePlanner({ ...options(), out: path.join(root, "clean") });
    expect(planned.manifest).toMatchObject([{ filename: "IMG_0001.JPG", width: 800, height: 600 }]);
    await writeFile(path.join(sources, "IMG_0001.JPG"), corrupt);
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "INVALID_MEDIA", ordinal: 1 });
    const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI, "--input", input, "--source-root", sources, "--out", output], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("[private-upload-source] INVALID_MEDIA item=1");
    expect(await readdir(output).catch(() => [])).not.toContain("upload-source-plan.json");
    expect(await readFile(path.join(sources, "IMG_0001.JPG"))).toEqual(corrupt);
  });
  it("refuses symlink escapes and hardlink aliases before producing a result", async () => {
    await symlink(input, path.join(sources, "escape.JPG"));
    await writeFile(input, JSON.stringify({ mode: "proof", externallyWatermarked: true, images: [{ relativePath: "escape.JPG", mediaId: "media-1" }] }));
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "SOURCE_ROOT_ESCAPE" });
    await link(path.join(sources, "IMG_0001.JPG"), path.join(sources, "alias.JPG"));
    await writeFile(input, JSON.stringify({ mode: "proof", externallyWatermarked: true, images: [
      { relativePath: "IMG_0001.JPG", mediaId: "media-1" }, { relativePath: "alias.JPG", mediaId: "media-2" },
    ] }));
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "DUPLICATE_SOURCE", ordinal: 2 });
    expect(await readdir(output)).toEqual([]);
  });
  it.each(["format", "orientation", "size", "corrupt"])("refuses %s without printing private paths or native errors", async (fault) => {
    const canary = "PRIVATE-SOURCE-CANARY.JPG";
    let bytes: Buffer;
    if (fault === "format") bytes = await sharp({ create: { width: 12, height: 8, channels: 3, background: "#777777" } }).png().toBuffer();
    else if (fault === "orientation") bytes = await sharp(path.join(sources, "IMG_0001.JPG")).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    else if (fault === "size") bytes = Buffer.alloc(8 * 1024 ** 2 + 1);
    else bytes = Buffer.from("not a JPEG private error canary");
    await writeFile(path.join(sources, canary), bytes);
    await writeFile(input, JSON.stringify({ mode: "proof", externallyWatermarked: true, images: [{ relativePath: canary, mediaId: "media-1" }] }));
    const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI, "--input", input, "--source-root", sources, "--out", output], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).not.toContain(canary);
    expect(result.stdout + result.stderr).not.toContain(root);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toMatch(/^\[private-upload-source\] (INVALID_MEDIA|INVALID_SIZE) item=1$/);
  });
  it("requires owner-private input and output and refuses overwrite atomically", async () => {
    await chmod(input, 0o644);
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "PRIVATE_PERMISSIONS" });
    await chmod(input, 0o600);
    await runPrivateUploadSourcePlanner(options());
    const saved = await readFile(path.join(output, "upload-source-plan.json"));
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "OUTPUT_EXISTS" });
    expect(await readFile(path.join(output, "upload-source-plan.json"))).toEqual(saved);
    expect(await readdir(output)).toEqual(["upload-source-plan.json"]);
    await chmod(output, 0o755);
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "PRIVATE_PERMISSIONS" });
  });
  it("refuses malformed UTF-8 and arbitrary arguments with redacted errors", async () => {
    await writeFile(input, Buffer.from([0xff, 0xfe]));
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "INVALID_INPUT" });
    for (const args of [[], ["--input"], ["--unknown", "secret-canary"], ["--input", "x", "--input", "y"]]) {
      expect(() => parsePrivateUploadArguments(args)).toThrow("INVALID_ARGUMENTS");
    }
  });
  it("refuses both tracked and nonignored repository artifacts", async () => {
    expect(spawnSync("git", ["-C", root, "init"], { encoding: "utf8" }).status).toBe(0);
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "ARTIFACT_NOT_IGNORED" });
    expect(spawnSync("git", ["-C", root, "add", "input.json"], { encoding: "utf8" }).status).toBe(0);
    await expect(runPrivateUploadSourcePlanner(options())).rejects.toMatchObject({ code: "ARTIFACT_TRACKED" });
  });
});
