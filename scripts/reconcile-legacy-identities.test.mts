import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmod, link, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { digest } from "./identity-retirement-reconciliation.mts";
import { main, parseArguments } from "./reconcile-legacy-identities.mts";

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await Promise.all(folders.splice(0).map(folder => rm(folder, { recursive: true, force: true }))); });
async function inputs() {
  const folder = await mkdtemp(path.join(os.tmpdir(), "identity-reconciliation-test-")); folders.push(folder);
  await chmod(folder, 0o700);
  const baseline = Buffer.from('{"_id":"category","_rev":"r1","_type":"category","categoryId":"joomla-category-1"}\n');
  const map = Buffer.from(JSON.stringify({ version: "ab257-private-proposal-v1", writable: false, snapshotSha256: digest(baseline),
    mapping: [{ field: "categoryId", oldId: "joomla-category-1", newId: "category-trips" }],
    proposedChanges: [{ documentId: "category", expectedRevision: "r1", fields: { categoryId: { before: "joomla-category-1", after: "category-trips" } } }] }));
  const approval = Buffer.from(JSON.stringify({ candidateFileSha256: digest(map), snapshotFileSha256: digest(baseline), productionWriteApproved: false,
    acceptedScope: { contentId: 0, categoryId: 1, endGalleryId: 0, placementId: 0, totalDomainIdentities: 1, documents: 1, fieldChanges: 1, retainSanityDocumentIds: true, retainSanityReferences: true } }));
  const args: string[] = [];
  for (const [name, bytes] of [["map", map], ["approval", approval], ["baseline", baseline], ["snapshot", baseline]] as const) {
    const filename = path.join(folder, name); await writeFile(filename, bytes, { mode: 0o600 }); args.push(`--${name}`, filename);
  }
  const out = path.join(folder, "reports"); args.push("--approved-digest", digest(map), "--out", out);
  return { folder, out, args, map, baseline };
}
describe("offline reconciliation CLI", () => {
  it("rejects missing, unknown and repeated arguments", () => {
    for (const args of [[], ["--map"], ["--yes"], ["--map", "a", "--map", "b"], ["value", "a"]]) expect(() => parseArguments(args)).toThrow(/ARGUMENTS/u);
  });
  it("writes a private non-writable report with counts-only console output", async () => {
    vi.stubEnv("LC_ALL", "fi_FI.UTF-8");
    const f = await inputs(), log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(f.args)).toBe(0);
    const report = JSON.parse(await readFile(path.join(f.out, "identity-reconciliation-report.json"), "utf8"));
    expect(report.status).toBe("consistent-old"); expect(report.writable).toBe(false); expect(report.cutoverReady).toBe(false);
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/joomla|category-trips|identity-reconciliation-test/u);
    await expect(main(f.args)).rejects.toThrow("OUTPUT_EXISTS_OR_UNAVAILABLE");
    expect(await readFile(path.join(f.folder, "map"))).toEqual(f.map);
  });
  it.each(["symlink", "hardlink"])("never overwrites an input through an output %s", async kind => {
    const f = await inputs();
    const { mkdir } = await import("node:fs/promises"); await mkdir(f.out, { mode: 0o700 });
    const output = path.join(f.out, "identity-reconciliation-report.json");
    if (kind === "symlink") await symlink(path.join(f.folder, "map"), output); else await link(path.join(f.folder, "map"), output);
    await expect(main(f.args)).rejects.toThrow("OUTPUT_EXISTS_OR_UNAVAILABLE");
    expect(await readFile(path.join(f.folder, "map"))).toEqual(f.map);
  });
  it("resolves directory symlinks before checking input aliases", async () => {
    const f = await inputs(), alias = path.join(f.folder, "alias"); await symlink(f.folder, alias, "dir"); f.args[f.args.length - 1] = alias;
    await expect(main(f.args)).rejects.toThrow("OUTPUT_INPUT_ALIAS");
  });
  it("requires Git checkout reports to be ignored", async () => {
    const f = await inputs(); execFileSync("git", ["init", "-q", f.folder]);
    await expect(main(f.args)).rejects.toThrow("OUTPUT_NOT_IGNORED");
    await writeFile(path.join(f.folder, ".gitignore"), "reports/\n");
    vi.spyOn(console, "log").mockImplementation(() => {}); expect(await main(f.args)).toBe(0);
  });
  it.skipIf(process.platform === "win32")("fails closed on Git errors other than absence of a checkout", async () => {
    const f = await inputs();
    const git = path.join(f.folder, "git");
    await writeFile(git, '#!/bin/sh\nprintf "fatal: detected dubious ownership in repository\\n" >&2\nexit 128\n', { mode: 0o700 });
    const script = fileURLToPath(new URL("./reconcile-legacy-identities.mts", import.meta.url));
    try { execFileSync(process.execPath, [script, ...f.args], { env: { PATH: f.folder, NODE_ENV: "test" }, encoding: "utf8", stdio: "pipe" }); expect.fail("expected closed Git check"); }
    catch (error) { expect((error as { stderr: string }).stderr.trim()).toBe("OUTPUT_GIT_CHECK_FAILED"); }
    await expect(readFile(path.join(f.out, "identity-reconciliation-report.json"))).rejects.toThrow();
  });
  it("uses exit 2 for blockers and exit 1 with a static redacted IO error", async () => {
    const f = await inputs();
    await writeFile(path.join(f.folder, "snapshot"), f.baseline.toString().replace('"r1"', '"r2"'));
    vi.spyOn(console, "log").mockImplementation(() => {}); expect(await main(f.args)).toBe(2);
    const script = fileURLToPath(new URL("./reconcile-legacy-identities.mts", import.meta.url));
    const args = [...f.args]; args[1] = path.join(f.folder, "synthetic-private-source-missing");
    try { execFileSync(process.execPath, [script, ...args], { env: { PATH: process.env.PATH, NODE_ENV: "test" }, encoding: "utf8", stdio: "pipe" }); expect.fail("expected redacted failure"); }
    catch (error) {
      const result = error as { status: number; stderr: string };
      expect(result.status).toBe(1); expect(result.stderr.trim()).toBe("RECONCILIATION_IO_FAILED");
    }
  });
});
