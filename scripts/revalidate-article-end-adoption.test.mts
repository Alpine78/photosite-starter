import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, open, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adoptionFixture } from "./article-end-adoption-fixture.mts";
import { planArticleEndAdoption } from "./article-end-adoption-plan.mts";
import { main } from "./revalidate-article-end-adoption.mts";

const folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
const script = fileURLToPath(new URL("./revalidate-article-end-adoption.mts", import.meta.url));
const native = (args: string[]) => spawnSync(process.execPath, [script, ...args], {
  encoding: "utf8", env: { PATH: process.env.PATH, NODE_ENV: "test" },
});
async function fixture() {
  const f = adoptionFixture(), baseline = f.input(), baselinePlan = planArticleEndAdoption(baseline);
  f.documents.push({ _id: "unrelated-note", _type: "note", _rev: "n1" });
  f.manifest.snapshot.observedAt = "2026-01-02T00:00:00.000Z";
  const current = f.input(), currentPlan = planArticleEndAdoption(current);
  const folder = await mkdtemp(path.join(tmpdir(), "adoption-revalidation-test-")); folders.push(folder); await chmod(folder, 0o700);
  const paths = Object.fromEntries(["baseline-manifest", "baseline-snapshot", "current-manifest", "current-snapshot"]
    .map(name => [name, path.join(folder, name)]));
  for (const [name, bytes] of [["baseline-manifest", baseline.manifest], ["baseline-snapshot", baseline.snapshot],
    ["current-manifest", current.manifest], ["current-snapshot", current.snapshot]] as const) {
    await writeFile(paths[name], bytes, { mode: 0o600 });
  }
  const out = path.join(folder, "out");
  const args = Object.entries({ ...paths, "baseline-digest": baselinePlan.planSha256, out }).flatMap(([key, value]) => ["--" + key, value]);
  return { folder, paths, out, args, baseline, current, baselinePlan, currentPlan };
}

describe("private native Node revalidation CLI", () => {
  it("writes the correct private evidence without source logging or overwriting", async () => {
    const f = await fixture(), result = native(f.args);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(0); expect(result.stderr).toBe("");
    const filename = path.join(f.out, "revalidation.json"), bytes = await readFile(filename), evidence = JSON.parse(bytes.toString());
    expect(evidence.baselinePlanSha256).toBe(f.baselinePlan.planSha256);
    expect(evidence.currentPlanSha256).toBe(f.currentPlan.planSha256); expect(evidence.plan).toEqual(f.currentPlan);
    expect(evidence).toMatchObject({ scopeUnchanged: true, writable: false, approved: false, backup: false });
    expect((await stat(f.out)).mode & 0o777).toBe(0o700); expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(result.stdout)).toMatchObject({ evidenceSha256: evidence.evidenceSha256, changes: 3, writable: false, approved: false });
    expect(result.stdout).not.toMatch(/article-fi|source-a|photograph-one|unrelated-note|adoption-revalidation-test/);
    const retry = native(f.args); expect(retry.status).toBe(1); expect(retry.stderr.trim()).toBe("REVALIDATION_INPUT_OR_OUTPUT_FAILED");
    expect(await readFile(filename)).toEqual(bytes);
    expect(await readFile(f.paths["baseline-manifest"])).toEqual(f.baseline.manifest);
    expect(await readFile(f.paths["current-snapshot"])).toEqual(f.current.snapshot);
  });
  it("preserves partial private evidence when the actual file write fails", async () => {
    const f = await fixture();
    const handle = await open(path.join(f.folder, "prototype-probe"), "wx", 0o600);
    const prototype = Object.getPrototypeOf(handle), original = handle.writeFile;
    await handle.close();
    const failure = vi.spyOn(prototype, "writeFile").mockImplementationOnce(async function (this: typeof handle) {
      await original.call(this, "partial synthetic evidence");
      throw new Error("forced synthetic write failure");
    });
    try { await expect(main(f.args)).rejects.toThrow("REVALIDATION_INPUT_OR_OUTPUT_FAILED"); }
    finally { failure.mockRestore(); }
    const filename = path.join(f.out, "revalidation.json");
    expect(await readFile(filename, "utf8")).toBe("partial synthetic evidence");
    expect((await stat(f.out)).mode & 0o777).toBe(0o700);
    expect((await stat(filename)).mode & 0o777).toBe(0o600);
  });
  it("refuses malformed baseline data as a static side-specific error with no output", async () => {
    const f = await fixture(); await writeFile(f.paths["baseline-manifest"], '{"PRIVATE_RECORD":"unclosed');
    const result = native(f.args);
    expect(result.error).toBeUndefined(); expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr.trim()).toBe("BASELINE_PLAN_INVALID"); await expect(stat(f.out)).rejects.toThrow();
  });
  it("validates the digest before input IO and refuses ambiguous/apply flags", async () => {
    const f = await fixture(); await rm(f.paths["baseline-manifest"]);
    const args = [...f.args]; args[args.indexOf("--baseline-digest") + 1] = "BAD";
    const result = native(args); expect(result.status).toBe(1); expect(result.stderr.trim()).toBe("INVALID_BASELINE_PLAN_DIGEST");
    for (const invalid of [[], [...f.args, "--apply", "true"], [...f.args, "--out", f.out]]) {
      await expect(main(invalid)).rejects.toThrow("REVALIDATION_INPUT_OR_OUTPUT_FAILED");
    }
    await expect(stat(f.out)).rejects.toThrow();
  });
  it("protects Git-visible output and the exact tracked revalidation filename", async () => {
    const f = await fixture(); execFileSync("git", ["init", "-q", f.folder]);
    await expect(main(f.args)).rejects.toThrow("REVALIDATION_INPUT_OR_OUTPUT_FAILED");
    await writeFile(path.join(f.folder, ".gitignore"), "out/\n"); await mkdir(f.out);
    await writeFile(path.join(f.out, "revalidation.json"), "tracked synthetic evidence");
    execFileSync("git", ["-C", f.folder, "add", "-f", "out/revalidation.json"]);
    await rm(f.out, { recursive: true });
    await expect(main(f.args)).rejects.toThrow("REVALIDATION_INPUT_OR_OUTPUT_FAILED");
    await expect(stat(path.join(f.out, "revalidation.json"))).rejects.toThrow();
  });
});
