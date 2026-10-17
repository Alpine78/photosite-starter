import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import { fstatSync } from "node:fs";
import { chmod, link, lstat, mkdtemp, open, readFile, readdir, rename, rm, symlink, writeFile, type FileHandle } from "node:fs/promises";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { planWholeZip, parseZipSelection, ZIP_BUILD_LIMITS } from "./delivery-zip-build-plan.mts";
import { buildWholeDeliveryZip, type ZipSource } from "./delivery-zip-build.mts";
import { createZipBuildOutput, openZipBuildInput } from "./delivery-zip-build-files.mts";
import { parseZipBuildArguments, runWholeZipBuild } from "./build-delivery-zip.mts";
import { inspectDeliveryZip } from "./delivery-zip-integrity.mts";
const hash = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");
const network = vi.fn(() => { throw new Error("Offline only"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); expect(network).not.toHaveBeenCalled(); });
let jpeg: Buffer;
beforeAll(async () => { jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#987654" } }).jpeg().withExif({ IFD0: { Copyright: "Synthetic export metadata" } }).toBuffer(); });
function source(bytes: Buffer): ZipSource { return { size: bytes.length, async read(at, length) { return bytes.subarray(at, at + length); }, async unchanged() {} }; }
async function built(bytes = jpeg) { const chunks: Buffer[] = []; const result = await buildWholeDeliveryZip([source(bytes)], { async write(chunk) { chunks.push(Buffer.from(chunk)); } }); return { ...result, archive: Buffer.concat(chunks) }; }

describe("closed selection and exact ZIP plan", () => {
  it("accepts only an explicit canonical ordered private source selection", () => {
    expect(parseZipSelection(Buffer.from("processed-jpeg-selection-v1\nexports/one.JPG\nsecond.jpeg\n"))).toEqual(["exports/one.JPG", "second.jpeg"]);
  });
  it.each(["", "processed-jpeg-selection-v1\n", "processed-jpeg-selection-v1\na.jpg", "processed-jpeg-selection-v1\na.jpg\na.jpg\n", "processed-jpeg-selection-v1\n../a.jpg\n", "processed-jpeg-selection-v1\n/a.jpg\n", "processed-jpeg-selection-v1\na//b.jpg\n", "processed-jpeg-selection-v1\n./a.jpg\n", "processed-jpeg-selection-v1\na\\b.jpg\n", "processed-jpeg-selection-v1\na.raw\n", "processed-jpeg-selection-v1\n.jpg\n", "processed-jpeg-selection-v1\na\u0085.jpg\n", "\ufeffprocessed-jpeg-selection-v1\na.jpg\n", "processed-jpeg-selection-v1\ncafe\u0301.jpg\n", "processed-jpeg-selection-v1\n" + "a".repeat(256) + ".jpg\n"])("refuses ambiguous selection %#", text => { expect(() => parseZipSelection(Buffer.from(text))).toThrow("INVALID_SELECTION"); });
  it("refuses malformed UTF8 and oversized manifests", () => { expect(() => parseZipSelection(Buffer.from([0xff]))).toThrow(); expect(() => parseZipSelection(Buffer.alloc(65_537))).toThrow(); });
  it("accounts for every overhead byte at the archive1GB boundary", () => {
    //40 STORE entries each overhead120bytes, plus22EOCD; leave exactly enough room.
    const sizes = Array.from({ length: 40 }, () => 25_000_000); sizes[39] -= 40 * 120 + 22;
    expect(planWholeZip(sizes).archiveBytes).toBe(1_000_000_000); sizes[39]++; expect(() => planWholeZip(sizes)).toThrow("PACKAGE_LIMIT");
    expect(() => planWholeZip([25_000_001])).toThrow("ENTRY_SIZE"); expect(() => planWholeZip([3])).toThrow("ENTRY_SIZE");
    expect(planWholeZip(Array.from({ length: 256 }, () => 4)).entries).toHaveLength(256); expect(() => planWholeZip(Array.from({ length: 257 }, () => 4))).toThrow("ENTRY_COUNT");
  });
  it("requires the classification flag and rejects extra/duplicate arguments", () => {
    const args = ["--selection", "s", "--root", "r", "--out", "o", "--classification", "processed-jpeg-exports"];
    expect(parseZipBuildArguments(args).root).toBe(path.resolve("r"));
    for (const bad of [args.slice(0, -2), [...args, "--upload", "yes"], [...args, "--root", "r"], [...args.slice(0, -1), "raw"], []]) expect(() => parseZipBuildArguments(bad)).toThrow();
  });
});

describe("bounded STORE encoding and source byte preservation", () => {
  it("roundtrips actual JPEG+EXIF byte for byte through the independent baseline inspector", async () => {
    const first = await built(), second = await built();
    expect(first.archive).toEqual(second.archive); expect(first.receipt.archiveSha256).toBe(hash(first.archive));
    expect(inspectDeliveryZip(first.archive, Buffer.from(first.manifest))).toMatchObject({ entries: 1, readyToUpload: false });
    expect(first.archive.subarray(44, 44 + jpeg.length)).toEqual(jpeg); expect(first.archive.toString("latin1")).toContain("Synthetic export metadata");
    expect(first.receipt.checks).toMatchObject({ jpegDecoding: "unproven", processedExportClassification: "owner-asserted-not-verified", metadataSuitability: "unproven", provider: "not-contacted" });
    expect(first.archive.readUInt16LE(6)).toBe(0x0808); expect(first.archive.readUInt16LE(12)).toBe(0x21); expect(first.archive.readUInt32LE(14)).toBe(0);
  });
  it("refuses an entire unsupported selection without writing any archive bytes", async () => {
    const write = vi.fn(async () => {}); await expect(buildWholeDeliveryZip([source(Buffer.from("notJPEG"))], { write })).rejects.toThrow("JPEG_STRUCTURE_REQUIRED"); expect(write).not.toHaveBeenCalled();
    await expect(buildWholeDeliveryZip([{ ...source(jpeg), size: 25_000_001 }], { write })).rejects.toThrow("ENTRY_SIZE"); expect(write).not.toHaveBeenCalled();
  });
  it("fails closed on short reads, growth, stale identity, failing writes and stalled/cancelled ports", async () => {
    const write = vi.fn(async () => {}), ordinary = source(jpeg);
    await expect(buildWholeDeliveryZip([{ ...ordinary, async read(at, length) { return at === 0 && length > 2 ? jpeg.subarray(0, length - 1) : ordinary.read(at, length); } }], { write })).rejects.toThrow("SOURCE_CHANGED");
    await expect(buildWholeDeliveryZip([{ ...ordinary, async read(at, length) { return at === jpeg.length ? Buffer.from([0]) : ordinary.read(at, length); } }], { write })).rejects.toThrow("SOURCE_CHANGED");
    await expect(buildWholeDeliveryZip([{ ...ordinary, async unchanged() { throw new Error("private-source-sentinel"); } }], { write })).rejects.toThrow(/^\[zip-builder\] LOCAL_IO_FAILED$/);
    await expect(buildWholeDeliveryZip([ordinary], { async write() { throw new Error("private-source-sentinel"); } })).rejects.toThrow(/^\[zip-builder\] LOCAL_IO_FAILED$/);
    await expect(buildWholeDeliveryZip([{ ...ordinary, read: () => new Promise(() => {}) }], { write }, { timeoutMs: 10 })).rejects.toThrow("CANCELLED");
    const signal = new AbortController(); signal.abort(); await expect(buildWholeDeliveryZip([ordinary], { write }, { signal: signal.signal })).rejects.toThrow("CANCELLED");
  });
});

describe("real private owner CLI and identity-safe output", () => {
  let root: string, exports: string, selection: string;
  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "whole-zip-build-")); await chmod(root, 0o700); exports = path.join(root, "exports");
    await import("node:fs/promises").then(fs => fs.mkdir(exports, { mode: 0o700 })); selection = path.join(root, "selection.txt");
    await writeFile(path.join(exports, "private-name.jpg"), jpeg, { mode: 0o600 }); await writeFile(selection, "processed-jpeg-selection-v1\nprivate-name.jpg\n", { mode: 0o600 });
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const cli = path.resolve("scripts/build-delivery-zip.mts");
  function options(out = path.join(root, "result")) { return { selection, root: exports, out }; }
  function argumentsFor(out = path.join(root, "result")) { return ["--selection", selection, "--root", exports, "--out", out, "--classification", "processed-jpeg-exports"]; }
  it("creates only private neutral artifacts and fixed redacted stdout; never changes source bytes", async () => {
    const before = await lstat(path.join(exports, "private-name.jpg"), { bigint: true });
    const result = spawnSync(process.execPath, [cli, ...argumentsFor()], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(0); expect(result.stderr).toBe(""); const receipt = JSON.parse(result.stdout); expect(receipt.readyToUpload).toBe(false);
    expect(result.stdout).not.toContain(root); expect(result.stdout).not.toContain("private-name"); expect(await readdir(options().out)).toEqual(["delivery.zip", "entries.tsv", "receipt.json"]);
    for (const name of await readdir(options().out)) expect((await lstat(path.join(options().out, name))).mode & 0o777).toBe(0o600);
    expect((await lstat(options().out)).mode & 0o777).toBe(0o700);
    expect(inspectDeliveryZip(await readFile(path.join(options().out, "delivery.zip")), await readFile(path.join(options().out, "entries.tsv"))).archiveSha256).toBe(receipt.archiveSha256);
    expect(await readFile(path.join(exports, "private-name.jpg"))).toEqual(jpeg);
    const after = await lstat(path.join(exports, "private-name.jpg"), { bigint: true }); expect([after.size, after.mtimeNs, after.ctimeNs]).toEqual([before.size, before.mtimeNs, before.ctimeNs]);
    await expect(runWholeZipBuild(options())).rejects.toThrow("LOCAL_IO_FAILED");
  });
  it("continues short writes and cleans up ENOSPC or a failure before the final receipt", async () => {
    const sample = await open(selection, "r"), proto = Object.getPrototypeOf(sample), original = proto.write; await sample.close();
    const spy = vi.spyOn(proto, "write").mockImplementation(function(this: FileHandle, ...args: unknown[]) {
      const [data, offset, length, position] = args as [Uint8Array, number, number, number];
      return original.call(this, data, offset, Math.min(length, 7), position);
    });
    const result = await runWholeZipBuild(options()); expect(result.archiveBytes).toBeGreaterThan(jpeg.length); spy.mockRestore();
    const failure = vi.spyOn(proto, "write").mockRejectedValue(Object.assign(new Error("sentinel-private-path"), { code: "ENOSPC" }));
    await expect(runWholeZipBuild(options(path.join(root, "failed")))).rejects.toThrow(/^\[zip-builder\] LOCAL_IO_FAILED$/); failure.mockRestore();
    await expect(lstat(path.join(root, "failed"))).rejects.toThrow();
    const sync = proto.sync; let count = 0;
    const syncFailure = vi.spyOn(proto, "sync").mockImplementation(function(this: FileHandle) { if (++count === 2) return Promise.reject(new Error("before-receipt")); return sync.call(this); });
    await expect(runWholeZipBuild(options(path.join(root, "failed-sync")))).rejects.toThrow("LOCAL_IO_FAILED"); syncFailure.mockRestore(); await expect(lstat(path.join(root, "failed-sync"))).rejects.toThrow();
  });
  it("preserves unrelated and replaced files during failure cleanup", async () => {
    const out = path.join(root, "partial"), output = await createZipBuildOutput(out); await output.write(Buffer.from([1, 2, 3]));
    await rename(path.join(out, "delivery.zip"), path.join(out, "preserved-original")); await writeFile(path.join(out, "delivery.zip"), "unrelated", { mode: 0o600 });
    await output.abort(); expect(await readFile(path.join(out, "delivery.zip"), "utf8")).toBe("unrelated"); expect(await readdir(out)).toEqual(["delivery.zip", "preserved-original"]);
  });
  it("closes a newly created output descriptor even when its initial identity stat fails", async () => {
    const sample = await open(selection, "r"), proto = Object.getPrototypeOf(sample), stat = proto.stat; await sample.close(); let failedFd = -1;
    const spy = vi.spyOn(proto, "stat").mockImplementation(async function(this: FileHandle, ...args: unknown[]) {
      const info = await stat.call(this, ...args);
      if (info.isFile() && BigInt(info.size) === BigInt(0)) { failedFd = this.fd; throw new Error("private-stat-failure"); }
      return info;
    });
    await expect(runWholeZipBuild(options())).rejects.toThrow("LOCAL_IO_FAILED"); spy.mockRestore();
    expect(failedFd).toBeGreaterThanOrEqual(0); expect(() => fstatSync(failedFd)).toThrow(/EBADF/);
    // No reliable inode identity was obtained: preserve that private partial path.
    expect(await readdir(options().out)).toEqual(["delivery.zip"]);
  });
  it("rejects private-mode violations, links, root overlap and modified source/path/manifest identity", async () => {
    const file = path.join(exports, "private-name.jpg");
    for (const mutation of ["contents", "mode", "path"] as const) {
      const input = await openZipBuildInput(file, ZIP_BUILD_LIMITS.entry);
      try { if (mutation === "contents") await writeFile(file, jpeg); if (mutation === "mode") await chmod(file, 0o644); if (mutation === "path") { await rename(file, file + ".old"); await writeFile(file, jpeg, { mode: 0o600 }); } await expect(input.unchanged()).rejects.toThrow(/SOURCE_CHANGED|PRIVATE/); }
      finally { await input.handle.close(); await chmod(file, 0o600); }
    }
    const manifest = await openZipBuildInput(selection, ZIP_BUILD_LIMITS.selection); await writeFile(selection, "processed-jpeg-selection-v1\nprivate-name.jpg\n"); await expect(manifest.unchanged()).rejects.toThrow("SOURCE_CHANGED"); await manifest.handle.close();
    await chmod(file, 0o644); await expect(runWholeZipBuild(options())).rejects.toThrow("PRIVATE_INPUT_REQUIRED"); await chmod(file, 0o600);
    const hard = path.join(exports, "hard.jpg"); await link(file, hard); await expect(runWholeZipBuild(options())).rejects.toThrow("PRIVATE_INPUT_REQUIRED"); await rm(hard);
    const alias = path.join(root, "alias"); await symlink(exports, alias); await expect(runWholeZipBuild({ ...options(), root: alias })).rejects.toThrow("PRIVATE_PATH_REQUIRED");
    await expect(runWholeZipBuild(options(path.join(exports, "out")))).rejects.toThrow("OUTPUT_INPUT_ALIAS");
  });
  it("requires every Git artifact ignored/untracked, including receipt and neutral ZIP, despite GIT_* overrides", async () => {
    execFileSync("git", ["init", "--quiet", root]); vi.stubEnv("GIT_DIR", path.join(root, "nonexistent-git"));
    await expect(runWholeZipBuild(options())).rejects.toThrow("ARTIFACT_NOT_IGNORED");
    await writeFile(path.join(root, ".gitignore"), "selection.txt\nexports/\nresult/receipt.json\n"); await expect(runWholeZipBuild(options())).rejects.toThrow("ARTIFACT_NOT_IGNORED");
    await writeFile(path.join(root, ".gitignore"), "selection.txt\nexports/\nresult/\n"); expect((await runWholeZipBuild(options())).readyToUpload).toBe(false);
    vi.unstubAllEnvs(); execFileSync("git", ["-C", root, "add", "--force", "selection.txt"]); await expect(runWholeZipBuild(options(path.join(root, "another")))).rejects.toThrow("ARTIFACT_TRACKED");
  });
  it("fails cleanly when the OS file-descriptor limit refuses a selected set", async () => {
    const names: string[] = [];
    for (let i = 0; i < 64; i++) { const name = `file-${i}.jpg`; await writeFile(path.join(exports, name), jpeg, { mode: 0o600 }); names.push(name); }
    await writeFile(selection, "processed-jpeg-selection-v1\n" + names.join("\n") + "\n");
    const result = spawnSync("/bin/sh", ["-c", 'ulimit -n 48; exec "$@"', "zip-test", process.execPath, cli, ...argumentsFor()], { encoding: "utf8", timeout: 20_000 });
    expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toMatch(/^\[zip-builder\] (LOCAL_IO_FAILED|GIT_GUARD_FAILED)\n$/); await expect(lstat(options().out)).rejects.toThrow();
  });
  it("keeps errors fixed and private for missing sources or invalid classification", () => {
    for (const args of [[...argumentsFor().slice(0, -1), "camera-master"], ["--selection", path.join(root, "customer-secret"), "--root", exports, "--out", options().out, "--classification", "processed-jpeg-exports"]]) {
      const result = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" }); expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr).toMatch(/^\[zip-builder\] [A-Z_]+\n$/); expect(result.stderr).not.toContain(root);
    }
  });
  it("builds one whole125MB ZIP with bounded live buffers, independent CRC/hash checks and SIGTERM cleanup", async () => {
    const names: string[] = [], segment = Buffer.alloc(65_534, 0x5a), expectedHash = createHash("sha256");
    segment[0] = 0xff; segment[1] = 0xfe; segment.writeUInt16BE(segment.length - 2, 2);
    expectedHash.update(jpeg.subarray(0, 2)); for (let i = 0; i < 320; i++) expectedHash.update(segment); expectedHash.update(jpeg.subarray(2));
    const expectedMemberHash = expectedHash.digest("hex"), memberSize = jpeg.length + 320 * segment.length;
    for (let index = 0; index < 6; index++) {
      const name = `selected-${index}.jpg`, file = await open(path.join(exports, name), "wx", 0o600); names.push(name);
      try { await file.writeFile(jpeg.subarray(0, 2)); for (let i = 0; i < 320; i++) await file.writeFile(segment); await file.writeFile(jpeg.subarray(2)); }
      finally { await file.close(); }
    }
    const selectionText = "processed-jpeg-selection-v1\n" + names.join("\n") + "\n"; await writeFile(selection, selectionText);
    const probe = `import {open} from 'node:fs/promises';import {setImmediate as turn} from 'node:timers/promises';
      import {runWholeZipBuild,parseZipBuildArguments} from ${JSON.stringify(pathToFileURL(cli).href)};
      const sample=await open(process.argv[1],'r'),proto=Object.getPrototypeOf(sample),read=proto.read,write=proto.write;await sample.close();
      global.gc();const baseline=process.memoryUsage().arrayBuffers;let maxRead=0,maxWrite=0,requested=0,retainedBytes,measured=false;
      proto.read=async function(buffer,offset,length,position){maxRead=Math.max(maxRead,length);requested+=length;const r=await read.call(this,buffer,offset,length,position);
        if(!measured&&requested>100_000_000){measured=true;for(let i=0;i<3;i++){await turn();global.gc();}retainedBytes=process.memoryUsage().arrayBuffers-baseline;}return r;};
      proto.write=async function(buffer,offset,length,position){maxWrite=Math.max(maxWrite,length);return write.call(this,buffer,offset,length,position);};
      const receipt=await runWholeZipBuild(parseZipBuildArguments(process.argv.slice(2)));
      console.log(JSON.stringify({receipt,maxRead,maxWrite,requested,measured,retainedBytes}));`;
    const result = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", probe, selection, ...argumentsFor()], { encoding: "utf8", timeout: 30_000 });
    expect(result.status).toBe(0); expect(result.stderr).toBe(""); const report = JSON.parse(result.stdout);
    expect(report.maxRead).toBeLessThanOrEqual(65_536); expect(report.maxWrite).toBeLessThanOrEqual(65_536);
    expect(report.requested).toBeLessThanOrEqual(memberSize * 6 + Buffer.byteLength(selectionText) + 6 * 5);
    expect(report.measured).toBe(true); expect(report.retainedBytes).toBeLessThan(8 * 1024 * 1024); expect(report.receipt.archiveBytes).toBeGreaterThan(100_000_000);
    // Independent Node reader, not the writer's encoder or an unmerged315 module.
    const fd = await open(path.join(options().out, "delivery.zip"), "r"), size = Number((await fd.stat()).size);
    async function read(at: number, length: number) { const data = Buffer.alloc(length); expect((await fd.read(data, 0, length, at)).bytesRead).toBe(length); return data; }
    try {
      const end = await read(size - 22, 22); expect(end.readUInt32LE(0)).toBe(0x06054b50); expect(end.readUInt16LE(10)).toBe(6);
      const centralStart = end.readUInt32LE(16); let local = 0, central = centralStart;
      for (let index = 0; index < 6; index++) {
        const entry = await read(central, 60), name = `image-${String(index + 1).padStart(4, "0")}.jpg`;
        expect(entry.readUInt32LE(0)).toBe(0x02014b50); expect(entry.subarray(46).toString()).toBe(name); expect(entry.readUInt32LE(42)).toBe(local); expect(entry.readUInt32LE(24)).toBe(memberSize);
        const header = await read(local, 44); expect(header.readUInt32LE(0)).toBe(0x04034b50); expect(header.readUInt16LE(6)).toBe(0x0808); expect(header.subarray(30).toString()).toBe(name);
        let crc = 0; const digest = createHash("sha256");
        for (let at = 0; at < memberSize;) { const chunk = await read(local + 44 + at, Math.min(65_536, memberSize - at)); crc = crc32(chunk, crc); digest.update(chunk); at += chunk.length; }
        expect(digest.digest("hex")).toBe(expectedMemberHash); expect(entry.readUInt32LE(16)).toBe(crc);
        const descriptor = await read(local + 44 + memberSize, 16); expect(descriptor.readUInt32LE(0)).toBe(0x08074b50); expect(descriptor.readUInt32LE(4)).toBe(crc); expect(descriptor.readUInt32LE(8)).toBe(memberSize);
        local += 44 + memberSize + 16; central += 60;
      }
      expect(local).toBe(centralStart); expect(central).toBe(size - 22);
      const archive = createHash("sha256"); for (let at = 0; at < size;) { const chunk = await read(at, Math.min(65_536, size - at)); archive.update(chunk); at += chunk.length; }
      expect(archive.digest("hex")).toBe(report.receipt.archiveSha256);
    } finally { await fd.close(); }
    const interrupted = path.join(root, "interrupted"), child = spawn(process.execPath, [cli, ...argumentsFor(interrupted)], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "", stdout = ""; child.stderr.on("data", data => { stderr += data; }); child.stdout.on("data", data => { stdout += data; });
    const exited = new Promise<number | null>(resolve => child.once("exit", code => resolve(code)));
    let sent = false;
    for (let i = 0; i < 2500 && child.exitCode === null; i++) {
      if (await lstat(path.join(interrupted, "delivery.zip")).catch(() => undefined)) { child.kill("SIGTERM"); sent = true; break; }
      await new Promise(resolve => setTimeout(resolve, 2));
    }
    expect(sent).toBe(true); expect(await exited).toBe(1); expect(stdout).toBe(""); expect(stderr).toBe("[zip-builder] CANCELLED\n"); await expect(lstat(interrupted)).rejects.toThrow();
  }, 45_000);
});
