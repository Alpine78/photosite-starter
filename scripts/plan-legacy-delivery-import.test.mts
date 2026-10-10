import { createHash } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseArguments, runLegacyPlanner, type Options } from "./plan-legacy-delivery-import.mts";
import { MAX_INPUT_BYTES } from "./legacy-delivery-import-plan.mts";

let root: string, options: Options, image: Buffer, zip: Buffer;
const now = Date.parse("2026-10-10T12:00:00Z");
const hashes = (bytes: Buffer) => ({ sha1: createHash("sha1").update(bytes).digest("hex"),
  sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length });
function source() {
  return { version: 1, target: { projectId: "synthetic-project", dataset: "production" },
    sourceEvidence: { backupSha256: hashes(zip).sha256, availabilitySha256: "a".repeat(64),
      orderingSha256: "b".repeat(64), inventorySha256: "c".repeat(64) }, excludedLegacyIds: [3],
    galleries: [{ legacyId: 1, handle: "1".repeat(32), legacyPath: "/clients/synthetic",
      availability: { mode: "until", expiryInstant: "2027-01-07T22:00:00Z" },
      images: [{ sourceLocator: "photo.jpg", ...hashes(image), width: 12, height: 8, orientation: 1, alt: "" }],
      zip: { sourceLocator: "whole.zip", ...hashes(zip) } }] };
}
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "legacy-plan-test-"));
  const imageRoot = path.join(root, "images"); await mkdir(imageRoot);
  image = await sharp({ create: { width: 12, height: 8, channels: 3, background: "#777777" } }).jpeg().toBuffer();
  // Complete, synthetic empty ZIP; production source archives are never generated here.
  zip = Buffer.alloc(22); zip.write("PK\u0005\u0006", 0, "binary");
  options = { input: path.join(root, "source.json"), imageRoot,
    backup: path.join(root, "backup.zip"), out: path.join(root, "review") };
  await writeFile(path.join(imageRoot, "photo.jpg"), image);
  await writeFile(path.join(imageRoot, "whole.zip"), zip); await writeFile(options.backup, zip);
  await writeFile(options.input, JSON.stringify(source()), { mode: 0o600 });
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("offline source byte verification", () => {
  it("checks source/backup bytes and creates an exclusive private review result without changing inputs", async () => {
    const before = await readFile(options.input), plan = await runLegacyPlanner(options, () => now);
    const names = await readdir(options.out); expect(names).toEqual([`legacy-plan-${plan.reviewDigest}.json`]);
    expect(JSON.parse(await readFile(path.join(options.out, names[0]), "utf8"))).toEqual(plan);
    expect((await lstat(options.out)).mode & 0o777).toBe(0o700);
    expect((await lstat(path.join(options.out, names[0]))).mode & 0o777).toBe(0o600);
    expect(plan.verification.inputSha256).toBe(hashes(before).sha256);
    expect(plan.verification.receiptDigests).toBe("declared-not-independently-loaded");
    expect(plan.verification.zipCrc).toBe("not-checked"); expect(plan.verification.cms).toBe("not-contacted");
    expect(await readFile(options.input)).toEqual(before);
    expect(await readFile(path.join(options.imageRoot, "photo.jpg"))).toEqual(image);
    expect(await readFile(path.join(options.imageRoot, "whole.zip"))).toEqual(zip);
    const resultBefore = await readFile(path.join(options.out, names[0]));
    await expect(runLegacyPlanner(options, () => now + 1)).rejects.toThrow("LOCAL_IO_FAILED");
    expect(await readdir(options.out)).toEqual(names);
    expect(await readFile(path.join(options.out, names[0]))).toEqual(resultBefore);
  });
  it("rechecks a deadline crossed while verifying files", async () => {
    let calls = 0;
    await expect(runLegacyPlanner(options, () => calls++ === 0 ? now : Date.parse("2027-01-07T22:00:00Z"))).rejects.toThrow("GALLERY_EXPIRED");
    expect(await readdir(options.out)).toEqual([]);
  });
  it("preserves a backup with the standard PK00 single-segment marker", async () => {
    const marked = Buffer.concat([Buffer.from("PK00", "ascii"), zip]);
    const value = source(); value.sourceEvidence.backupSha256 = hashes(marked).sha256;
    await writeFile(options.backup, marked); await writeFile(options.input, JSON.stringify(value));
    const plan = await runLegacyPlanner(options, () => now);
    expect(plan.verification.backupBytes).toEqual({ sha256: hashes(marked).sha256, bytes: marked.length });
    expect(await readFile(options.backup)).toEqual(marked);
  });
  it.each(["image", "zip", "backup"])("blocks changed %s bytes without producing a plan", async (kind) => {
    if (kind === "image") await writeFile(path.join(options.imageRoot, "photo.jpg"), Buffer.concat([image, Buffer.from("changed")]));
    else await writeFile(kind === "zip" ? path.join(options.imageRoot, "whole.zip") : options.backup, Buffer.concat([zip, Buffer.from("changed")]));
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow(); expect(await readdir(options.out)).toEqual([]);
  });
  it("refuses correct hashes with false dimensions", async () => {
    const value = source(); value.galleries[0].images[0].width = 13;
    await writeFile(options.input, JSON.stringify(value));
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow("SOURCE_METADATA_MISMATCH:g0:i0");
    expect(await readdir(options.out)).toEqual([]);
  });
  it("refuses a correctly hashed non-JPEG image and EXIF orientation requiring rotation", async () => {
    for (const buffer of [await sharp(image).png().toBuffer(), await sharp(image).withMetadata({ orientation: 6 }).jpeg().toBuffer()]) {
      const value = source(); Object.assign(value.galleries[0].images[0], hashes(buffer));
      await writeFile(path.join(options.imageRoot, "photo.jpg"), buffer); await writeFile(options.input, JSON.stringify(value));
      await expect(runLegacyPlanner(options, () => now)).rejects.toThrow("SOURCE_METADATA_MISMATCH");
    }
  });
  it.each(["file", "directory", "backup", "input", "output"])("refuses %s symlinks", async (kind) => {
    const target = kind === "file" ? path.join(options.imageRoot, "photo.jpg") : kind === "directory" ? options.imageRoot :
      kind === "backup" ? options.backup : kind === "input" ? options.input : options.out;
    const moved = `${target}-actual`;
    if (kind === "output") await mkdir(moved, { mode: 0o700 });
    else { const { rename } = await import("node:fs/promises"); await rename(target, moved); }
    await symlink(moved, target);
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow(/PATH_SYMLINK|SOURCE_ROOT_ESCAPE/);
  });
  it.each([Buffer.from("{"), Buffer.from([0xff]), Buffer.from("\ufeff{}")])("rejects damaged input/BOM before output", async (buffer) => {
    await writeFile(options.input, buffer);
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow("INPUT_UTF8_OR_JSON");
    await expect(lstat(options.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("bounds raw input before parsing and refuses nonprivate input/output", async () => {
    await writeFile(options.input, Buffer.alloc(MAX_INPUT_BYTES + 1, 32));
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow("FILE_SIZE_OR_TYPE");
    await writeFile(options.input, JSON.stringify(source())); await chmod(options.input, 0o644);
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow("PRIVATE_PERMISSIONS");
    await chmod(options.input, 0o600); await mkdir(options.out, { mode: 0o755 });
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow("PRIVATE_PERMISSIONS");
  });
  it("requires repository-local artifacts to be untracked and ignored", async () => {
    const exec = promisify(execFile);
    await exec("git", ["init", "--quiet", root]);
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow("ARTIFACT_NOT_IGNORED");
    await writeFile(path.join(root, ".gitignore"), "source.json\nreview/\n");
    expect((await runLegacyPlanner(options, () => now)).counts.images).toBe(1);
    await exec("git", ["-C", root, "add", "-f", "source.json"]);
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow("ARTIFACT_TRACKED");
  });
  it("does not expose file paths or filesystem details through CLI failures", async () => {
    await rm(path.join(options.imageRoot, "photo.jpg"));
    const script = fileURLToPath(new URL("./plan-legacy-delivery-import.mts", import.meta.url));
    const args = [script, "--input", options.input, "--image-root", options.imageRoot, "--backup", options.backup, "--out", options.out];
    await expect(promisify(execFile)(process.execPath, args)).rejects.toMatchObject({
      stdout: "", stderr: "SOURCE_READ_FAILED:g0:i0\n",
    });
  });
  it("refuses a final-file-only ignore rule that would expose temporary private copies", async () => {
    await promisify(execFile)("git", ["init", "--quiet", root]);
    await writeFile(path.join(root, ".gitignore"), "source.json\nreview/legacy-plan-*.json\n");
    await expect(runLegacyPlanner(options, () => now)).rejects.toThrow("ARTIFACT_NOT_IGNORED");
    expect(await readdir(options.out)).toEqual([]);
  });
  it("accepts exactly four CLI options and rejects duplicates or values resembling flags", () => {
    expect(parseArguments(["--input", "a", "--image-root", "b", "--backup", "c", "--out", "d"]).input).toBe(path.resolve("a"));
    for (const args of [[], ["--input", "a", "--input", "b"], ["--input", "--yes"], ["--token", "secret"], ["--out"]])
      expect(() => parseArguments(args)).toThrow(/ARGUMENTS_/);
  });
});
