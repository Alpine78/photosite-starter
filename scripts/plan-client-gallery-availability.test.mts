import { afterEach, describe, expect, it, vi } from "vitest";
import { chmod, mkdtemp, readFile, rename, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { main } from "./plan-client-gallery-availability.mts";

const folders: string[] = [], at = "2026-10-17T00:00:00Z", secret = "a".repeat(32);
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "client-availability-")); folders.push(root); await chmod(root, 0o700);
  const snapshot = path.join(root, "snapshot.json"), intent = path.join(root, "intent.json");
  await writeFile(snapshot, JSON.stringify({ _id: "client-one", _type: "clientDeliveryGallery", _rev: "revision-one", handle: secret, available: false, availabilityMode: "indefinite", items: [{ _key: "one" }] }), { mode: 0o600 });
  await writeFile(intent, JSON.stringify({ available: true, availabilityMode: "indefinite" }), { mode: 0o600 });
  const out = path.join(root, "plan"), args = ["plan", "--snapshot", snapshot, "--intent", intent, "--at", at, "--out", out];
  return { root, snapshot, intent, out, args };
}
describe("private offline availability CLI", () => {
  it("plans then verifies private artifacts with fixed summaries and no remote operation", async () => {
    const f = await fixture(), log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(f.args)).toBe(0);
    const filename = path.join(f.out, "plan.json"), result = JSON.parse(await readFile(filename, "utf8"));
    expect((await stat(f.out)).mode & 0o777).toBe(0o700); expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect(JSON.stringify(log.mock.calls)).not.toContain(secret); expect(JSON.stringify(log.mock.calls)).not.toContain(f.root);
    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({ readyToWrite: false, cmsWritePerformed: false });
    const script = fileURLToPath(new URL("./plan-client-gallery-availability.mts", import.meta.url));
    const actual = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...f.args.map((arg) => arg === f.out ? path.join(f.root, "actual-cli") : arg)], { encoding: "utf8", timeout: 10_000 });
    expect(actual.status).toBe(0); expect(actual.stderr).toBe("");
    expect(JSON.parse(actual.stdout)).toMatchObject({ planSha256: result.planSha256, cmsWritePerformed: false });
    expect(await main(["verify", "--snapshot", f.snapshot, "--plan", filename, "--approved-digest", result.planSha256, "--at", at, "--out", path.join(f.root, "verified")])).toBe(0);
    expect(JSON.parse(await readFile(path.join(f.root, "verified", "verification.json"), "utf8"))).toMatchObject({ offlineOnly: true, readyToWrite: false, patch: result.patch });
  });
  it.each(["--apply", "--write", "--token", "--unexpected"])("refuses unknown or side-effect flag %s", async (flag) => {
    const f = await fixture(); await expect(main([...f.args, flag, "private-value"])).rejects.toThrow("INVALID_ARGUMENTS");
    await expect(stat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not overwrite evidence or follow input/output links", async () => {
    const f = await fixture(); vi.spyOn(console, "log").mockImplementation(() => {}); await main(f.args);
    const original = await readFile(path.join(f.out, "plan.json"));
    await expect(main(f.args)).rejects.toThrow("AVAILABILITY_IO_FAILED"); expect(await readFile(path.join(f.out, "plan.json"))).toEqual(original);
    const link = path.join(f.root, "input-link"); await symlink(f.snapshot, link);
    await expect(main(f.args.map((arg) => arg === f.snapshot ? link : arg))).rejects.toThrow("INPUT_LINK");
    const outLink = path.join(f.root, "output-link"); await symlink(f.out, outLink, "dir");
    await expect(main(f.args.map((arg) => arg === f.out ? outLink : arg))).rejects.toThrow();
  });
  it("refuses unsafe permissions and output inside ordinary or worktree Git directories", async () => {
    const f = await fixture();
    await chmod(f.snapshot, 0o644); await expect(main(f.args)).rejects.toThrow("INPUT_NOT_PRIVATE_OR_BOUNDED"); await chmod(f.snapshot, 0o600);
    await chmod(f.root, 0o755); await expect(main(f.args)).rejects.toThrow("OUTPUT_PARENT_NOT_PRIVATE"); await chmod(f.root, 0o700);
    const init = spawnSync("git", ["init", "--quiet", f.root]); expect(init.status).toBe(0);
    await expect(main(f.args)).rejects.toThrow("OUTPUT_LOCATION_REFUSED");
    await expect(stat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
    await rename(path.join(f.root, ".git"), path.join(f.root, "metadata"));
    await writeFile(path.join(f.root, ".git"), "gitdir: metadata");
    await expect(main(f.args)).rejects.toThrow("OUTPUT_LOCATION_REFUSED");
    await expect(stat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("removes its empty directory after permission refusal and permits a corrected retry", async () => {
    const f = await fixture(), original = process.umask(0o277);
    try { await expect(main(f.args)).rejects.toThrow("OUTPUT_NOT_PRIVATE"); }
    finally { process.umask(original); }
    await expect(stat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(f.args)).toBe(0);
  });
  it("redacts malformed contents and native path errors in both API and actual CLI", async () => {
    const f = await fixture(); await writeFile(f.intent, '{"private-handle":"' + secret);
    await expect(main(f.args)).rejects.toThrow(/^INVALID_JSON$/);
    const script = fileURLToPath(new URL("./plan-client-gallery-availability.mts", import.meta.url));
    const run = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", script, ...f.args], { encoding: "utf8" });
    expect(run.status).toBe(1); expect(run.stderr.trim()).toBe("INVALID_JSON"); expect(run.stdout).toBe("");
    expect(run.stderr).not.toContain(secret); expect(run.stderr).not.toContain(f.root);
    await expect(main(f.args.map((arg) => arg === f.snapshot ? path.join(f.root, "missing-private-file") : arg))).rejects.toThrow(/^AVAILABILITY_IO_FAILED$/);
  });
});
