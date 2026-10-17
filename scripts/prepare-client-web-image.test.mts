import { execFileSync, spawnSync } from "node:child_process";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";
import { parseClientWebImageArguments, runClientWebImagePreparation } from "./prepare-client-web-image.mts";
import { openPrivateClientImage } from "./client-web-image-files.mts";
import { imageDigest } from "./client-web-image-preparation.mts";

const command = fileURLToPath(new URL("./prepare-client-web-image.mts", import.meta.url));
const roots: string[] = [];
async function fixture(git = false) {
  const root = await mkdtemp(path.join(await realpath(os.tmpdir()), "client-web-image-")); roots.push(root); await chmod(root, 0o700);
  const source = path.join(root, "synthetic-private-owner-export.jpg"), out = path.join(root, "prepared");
  const bytes = await sharp({ create: { width: 100, height: 80, channels: 3, background: "red" } }).jpeg().toBuffer();
  await writeFile(source, bytes, { mode: 0o600 });
  if (git) execFileSync("git", ["init", "--quiet", root], { stdio: "pipe" });
  return { root, source, out, bytes, options: { source, out, classification: "processed-export" } };
}
function cli(source: string, out: string, extra: readonly string[] = [], env = process.env) {
  return spawnSync(process.execPath, [command, "--source", source, "--classification", "processed-export", "--out", out, ...extra], { env, encoding: "utf8", timeout: 30_000 });
}
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("one-image private Node CLI", () => {
  it("writes the neutral complete derivative and deterministic receipt at private permissions without changing the source", async () => {
    const f = await fixture(), before = await lstat(f.source, { bigint: true }), result = cli(f.source, f.out);
    expect(result.status, result.stderr).toBe(0); expect(result.stderr).toBe("");
    const receipt = JSON.parse(result.stdout);
    expect(await readFile(f.source)).toEqual(f.bytes);
    const after = await lstat(f.source, { bigint: true });
    for (const key of ["ino", "size", "mode", "mtimeNs", "ctimeNs"] as const) expect(after[key]).toBe(before[key]);
    expect((await lstat(f.out)).mode & 0o777).toBe(0o700);
    expect((await readdir(f.out)).sort()).toEqual(["receipt.json", "web-image.jpg"]);
    for (const name of await readdir(f.out)) expect((await lstat(path.join(f.out, name))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path.join(f.out, "receipt.json"), "utf8"))).toEqual(receipt);
    expect(receipt.output.sha256).toBe(imageDigest(await readFile(path.join(f.out, "web-image.jpg"))));
    expect(result.stdout).not.toMatch(/synthetic-private|client-web-image-|\/tmp\//);
    expect(receipt).toMatchObject({ uploaded: false, published: false, sourceEligibilityApproved: false, metadataSuitabilityApproved: false });
  });
  it("refuses an existing output without modifying its evidence", async () => {
    const f = await fixture(); await mkdir(f.out, { mode: 0o700 }); await writeFile(path.join(f.out, "keep"), "evidence");
    const result = cli(f.source, f.out); expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).not.toContain(f.root);
    expect(await readFile(path.join(f.out, "keep"), "utf8")).toBe("evidence");
  });
  it.each(["file-mode", "parent-mode", "file-link", "parent-link", "hardlink"])("refuses unsafe source %s without leaking a name", async kind => {
    const f = await fixture(); let source = f.source;
    if (kind === "file-mode") await chmod(source, 0o644);
    if (kind === "parent-mode") await chmod(f.root, 0o755);
    if (kind === "file-link") { source = path.join(f.root, "linked-private.jpg"); await symlink(f.source, source); }
    if (kind === "parent-link") { const alias = f.root + "-alias"; roots.push(alias); await symlink(f.root, alias); source = path.join(alias, path.basename(f.source)); }
    if (kind === "hardlink") await link(source, path.join(f.root, "hard-private.jpg"));
    const result = cli(source, f.out); expect(result.status).toBe(1); expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^\[client-web-image\] [A-Z_]+\n$/); expect(result.stderr).not.toContain(f.root);
    await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses a group-writable nonsticky ancestor even below a private parent", async () => {
    const f = await fixture(), parent = path.join(f.root, "unsafe"), privateDir = path.join(parent, "private");
    await mkdir(parent, { mode: 0o770 }); await chmod(parent, 0o770); await mkdir(privateDir, { mode: 0o700 });
    const source = path.join(privateDir, "image.jpg"); await writeFile(source, f.bytes, { mode: 0o600 });
    expect(cli(source, f.out).status).toBe(1);
  });
  it("refuses every Git-visible output, even when receipt.json alone is ignored", async () => {
    const f = await fixture(true); await writeFile(path.join(f.root, ".gitignore"), `${path.basename(f.source)}\nprepared/receipt.json\n`);
    const result = cli(f.source, f.out); expect(result.status).toBe(1); expect(result.stderr).toContain("GIT_VISIBLE_PATH");
    await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("accepts locally ignored private files and ignores hostile inherited GIT_* settings", async () => {
    const f = await fixture(true); await writeFile(path.join(f.root, ".gitignore"), `${path.basename(f.source)}\nprepared/\n`);
    const result = cli(f.source, f.out, [], { ...process.env, GIT_DIR: "/nonexistent-private-git", GIT_WORK_TREE: "/nonexistent-private-worktree", GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.excludesfile", GIT_CONFIG_VALUE_0: "/nonexistent-ignore" });
    expect(result.status, result.stderr).toBe(0);
  });
  it("refuses a force-tracked source even when its ignore rule matches", async () => {
    const f = await fixture(true); await writeFile(path.join(f.root, ".gitignore"), "*\n"); execFileSync("git", ["-C", f.root, "add", "-f", "--", path.basename(f.source)], { stdio: "pipe" });
    const result = cli(f.source, f.out); expect(result.status).toBe(1); expect(result.stderr).toContain("GIT_VISIBLE_PATH");
  });
  it("rechecks open source permissions and pathname identity before output", async () => {
    const f = await fixture(), input = await openPrivateClientImage(f.source);
    try { await chmod(f.source, 0o400); await expect(input.unchanged()).rejects.toMatchObject({ code: "SOURCE_CHANGED" }); }
    finally { await input.close(); }
    await chmod(f.source, 0o600);
    const other = await openPrivateClientImage(f.source);
    try { await rm(f.source); await writeFile(f.source, f.bytes, { mode: 0o600 }); await expect(other.unchanged()).rejects.toMatchObject({ code: "SOURCE_CHANGED" }); }
    finally { await other.close(); }
  });
  it("keeps files unchanged and creates no output when cancellation was requested", async () => {
    const f = await fixture(), cancellation = new AbortController(); cancellation.abort();
    await expect(runClientWebImagePreparation(f.options, cancellation.signal)).rejects.toMatchObject({ code: "INTERRUPTED" });
    await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" }); expect(await readFile(f.source)).toEqual(f.bytes);
  });
  it("refuses invalid content without creating an output directory or disclosing decoder details", async () => {
    const f = await fixture(); await writeFile(f.source, "private-invalid-customer-path");
    const result = cli(f.source, f.out); expect(result.status).toBe(1); expect(result.stderr).toBe("[client-web-image] INVALID_IMAGE\n");
    expect(result.stdout).toBe(""); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses alias outputs and malformed/duplicate arguments without echoing values", async () => {
    const f = await fixture(); expect(cli(f.source, f.root).status).toBe(1);
    for (const args of [["--source=private-customer"], ["--unknown", "private-customer"], ["--source", "one", "--source", "two"], ["--source", "nul\0value"]]) expect(() => parseClientWebImageArguments(args)).toThrow(/\[client-web-image\] [A-Z_]+$/);
    const result = cli(f.source, f.out, ["--unknown", "private-customer"]); expect(result.status).toBe(1); expect(result.stderr).not.toContain("private-customer");
  });
});
