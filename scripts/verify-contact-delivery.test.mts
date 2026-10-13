import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const exec = promisify(execFile), folders: string[] = [];
afterEach(async () => { await Promise.all(folders.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
async function fixture() { const dir = await mkdtemp(path.join(os.tmpdir(), "contact-smoke-cli-")); folders.push(dir); return { dir, out: path.join(dir, "receipt.json") }; }
function run(out: string, extra: string[] = []) {
  return exec(process.execPath, [path.resolve("scripts/verify-contact-delivery.mts"), "--origin", "https://synthetic-release.example.test", "--out", out, ...extra], { timeout: 15_000 });
}
describe("contact operator receipt boundary", () => {
  it("does not send by default and cannot overwrite a prior attempt", async () => {
    const f = await fixture(), result = await run(f.out), before = await readFile(f.out, "utf8");
    expect(JSON.parse(result.stdout)).toMatchObject({ status: "plan-only", mailboxArrivalVerified: false });
    await expect(run(f.out)).rejects.toThrow(); expect(await readFile(f.out, "utf8")).toBe(before);
  });
  it("rejects invalid identity, repeated flags and unsafe output before creating a receipt", async () => {
    const f = await fixture();
    await expect(run(f.out, ["--submission-id", "PRIVATE"])).rejects.toThrow();
    await expect(run(f.out, ["--out", f.out])).rejects.toThrow();
    await chmod(f.dir, 0o755); await expect(run(f.out)).rejects.toThrow(); await expect(readFile(f.out)).rejects.toThrow();
  });
  it("does not follow or replace a symlinked receipt", async () => {
    const f = await fixture(), saved = path.join(f.dir, "saved.json"); await writeFile(saved, "preserved", { mode: 0o600 });
    await symlink(saved, f.out); await expect(run(f.out)).rejects.toThrow(); expect(await readFile(saved, "utf8")).toBe("preserved");
  });
});
