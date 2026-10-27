import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { buildLegacyImportPlan } from "./legacy-delivery-import-plan.mts";

const exec = promisify(execFile), folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function fixture() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "legacy-asset-cli-")); folders.push(dir);
  const source = { version: 1, target: { projectId: "synthetic-project", dataset: "production" },
    sourceEvidence: { backupSha256: "a".repeat(64), availabilitySha256: "b".repeat(64), orderingSha256: "c".repeat(64), inventorySha256: "d".repeat(64) },
    excludedLegacyIds: [], galleries: [{ legacyId: 1, handle: "1".repeat(32), legacyPath: "/synthetic", availability: { mode: "indefinite" },
      images: [{ sourceLocator: "images/fixture.jpg", sha1: "1".repeat(40), sha256: "1".repeat(64), bytes: 20, width: 3, height: 2, orientation: 1, alt: "" }], zip: null }] };
  const plan = buildLegacyImportPlan(source, Date.now());
  const bindings = { version: 1, target: source.target, reviewDigest: plan.reviewDigest, assets: [{ sourceSha256: "1".repeat(64), assetId: `image-${"1".repeat(40)}-3x2-jpg`,
    sha1: "1".repeat(40), bytes: 20, width: 3, height: 2, orientation: 1, mimeType: "image/jpeg" }] };
  const input = path.join(dir, "source.json"), bound = path.join(dir, "bindings.json"), out = path.join(dir, "receipt.json");
  await writeFile(input, JSON.stringify(plan), { mode: 0o600 }); await writeFile(bound, JSON.stringify(bindings), { mode: 0o600 });
  return { dir, input, bound, out, digest: plan.reviewDigest };
}
function run(f: Awaited<ReturnType<typeof fixture>>, out = f.out) {
  return exec(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", path.resolve("scripts/verify-legacy-delivery-assets.mts"), "--plan", f.input, "--bindings", f.bound,
    "--approved-digest", f.digest, "--out", out], { env: { ...process.env, LANG: "C", LC_ALL: "C" }, timeout: 15_000 });
}
describe("legacy asset operator filesystem boundary", () => {
  it("defaults to offline declarations and reserves a new private receipt", async () => {
    const f = await fixture(), result = await run(f);
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "plan-only", checkedAssets: 0 });
    expect(JSON.parse(await readFile(f.out, "utf8"))).toMatchObject({ status: "plan-only", checkedAssets: 0 });
    // The synthetic project cannot supply real assets; success proves no live fetch.
    await expect(run(f)).rejects.toThrow();
    expect(JSON.parse(await readFile(f.out, "utf8")).status).toBe("plan-only");
  });
  it("refuses readable-by-others input and directory permissions", async () => {
    const f = await fixture(); await chmod(f.input, 0o644); await expect(run(f)).rejects.toThrow();
    await chmod(f.input, 0o600); await chmod(f.dir, 0o755); await expect(run(f)).rejects.toThrow();
  });
  it("refuses symlinked source and output without replacing either target", async () => {
    const f = await fixture(), original = await readFile(f.input); const link = path.join(f.dir, "source-link.json");
    await symlink(f.input, link); await expect(run({ ...f, input: link })).rejects.toThrow();
    await symlink(f.input, f.out); await expect(run(f)).rejects.toThrow(); expect(await readFile(f.input)).toEqual(original);
  });
  it("refuses non-ignored repository output even in an owner-only directory", async () => {
    const f = await fixture(); await exec("git", ["init", f.dir]); await expect(run(f)).rejects.toThrow();
    await writeFile(path.join(f.dir, ".gitignore"), "receipt.json\n"); expect(JSON.parse((await run(f)).stdout).status).toBe("plan-only");
  });
  it("refuses malformed UTF-8 and stale source digests before reserving output", async () => {
    const f = await fixture(); await expect(run({ ...f, digest: "0".repeat(64) })).rejects.toThrow();
    await writeFile(f.input, Buffer.from([0xff])); await expect(run(f)).rejects.toThrow(); await expect(readFile(f.out)).rejects.toThrow();
  });
});
