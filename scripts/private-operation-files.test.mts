import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, chmod, symlink, rm, stat, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { argumentsOf, newPrivateDirectory, readPrivateBytes, writePrivateBytes } from "./private-operation-files.mts";
async function fixture(run: (folder: string) => Promise<void>) {
  const folder = await mkdtemp(path.join(tmpdir(), "operation-fixture-"));
  try { await run(folder); } finally { await rm(folder, { recursive: true }); }
}
describe("private operational evidence", () => {
  it("bounds inputs, rejects nonprivate bytes and preserves existing evidence", () => fixture(async folder => {
    const source = path.join(folder, "source"); await writeFile(source, "fixture", { mode: 0o600 });
    expect((await readPrivateBytes(source, 7)).toString()).toBe("fixture");
    await expect(readPrivateBytes(source, 6)).rejects.toThrow();
    await chmod(source, 0o644); await expect(readPrivateBytes(source, 10)).rejects.toThrow();
    const out = await newPrivateDirectory(path.join(folder, "out"));
    await writePrivateBytes(out, "receipt.json", "fixture");
    expect((await stat(path.join(out, "receipt.json"))).mode & 0o777).toBe(0o600);
    await expect(writePrivateBytes(out, "receipt.json", "replacement")).rejects.toThrow();
    await expect(newPrivateDirectory(out)).rejects.toThrow();
    await expect(writePrivateBytes(out, "../escape", "fixture")).rejects.toThrow();
  }));
  it("rejects file and parent links", () => fixture(async folder => {
    const source = path.join(folder, "source"); await writeFile(source, "fixture", { mode: 0o600 });
    await symlink(source, path.join(folder, "link"));
    await expect(readPrivateBytes(path.join(folder, "link"), 100)).rejects.toThrow();
    await symlink(folder, path.join(folder, "parent-link"));
    await expect(newPrivateDirectory(path.join(folder, "parent-link", "out"))).rejects.toThrow();
  }));
  it("refuses Git-visible reports and accepts ignored reports", () => fixture(async folder => {
    execFileSync("git", ["init", "--quiet", folder]);
    await expect(newPrivateDirectory(path.join(folder, "visible"))).rejects.toThrow("OUTPUT_NOT_IGNORED");
    await writeFile(path.join(folder, ".gitignore"), "private/\n"); await mkdir(path.join(folder, "private"), { mode: 0o700 });
    await expect(newPrivateDirectory(path.join(folder, "private", "run"))).resolves.toBe(path.join(folder, "private", "run"));
  }));
  it("rejects unknown/duplicate/missing flags without echoing values", () => {
    expect(argumentsOf(["--out", "private"], ["out"])).toEqual({ out: "private" });
    for (const args of [[], ["--bad", "value"], ["--out", "a", "--out", "b"], ["--out"]]) expect(() => argumentsOf(args, ["out"])).toThrow();
  });
});
