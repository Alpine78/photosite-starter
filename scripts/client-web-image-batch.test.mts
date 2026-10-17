import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { chmodSync, existsSync } from "node:fs";
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { imageDigest } from "./client-web-image-preparation.mts";
import { parseWebImageSelection, prepareWebImageBatch, WEB_BATCH_LIMITS } from "./client-web-image-batch.mts";
import { createWebBatchOutput } from "./client-web-image-batch-files.mts";
import * as zipFiles from "./delivery-zip-build-files.mts";
import { parseWebBatchArguments, runWebImageBatch } from "./prepare-client-web-image-batch.mts";
const exec = promisify(execFile), roots: string[] = [];
const selectionBytes = (...names: string[]) => Buffer.from(`processed-web-images-v1\n${names.join("\n")}\n`);
async function image(w = 24, h = 16, format: "jpeg" | "png" | "webp" | "avif" = "jpeg") {
  return sharp({ create: { width: w, height: h, channels: 3, background: "red" } }).withExif({ IFD0: { Make: "private-metadata-canary" } }).toFormat(format).toBuffer();
}
async function setup(names = ["private-source-canary.jpg"]) {
  const base = await mkdtemp(path.join(os.tmpdir(), "web-batch-private-canary-")); roots.push(base); await chmod(base, 0o700);
  const root = path.join(base, "exports"); await mkdir(root, { mode: 0o700 });
  for (const name of names) await writeFile(path.join(root, name), await image(), { mode: 0o600 });
  const selection = path.join(base, "selection.txt"), out = path.join(base, "prepared");
  await writeFile(selection, selectionBytes(...names), { mode: 0o600 });
  return { base, root, selection, out };
}
function port(bytes: Buffer) { return { size: bytes.length, async read(at: number, length: number) { return bytes.subarray(at, at + length); }, async unchanged() {} }; }
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("explicit web-image batch selection", () => {
  it("preserves literal explicit order and Unicode names", () => {
    expect(parseWebImageSelection(selectionBytes("ää.PNG", "other.JPEG"))).toEqual(["ää.PNG", "other.JPEG"]);
    expect(parseWebImageSelection(selectionBytes(...Array.from({ length: 256 }, (_, i) => `${i}.jpg`)))).toHaveLength(256);
  });
  it.each(["../a.jpg", "/a.jpg", "a//b.jpg", "./a.jpg", "a/../b.jpg", "a\\b.jpg", "a*.jpg", "a?.jpg", "a[1].jpg", "a{1}.jpg", "a!.jpg", "a:b.jpg", "a\u202e.jpg", "a\r.jpg", "a\u0085.jpg", "a\u2028.jpg", " a.jpg", "a.jpg ", "a.tiff", "", "a\u0308.jpg"])("rejects ambiguous or unsupported name %j", name => {
    expect(() => parseWebImageSelection(selectionBytes(name))).toThrow("INVALID_SELECTION");
  });
  it("rejects malformed UTF8, BOM, missing LF, repeated names, excess count and bytes", () => {
    for (const b of [Buffer.from([255]), Buffer.from("\ufeffprocessed-web-images-v1\na.jpg\n"), Buffer.from("processed-web-images-v1\na.jpg"), selectionBytes("a.jpg", "a.jpg"), selectionBytes(...Array.from({ length: 257 }, (_, i) => `${i}.jpg`)), Buffer.alloc(WEB_BATCH_LIMITS.selection + 1)]) expect(() => parseWebImageSelection(b)).toThrow("INVALID_SELECTION");
  });
  it("has closed arguments and refuses root-descendant output even for ..prefixed names", () => {
    const args = ["--root", "/private/root", "--selection", "/private/list", "--out", "/private/result", "--classification", "processed-exports"];
    expect(parseWebBatchArguments(args)).toEqual({ root: "/private/root", selection: "/private/list", out: "/private/result" });
    for (const change of [[...args, "--unknown", "x"], [...args, "--out", "x"], args.slice(0, -2), args.map(x => x === "processed-exports" ? "camera-masters" : x), args.map(x => x === "/private/result" ? "/private/root/..child" : x)]) expect(() => parseWebBatchArguments(change)).toThrow();
  });
});
describe("sequential batch preparation", () => {
  it("makes mixed real formats in selected order, strips web metadata and never enlarges", async () => {
    const inputs = [await image(40, 20), await image(30, 60, "png"), await image(12, 18, "webp"), await image(32, 16, "avif")];
    const writes: { name: string; bytes: Buffer }[] = [];
    const result = await prepareWebImageBatch(inputs.map(port), selectionBytes("a.jpg", "b.png", "c.webp", "d.avif"), { async write(name, bytes) { writes.push({ name, bytes: Buffer.from(bytes) }); }, async check() {} });
    expect(result.images.map(i => i.filename)).toEqual(["image-0001.jpg", "image-0002.png", "image-0003.webp", "image-0004.avif"]);
    expect(result.images.map(i => [i.preparation.output.width, i.preparation.output.height])).toEqual([[40, 20], [30, 60], [12, 18], [32, 16]]);
    for (const [i, written] of writes.entries()) {
      const m = await sharp(written.bytes).metadata(); expect(m.exif).toBeUndefined(); expect(m.xmp).toBeUndefined();
      expect(result.images[i].preparation.source.sha256).toBe(imageDigest(inputs[i])); expect(result.images[i].preparation.output.sha256).toBe(imageDigest(written.bytes));
    }
    expect(result).toMatchObject({ count: 4, uploaded: false, published: false, sourceEligibilityApproved: false, metadataSuitabilityApproved: false });
    expect(JSON.stringify(result)).not.toContain("private-metadata-canary");
  });
  it("normalizes orientation and downsizes the entire portrait frame", async () => {
    const input = await sharp({ create: { width: 3000, height: 1500, channels: 3, background: "blue" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const result = await prepareWebImageBatch([port(input)], selectionBytes("a.jpg"), { async write() {}, async check() {} });
    expect(result.images[0].preparation.source).toMatchObject({ width: 1500, height: 3000 });
    expect(result.images[0].preparation.output).toMatchObject({ width: 1024, height: 2048 });
  });
  it("rejects format mismatch, corrupt later image and a changed selection", async () => {
    const good = await image(), sink = { async write() {}, async check() {} };
    await expect(prepareWebImageBatch([port(good)], selectionBytes("a.png"), sink)).rejects.toThrow("FORMAT_MISMATCH");
    await expect(prepareWebImageBatch([port(good), port(Buffer.from("private-bad-canary"))], selectionBytes("a.jpg", "b.jpg"), sink)).rejects.toThrow();
    let calls = 0;
    await expect(prepareWebImageBatch([port(good)], selectionBytes("a.jpg"), sink, undefined, async () => { if (++calls === 2) throw Error("changed"); })).rejects.toThrow("changed");
  });
  it("bounds per-read chunks and refuses >1GB input before output", async () => {
    let writes = 0, reads = 0;
    const huge = { size: 25_000_000, async read() { reads++; return Buffer.alloc(0); }, async unchanged() {} };
    await expect(prepareWebImageBatch(Array.from({ length: 41 }, () => huge), selectionBytes(...Array.from({ length: 41 }, (_, i) => `${i}.jpg`)), { async write() { writes++; }, async check() {} })).rejects.toThrow("BATCH_BYTE_LIMIT");
    expect([writes, reads]).toEqual([0, 0]);
    const input = Buffer.concat([await image(), Buffer.alloc(100_000)]), source = { ...port(input), async read(at: number, length: number) { expect(length).toBeLessThanOrEqual(65536); return input.subarray(at, at + length); } };
    await prepareWebImageBatch([source], selectionBytes("a.jpg"), { async write() {}, async check() {} });
  });
  it("checks cancellation before work, after conversion/write, and before success", async () => {
    const input = await image(), controller = new AbortController(); controller.abort();
    await expect(prepareWebImageBatch([port(input)], selectionBytes("a.jpg"), { async write() { throw Error("unexpected"); }, async check() {} }, controller.signal)).rejects.toThrow("INTERRUPTED");
    const later = new AbortController();
    await expect(prepareWebImageBatch([port(input)], selectionBytes("a.jpg"), { async write() { later.abort(); }, async check() {} }, later.signal)).rejects.toThrow("INTERRUPTED");
  });
});
describe("private batch files and actual CLI", () => {
  it("runs the actual Node CLI with private neutral artifacts and unchanged sources", async () => {
    const f = await setup(), before = await readFile(path.join(f.root, "private-source-canary.jpg"));
    const { stdout, stderr } = await exec(process.execPath, ["scripts/prepare-client-web-image-batch.mts", "--root", f.root, "--selection", f.selection, "--out", f.out, "--classification", "processed-exports"], { cwd: process.cwd() });
    const receipt = JSON.parse(stdout); expect(receipt.count).toBe(1); expect(stderr).toBe("");
    expect(stdout).not.toMatch(/private-source-canary|private-metadata-canary|web-batch-private-canary/);
    expect(JSON.parse(await readFile(path.join(f.out, "receipt.json"), "utf8"))).toEqual(receipt);
    expect(await readdir(f.out)).toEqual(["image-0001.jpg", "receipt.json"]);
    expect((await lstat(f.out)).mode & 0o777).toBe(0o700);
    for (const name of await readdir(f.out)) expect((await lstat(path.join(f.out, name))).mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(f.root, "private-source-canary.jpg"))).toEqual(before);
  });
  it("accepts exactly256 real CLI images without opening a second set of descriptors", async () => {
    const names = Array.from({ length: 256 }, (_, i) => `source-${i}.jpg`), f = await setup(names);
    const { stdout } = await exec(process.execPath, ["scripts/prepare-client-web-image-batch.mts", "--root", f.root, "--selection", f.selection, "--out", f.out, "--classification", "processed-exports"]);
    expect(JSON.parse(stdout).count).toBe(256); expect((await readdir(f.out)).length).toBe(257);
  }, 60_000);
  it.each(["SIGINT", "SIGTERM"] as const)("cleans partial real CLI outputs on %s and exits130", async signal => {
    const f = await setup(Array.from({ length: 32 }, (_, i) => `source-${i}.jpg`));
    const originals = await Promise.all((await readdir(f.root)).map(async name => ({ name, bytes: await readFile(path.join(f.root, name)) })));
    const child = spawn(process.execPath, ["scripts/prepare-client-web-image-batch.mts", "--root", f.root, "--selection", f.selection, "--out", f.out, "--classification", "processed-exports"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    child.stdout.on("data", data => { stdout += data; }); child.stderr.on("data", data => { stderr += data; });
    const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
      child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal }));
    });
    const watchdog = setTimeout(() => child.kill("SIGKILL"), 12_000);
    try {
      let sent = false;
      for (let attempt = 0; attempt < 4000 && child.exitCode === null && child.signalCode === null; attempt++) {
        if (existsSync(path.join(f.out, "image-0001.jpg"))) { sent = child.kill(signal); break; }
        await new Promise(resolve => setTimeout(resolve, 2));
      }
      expect(sent).toBe(true); expect(await closed).toEqual({ code: 130, signal: null });
      expect(stdout).toBe(""); expect(stderr).toBe("[client-web-image] INTERRUPTED\n");
      await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
      for (const { name, bytes } of originals) expect(await readFile(path.join(f.root, name))).toEqual(bytes);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      await closed.catch(() => undefined); clearTimeout(watchdog);
    }
  }, 20_000);
  it("fails whole batch and removes owned partial results after a later invalid image", async () => {
    const f = await setup(["first.jpg", "second.jpg"]); await writeFile(path.join(f.root, "second.jpg"), "private-error-canary");
    await expect(runWebImageBatch(f)).rejects.toThrow(/\[client-web-image\]/); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("closes already-opened sources after EMFILE and writes no output", async () => {
    const f = await setup(["a.jpg", "b.jpg"]), original = zipFiles.openZipBuildInput;
    let calls = 0; const descriptors: Awaited<ReturnType<typeof original>>[] = [];
    vi.spyOn(zipFiles, "openZipBuildInput").mockImplementation(async (...args) => {
      if (++calls === 3) throw Object.assign(Error("private-error-canary"), { code: "EMFILE" });
      const input = await original(...args); descriptors.push(input); return input;
    });
    await expect(runWebImageBatch(f)).rejects.toThrow("LOCAL_IO_FAILED");
    for (const input of descriptors) await expect(input.handle.stat()).rejects.toMatchObject({ code: "EBADF" });
    await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("invalidates the batch if an earlier source or held selection changes", async () => {
    for (const kind of ["source", "selection"] as const) {
      const f = await setup(["a.jpg", "b.jpg"]), original = zipFiles.openZipBuildInput;
      let changed = false;
      vi.spyOn(zipFiles, "openZipBuildInput").mockImplementation(async (...args) => {
        const input = await original(...args);
        if (args[0] === path.join(f.root, "b.jpg")) {
          const read = input.read;
          input.read = async (...where) => {
            const bytes = await read(...where);
            if (!changed) { changed = true; await writeFile(kind === "source" ? path.join(f.root, "a.jpg") : f.selection, "changed-private-canary"); }
            return bytes;
          };
        }
        return input;
      });
      await expect(runWebImageBatch(f)).rejects.toThrow("LOCAL_IO_FAILED");
      await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" }); vi.restoreAllMocks();
    }
  });
  it("never overwrites an existing output or follows input symlinks/hardlinks", async () => {
    const f = await setup(); await mkdir(f.out, { mode: 0o700 }); await writeFile(path.join(f.out, "existing"), "preserve");
    await expect(runWebImageBatch(f)).rejects.toThrow("LOCAL_IO_FAILED"); expect(await readFile(path.join(f.out, "existing"), "utf8")).toBe("preserve");
    const g = await setup(), file = path.join(g.root, "private-source-canary.jpg"); await rename(file, file + ".real"); await symlink(file + ".real", file);
    await expect(runWebImageBatch(g)).rejects.toThrow("LOCAL_IO_FAILED"); await rm(file); await link(file + ".real", file);
    await expect(runWebImageBatch(g)).rejects.toThrow("LOCAL_IO_FAILED");
  });
  it("refuses nonprivate and nonignored Git inputs and tracked files even when ignored", async () => {
    const f = await setup(); await chmod(path.join(f.root, "private-source-canary.jpg"), 0o644);
    await expect(runWebImageBatch(f)).rejects.toThrow("LOCAL_IO_FAILED");
    const g = await setup(); await exec("git", ["init", "-q", g.base]);
    await expect(runWebImageBatch(g)).rejects.toThrow("LOCAL_IO_FAILED");
    await writeFile(path.join(g.base, ".gitignore"), "selection.txt\nexports/\nprepared/\n");
    await exec("git", ["-C", g.base, "add", "-f", "exports/private-source-canary.jpg"]);
    await expect(runWebImageBatch(g)).rejects.toThrow("LOCAL_IO_FAILED");
  });
  it("detects changed output hashes/identity and preserves unrelated data on cleanup", async () => {
    const f = await setup(), sink = await createWebBatchOutput(f.out);
    await sink.write("image-0001.jpg", await image()); await sink.check();
    await writeFile(path.join(f.out, "unrelated"), "preserve"); await expect(sink.check()).rejects.toThrow("OUTPUT_CHANGED");
    await sink.abort(); expect(await readdir(f.out)).toEqual(["unrelated"]); expect(await readFile(path.join(f.out, "unrelated"), "utf8")).toBe("preserve");
    const g = await setup(), output = await createWebBatchOutput(g.out); await output.write("image-0001.jpg", await image());
    await writeFile(path.join(g.out, "image-0001.jpg"), "changed"); await expect(output.check()).rejects.toThrow("OUTPUT_CHANGED"); await output.abort();
  });
  it("refuses output permissions changed while image bytes are being written", async () => {
    const f = await setup(), controller = new AbortController(), outputFile = path.join(f.out, "image-0001.jpg");
    let changed = false;
    Object.defineProperty(controller.signal, "aborted", { get() { if (!changed && existsSync(outputFile)) { changed = true; chmodSync(outputFile, 0o644); } return false; } });
    const sink = await createWebBatchOutput(f.out, controller.signal);
    await expect((async () => { await sink.write("image-0001.jpg", await image()); await sink.check(); })()).rejects.toThrow("OUTPUT_CHANGED");
    await sink.abort(); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("removes the final receipt when cancellation arrives during final verification", async () => {
    const f = await setup(), controller = new AbortController(), sink = await createWebBatchOutput(f.out, controller.signal);
    await sink.write("image-0001.jpg", await image()); let calls = 0;
    await expect(sink.finish({ status: "test" }, async () => { if (++calls === 2) controller.abort(); })).rejects.toThrow("INTERRUPTED");
    await sink.abort(); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("never deletes a replaced root or replacement file", async () => {
    const f = await setup(), sink = await createWebBatchOutput(f.out); await sink.write("image-0001.jpg", await image());
    await rename(path.join(f.out, "image-0001.jpg"), path.join(f.base, "original.jpg")); await writeFile(path.join(f.out, "image-0001.jpg"), "preserve");
    await sink.abort(); expect(await readFile(path.join(f.out, "image-0001.jpg"), "utf8")).toBe("preserve");
    const g = await setup(), other = await createWebBatchOutput(g.out); await rename(g.out, g.out + ".saved"); await mkdir(g.out, { mode: 0o700 }); await writeFile(path.join(g.out, "foreign"), "preserve");
    await other.abort(); expect(await readFile(path.join(g.out, "foreign"), "utf8")).toBe("preserve");
  });
  it("invalid CLI inputs print only closed diagnostics", async () => {
    const f = await setup(); await writeFile(f.selection, "private-selection-canary");
    try { await exec(process.execPath, ["scripts/prepare-client-web-image-batch.mts", "--root", f.root, "--selection", f.selection, "--out", f.out, "--classification", "processed-exports"]); throw Error("expected failure"); }
    catch (error) { const e = error as { stdout: string; stderr: string }; expect(e.stdout).toBe(""); expect(e.stderr).toBe("[client-web-image] INVALID_SELECTION\n"); }
  });
});
