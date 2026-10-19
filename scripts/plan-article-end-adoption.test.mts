import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { adoptionFixture } from "./article-end-adoption-fixture.mts";
import { main } from "./plan-article-end-adoption.mts";

const folders: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(folders.splice(0).map(f => rm(f, { recursive: true, force: true }))); });
async function fixture() {
  const input = adoptionFixture().input(), folder = await mkdtemp(path.join(tmpdir(), "adoption-test-")); folders.push(folder); await chmod(folder, 0o700);
  const manifest = path.join(folder, "manifest.json"), snapshot = path.join(folder, "snapshot.ndjson"), out = path.join(folder, "out");
  await writeFile(manifest, input.manifest, { mode: 0o600 }); await writeFile(snapshot, input.snapshot, { mode: 0o600 });
  return { input, folder, manifest, snapshot, out, args: ["--manifest", manifest, "--snapshot", snapshot, "--out", out] };
}
describe("private offline adoption CLI", () => {
  it("writes exact private non-executable evidence, never overwrites and logs no source values", async () => {
    const f = await fixture(), log = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(await main(f.args)).toBe(0);
    const filename = path.join(f.out, "plan.json"), bytes = await readFile(filename), p = JSON.parse(bytes.toString());
    expect(p.writable).toBe(false); expect(p.approved).toBe(false);
    expect((await stat(f.out)).mode & 0o777).toBe(0o700); expect((await stat(filename)).mode & 0o777).toBe(0o600);
    expect(log.mock.calls.flat().join(" ")).not.toMatch(/article-fi|photograph-one|source-a|adoption-test|Unchanged/);
    await expect(main(f.args)).rejects.toThrow("ADOPTION_INPUT_OR_OUTPUT_FAILED");
    expect(await readFile(filename)).toEqual(bytes); expect(await readFile(f.manifest)).toEqual(f.input.manifest); expect(await readFile(f.snapshot)).toEqual(f.input.snapshot);
  });
  it("creates no output for malformed input and refuses public or symlinked inputs", async () => {
    const f = await fixture(); await writeFile(f.manifest, '{"secret":"PRIVATE poisoned input');
    await expect(main(f.args)).rejects.toThrow("INVALID_JSON"); await expect(stat(f.out)).rejects.toThrow();
    const g = await fixture(); await chmod(g.snapshot, 0o644);
    await expect(main(g.args)).rejects.toThrow("ADOPTION_INPUT_OR_OUTPUT_FAILED"); await expect(stat(g.out)).rejects.toThrow();
    const h = await fixture(); await symlink(h.snapshot, path.join(h.folder, "link"));
    await expect(main(["--manifest", h.manifest, "--snapshot", path.join(h.folder, "link"), "--out", h.out])).rejects.toThrow("ADOPTION_INPUT_OR_OUTPUT_FAILED");
  });
  it("refuses unknown/apply flags and ambiguous or missing arguments", async () => {
    const f = await fixture();
    for (const args of [[], [...f.args, "--apply", "true"], [...f.args, "--snapshot", f.snapshot], [...f.args, "--unexpected", "private-value"]]) await expect(main(args)).rejects.toThrow("ADOPTION_INPUT_OR_OUTPUT_FAILED");
  });
  it("refuses Git-visible output and specifically protects the actual tracked output filename", async () => {
    const f = await fixture(); execFileSync("git", ["init", "-q", f.folder]);
    await expect(main(f.args)).rejects.toThrow("ADOPTION_INPUT_OR_OUTPUT_FAILED");
    await writeFile(path.join(f.folder, ".gitignore"), "out/\n"); await mkdir(f.out); await writeFile(path.join(f.out, "plan.json"), "tracked fixture");
    execFileSync("git", ["-C", f.folder, "add", "-f", "out/plan.json"]); await rm(f.out, { recursive: true });
    await expect(main(f.args)).rejects.toThrow("ADOPTION_INPUT_OR_OUTPUT_FAILED"); await expect(stat(path.join(f.out, "plan.json"))).rejects.toThrow();
  });
  it("returns static stderr with no paths or snippets when invoked as a real Node command", async () => {
    const f = await fixture(); await writeFile(f.manifest, '{"private-content":"SECRET_RECORD');
    const script = fileURLToPath(new URL("./plan-article-end-adoption.mts", import.meta.url));
    try {
      execFileSync(process.execPath, [script, ...f.args], { encoding: "utf8", stdio: "pipe", env: { PATH: process.env.PATH, NODE_ENV: "test" } });
      expect.fail("expected refusal");
    } catch (error) {
      const failure = error as { status: number; stderr: string; stdout: string };
      expect(failure.status).toBe(1); expect(failure.stderr.trim()).toBe("INVALID_JSON"); expect(failure.stdout).toBe("");
    }
  });
});
