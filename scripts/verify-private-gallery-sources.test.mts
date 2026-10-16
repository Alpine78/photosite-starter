import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, readdir, stat, symlink, link, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { runPrivateUploadSourcePlanner } from "./plan-private-gallery-upload.mts";
import { runPrivateSourceVerification, parsePrivateSourceVerificationArguments } from "./verify-private-gallery-sources.mts";
const CLI = fileURLToPath(new URL("./verify-private-gallery-sources.mts", import.meta.url));
let root: string, sources: string, input: string, plan: string, expectedDigest: string;
const options = () => ({ plan, sourceRoot: sources, expectedDigest });
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "photosite-source-verification-")); await chmod(root, 0o700);
  sources = path.join(root, "sources"); await mkdir(sources, { mode: 0o700 });
  await writeFile(path.join(sources, "IMG_0001.JPG"), await sharp({ create: { width: 12, height: 8, channels: 3, background: "#777777" } }).jpeg().toBuffer());
  input = path.join(root, "input.json");
  await writeFile(input, JSON.stringify({ mode: "proof", externallyWatermarked: true,
    images: [{ relativePath: "IMG_0001.JPG", mediaId: "media-1" }] }), { mode: 0o600 });
  const report = await runPrivateUploadSourcePlanner({ input, sourceRoot: sources, out: path.join(root, "plans") });
  plan = path.join(root, "plans/upload-source-plan.json"); expectedDigest = report.digest;
});
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
describe("read-only private source verifier", () => {
  it("runs on native Node with a cleared environment, fixed caveats and no file changes", async () => {
    const paths = [plan, input, path.join(sources, "IMG_0001.JPG")];
    const before = await Promise.all(paths.map(async (p) => ({ bytes: await readFile(p), modified: (await stat(p)).mtimeMs })));
    const names = await readdir(root, { recursive: true });
    const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI, "--plan", plan, "--source-root", sources, "--expected-digest", expectedDigest],
      { encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" } });
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "verified-offline", objects: 1, digest: expectedDigest,
      checks: { watermarks: "owner-attested-not-detected", zip: "not-applicable", freshness: "verification-read-only-no-upload-lease", remote: "not-contacted" } });
    expect(result.stdout + result.stderr).not.toContain(root);
    expect(result.stdout + result.stderr).not.toContain("IMG_0001");
    const command = spawnSync("npm", ["run", "verify:private-upload-sources", "--silent", "--", "--plan", plan,
      "--source-root", sources, "--expected-digest", expectedDigest], { encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" } });
    expect(command.status, command.stderr).toBe(0);
    expect(JSON.parse(command.stdout).digest).toBe(expectedDigest);
    expect(command.stdout + command.stderr).not.toContain(root);
    expect(await readdir(root, { recursive: true })).toEqual(names);
    expect(await Promise.all(paths.map(async (p) => ({ bytes: await readFile(p), modified: (await stat(p)).mtimeMs })))).toEqual(before);
  });
  it("accepts copied/restored identical bytes without pinning old inode identity", async () => {
    const file = path.join(sources, "IMG_0001.JPG"); await copyFile(file, file + ".copy");
    await rm(file); await copyFile(file + ".copy", file);
    expect(await runPrivateSourceVerification(options())).toMatchObject({ status: "verified-offline" });
  });
  it("refuses a same-size valid JPEG edit by hash and redacts CLI errors", async () => {
    const file = path.join(sources, "IMG_0001.JPG"), bytes = await readFile(file);
    // Append a valid trailing byte before planning, then change only that byte.
    await writeFile(file, Buffer.concat([bytes, Buffer.from([1])]));
    const report = await runPrivateUploadSourcePlanner({ input, sourceRoot: sources, out: path.join(root, "second") });
    plan = path.join(root, "second/upload-source-plan.json"); expectedDigest = report.digest;
    await writeFile(file, Buffer.concat([bytes, Buffer.from([2])]));
    const result = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI, "--plan", plan, "--source-root", sources, "--expected-digest", expectedDigest], { encoding: "utf8" });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("[private-upload-source] SOURCE_CHANGED item=1");
    expect(result.stderr).not.toContain(root);
  });
  it("validates the complete plan and pin before touching a missing source root", async () => {
    const report = JSON.parse(await readFile(plan, "utf8")); report.checks.zip = "verified";
    await writeFile(plan, JSON.stringify(report));
    await expect(runPrivateSourceVerification({ ...options(), sourceRoot: path.join(root, "does-not-exist") })).rejects.toMatchObject({ code: "INVALID_PLAN" });
    await writeFile(plan, Buffer.from([0xff, 0xfe]));
    await expect(runPrivateSourceVerification(options())).rejects.toMatchObject({ code: "INVALID_PLAN" });
  });
  it("refuses a changed ZIP and retains the signature-only integrity limit", async () => {
    const zip = path.join(sources, "delivery.zip"); await writeFile(zip, Buffer.from("504b030400000000", "hex"));
    await writeFile(input, JSON.stringify({ mode: "delivery", images: [{ relativePath: "IMG_0001.JPG" }], zipPath: "delivery.zip" }));
    const report = await runPrivateUploadSourcePlanner({ input, sourceRoot: sources, out: path.join(root, "delivery") });
    plan = path.join(root, "delivery/upload-source-plan.json"); expectedDigest = report.digest;
    expect(await runPrivateSourceVerification(options())).toMatchObject({ checks: { zip: "signature-only-no-entry-or-crc-verification" } });
    await writeFile(zip, Buffer.from("504b030400000001", "hex"));
    await expect(runPrivateSourceVerification(options())).rejects.toMatchObject({ code: "SOURCE_CHANGED", ordinal: 2 });
  });
  it("refuses source symlinks and hardlink aliases without weakening the parent's policy", async () => {
    const file = path.join(sources, "IMG_0001.JPG"); await writeFile(input, JSON.stringify({ mode: "proof", externallyWatermarked: true,
      images: [{ relativePath: "IMG_0001.JPG", mediaId: "media-1" }, { relativePath: "copy.JPG", mediaId: "media-2" }] }));
    await copyFile(file, path.join(sources, "copy.JPG"));
    const report = await runPrivateUploadSourcePlanner({ input, sourceRoot: sources, out: path.join(root, "pair") });
    plan = path.join(root, "pair/upload-source-plan.json"); expectedDigest = report.digest;
    await rm(path.join(sources, "copy.JPG")); await link(file, path.join(sources, "copy.JPG"));
    await expect(runPrivateSourceVerification(options())).rejects.toMatchObject({ code: "DUPLICATE_SOURCE", ordinal: 2 });
    await rm(path.join(sources, "copy.JPG")); await symlink(file, path.join(sources, "copy.JPG"));
    await expect(runPrivateSourceVerification(options())).rejects.toMatchObject({ code: "PATH_SYMLINK", ordinal: 2 });
  });
  it("requires private report permissions and closed CLI flags", async () => {
    await chmod(plan, 0o644);
    await expect(runPrivateSourceVerification(options())).rejects.toMatchObject({ code: "PRIVATE_PERMISSIONS" });
    for (const args of [[], ["--plan"], ["--unknown", "private-canary"], ["--plan", "x", "--plan", "y"],
      ["--plan=x", "x"], ["--plan", "x", "--source-root", "x", "--expected-digest", "A".repeat(64)]]) {
      expect(() => parsePrivateSourceVerificationArguments(args)).toThrow("INVALID_ARGUMENTS");
    }
  });
  it("refuses an oversized report before accessing any source path", async () => {
    await writeFile(plan, Buffer.alloc(4 * 1024 * 1024 + 1, 0x20));
    await expect(runPrivateSourceVerification({ ...options(), sourceRoot: path.join(root, "missing") })).rejects.toMatchObject({ code: "INVALID_SIZE" });
  });
});
