import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { chmodSync, existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assertSingleJpeg, auditJpegExports, decodeProcessedJpeg } from "./jpeg-export-audit.mts";
import { buildWholeDeliveryZip } from "./delivery-zip-build.mts";
import { inspectDeliveryZip } from "./delivery-zip-integrity.mts";
import { parseJpegAuditArguments, runJpegExportAudit } from "./verify-jpeg-exports.mts";
import { writeJpegAuditArtifacts } from "./jpeg-audit-files.mts";
import * as zipFiles from "./delivery-zip-build-files.mts";
const exec = promisify(execFile), roots: string[] = [], hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const selection = (...names: string[]) => Buffer.from(`processed-jpeg-selection-v1\n${names.join("\n")}\n`);
async function jpeg(w = 80, h = 40, progressive = false) {
  return sharp({ create: { width: w, height: h, channels: 3, background: "red" } }).withExif({ IFD0: { Artist: "private-exif-canary" } }).jpeg({ progressive }).toBuffer();
}
function source(bytes: Buffer) { return { size: bytes.length, async read(at: number, length: number) { return bytes.subarray(at, at + length); }, async unchanged() {} }; }
async function setup() {
  const base = await mkdtemp(path.join(os.tmpdir(), "jpeg-audit-private-canary-")); roots.push(base); await chmod(base, 0o700);
  const root = path.join(base, "exports"), list = path.join(base, "selection.txt"), out = path.join(base, "report"); await mkdir(root, { mode: 0o700 });
  await writeFile(path.join(root, "private-original-canary.jpg"), await jpeg(), { mode: 0o600 }); await writeFile(list, selection("private-original-canary.jpg"), { mode: 0o600 });
  return { base, root, out, selection: list };
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
describe("full JPEG technical decode", () => {
  it.each([false, true])("decodes real baseline/progressive=%s JPEG with exact unchanged metadata bytes", async progressive => {
    const input = await jpeg(80, 40, progressive), before = Buffer.from(input);
    expect(await decodeProcessedJpeg(input)).toEqual({ width: 80, height: 40 }); expect(input).toEqual(before);
  });
  it("reports normalized dimensions only for oriented JPEG and accepts grayscale/CMYK", async () => {
    const oriented = await sharp({ create: { width: 80, height: 40, channels: 3, background: "red" } }).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    expect(await decodeProcessedJpeg(oriented)).toEqual({ width: 40, height: 80 });
    const gray = await sharp(await jpeg()).greyscale().jpeg().toBuffer(), cmyk = await sharp(await jpeg()).toColourspace("cmyk").jpeg().toBuffer();
    expect(await decodeProcessedJpeg(gray)).toEqual({ width: 80, height: 40 }); expect(await decodeProcessedJpeg(cmyk)).toEqual({ width: 80, height: 40 });
  });
  it("ignores nested SOI/EOI bytes in a real EXIF thumbnail and accepts ICC APP2", async () => {
    const thumbnail = await jpeg(8, 6), input = await jpeg(), payload = Buffer.concat([Buffer.from("Exif\0\0"), thumbnail]);
    const segment = Buffer.alloc(payload.length + 4); segment[0] = 255; segment[1] = 225; segment.writeUInt16BE(payload.length + 2, 2); payload.copy(segment, 4);
    // A malformed EXIF wrapper is valid opaque APP data: the JPEG walker must not scan through it.
    const withNested = Buffer.concat([input.subarray(0, 2), segment, input.subarray(2)]); expect(() => assertSingleJpeg(withNested)).not.toThrow();
    const profiled = await sharp(input).withIccProfile("p3").jpeg().toBuffer(); expect(await decodeProcessedJpeg(profiled)).toEqual({ width: 80, height: 40 });
  });
  it("rejects concat/trailing bytes, multipicture, unsupported frames and missing EOI", async () => {
    const input = await jpeg(), mpf = Buffer.from([255, 226, 0, 6, 77, 80, 70, 0]);
    for (const b of [Buffer.concat([input, input]), Buffer.concat([input, Buffer.from([0])]), input.subarray(0, -1), Buffer.concat([input.subarray(0, 2), mpf, input.subarray(2)]), Buffer.from([255, 216, 255, 195, 0, 2, 255, 217])]) await expect(decodeProcessedJpeg(b)).rejects.toThrow(/\[jpeg-audit\]/);
  });
  it("rejects SOI/EOI-shaped invalid entropy and actual non-JPEG bytes", async () => {
    const input = await jpeg(), sos = input.indexOf(Buffer.from([255, 218])); expect(sos).toBeGreaterThan(0);
    const end = sos + 2 + input.readUInt16BE(sos + 2), corrupted = Buffer.concat([input.subarray(0, end), Buffer.from([255, 217])]);
    expect(() => assertSingleJpeg(corrupted)).not.toThrow();
    await expect(decodeProcessedJpeg(corrupted)).rejects.toThrow("JPEG_DECODE_FAILED");
    const png = await sharp(input).png().toBuffer(); await expect(decodeProcessedJpeg(png)).rejects.toThrow("INVALID_JPEG");
  });
  it("rejects unsafe image dimensions before full decoding", async () => {
    const input = await jpeg(), marker = input.indexOf(Buffer.from([255, 192])); expect(marker).toBeGreaterThan(0);
    const huge = Buffer.from(input); huge.writeUInt16BE(20_000, marker + 5); huge.writeUInt16BE(20_000, marker + 7);
    await expect(decodeProcessedJpeg(huge)).rejects.toThrow("PIXEL_LIMIT");
  });
});
describe("explicit ordered export set", () => {
  it("produces an identical intended-byte manifest to the existing whole ZIP builder", async () => {
    const inputs = [await jpeg(80, 40), await jpeg(30, 60, true)], ports = inputs.map(source), list = selection("a.jpg", "b.jpeg");
    const audit = await auditJpegExports(ports, list), chunks: Buffer[] = [];
    const zip = await buildWholeDeliveryZip(ports, { async write(bytes) { chunks.push(Buffer.from(bytes)); } });
    expect(audit.manifest).toBe(zip.manifest); expect(audit.receipt.images.map(i => [i.width, i.height])).toEqual([[80, 40], [30, 60]]);
    expect(inspectDeliveryZip(Buffer.concat(chunks), Buffer.from(audit.manifest))).toMatchObject({ entries: 2, archiveSha256: zip.receipt.archiveSha256 });
    expect(JSON.stringify(audit)).not.toMatch(/private-exif-canary|orientation|Artist/); expect(audit.receipt.readyToUpload).toBe(false);
  });
  it("allows identical bytes in distinct files, binds exact bytes and caps chunk reads", async () => {
    const bytes = await jpeg(), original = Buffer.from(bytes), port = { ...source(bytes), async read(at: number, count: number) { expect(count).toBeLessThanOrEqual(65536); return bytes.subarray(at, at + count); } };
    const audit = await auditJpegExports([port, port], selection("a.jpg", "b.jpg")); expect(audit.receipt.images.map(i => i.sha256)).toEqual([hash(bytes), hash(bytes)]); expect(bytes).toEqual(original);
  });
  it("refuses aggregate bytes before reads and malformed selection/counts", async () => {
    let reads = 0; const huge = { size: 25_000_000, async read() { reads++; return Buffer.alloc(0); }, async unchanged() {} };
    await expect(auditJpegExports(Array.from({ length: 41 }, () => huge), selection(...Array.from({ length: 41 }, (_, i) => `${i}.jpg`)))).rejects.toThrow("INPUT_LIMIT"); expect(reads).toBe(0);
    await expect(auditJpegExports([], selection("a.jpg"))).rejects.toThrow("INVALID_INPUT");
    await expect(auditJpegExports([source(await jpeg())], selection("../a.jpg"))).rejects.toThrow();
  });
  it("cancels hanging reads/decoders with distinct deadline vs caller codes and one listener", async () => {
    const bytes = await jpeg(), controller = new AbortController();
    const cancelled = auditJpegExports([source(bytes)], selection("a.jpg"), { signal: controller.signal, decode: async () => { controller.abort(); return new Promise(() => {}); } });
    await expect(cancelled).rejects.toThrow("INTERRUPTED");
    await expect(auditJpegExports([{ ...source(bytes), read: async () => new Promise(() => {}) }], selection("a.jpg"), { timeoutMs: 5 })).rejects.toThrow("DEADLINE_EXCEEDED");
    await expect(auditJpegExports([source(bytes)], selection("a.jpg"), { timeoutMs: 5, decode: async () => new Promise(() => {}) })).rejects.toThrow("DEADLINE_EXCEEDED");
  });
  it("preserves an upstream deadline across hanging decode instead of reporting caller interruption", async () => {
    const bytes = await jpeg();
    await expect(auditJpegExports([source(bytes)], selection("a.jpg"), {
      signal: AbortSignal.timeout(5), decode: async () => new Promise(() => {}),
    })).rejects.toThrow("DEADLINE_EXCEEDED");
  });
  it("freezes the supplied selection before asynchronous decoding", async () => {
    const bytes = await jpeg(), list = selection("a.jpg"), expected = hash(list);
    const pending = auditJpegExports([source(bytes)], list); list.fill(0);
    expect((await pending).receipt.selectionSha256).toBe(expected);
  });
  it("releases completed input/decode buffers during a real isolated Node audit", async () => {
    const script = `
      import sharp from 'sharp';
      import { auditJpegExports, decodeProcessedJpeg } from './scripts/jpeg-export-audit.mts';
      const tiny = await sharp({create:{width:40,height:20,channels:3,background:'red'}}).jpeg().toBuffer();
      const app = Buffer.alloc(60004, 32); app[0]=255; app[1]=239; app.writeUInt16BE(60002,2);
      const bytes = Buffer.concat([tiny.subarray(0,2), ...Array.from({length:18},()=>app), tiny.subarray(2)]);
      const selected = Buffer.from('processed-jpeg-selection-v1\\n'+Array.from({length:96},(_,i)=>i+'.jpg').join('\\n')+'\\n');
      const port = {size:bytes.length,async read(at,n){return bytes.subarray(at,at+n)},async unchanged(){}};
      for(let i=0;i<3;i++){await decodeProcessedJpeg(bytes);global.gc();await new Promise(r=>setImmediate(r));}
      global.gc();const baseline=process.memoryUsage().arrayBuffers;let worst=0,count=0;
      await auditJpegExports(Array.from({length:96},()=>port),selected,{decode:async input=>{
        const value=await decodeProcessedJpeg(input);
        if(++count%16===0){await new Promise(r=>setImmediate(r));global.gc();await new Promise(r=>setImmediate(r));global.gc();worst=Math.max(worst,process.memoryUsage().arrayBuffers-baseline);}
        return value;
      }});
      console.log(JSON.stringify({worst,count}));
    `;
    const { stdout } = await exec(process.execPath, ["--expose-gc", "--input-type=module", "-e", script], { maxBuffer: 4096 });
    const result = JSON.parse(stdout); expect(result.count).toBe(96); expect(result.worst).toBeLessThan(8 * 1024 * 1024);
  }, 30_000);
  it("does not turn a changed source into an accepted audit", async () => {
    const bytes = await jpeg(); let checks = 0;
    await expect(auditJpegExports([{ ...source(bytes), async unchanged() { if (++checks === 3) throw Error("source replaced"); } }], selection("a.jpg"))).rejects.toThrow("LOCAL_INPUT_FAILED");
  });
});
describe("owner-private actual command", () => {
  it("runs real CLI, preserves input bytes and prints only neutral technical values", async () => {
    const f = await setup(), original = await readFile(path.join(f.root, "private-original-canary.jpg")), beforeList = await readFile(f.selection);
    const { stdout, stderr } = await exec(process.execPath, ["scripts/verify-jpeg-exports.mts", "--selection", f.selection, "--root", f.root, "--out", f.out, "--classification", "processed-jpeg-exports"]);
    expect(stderr).toBe(""); const receipt = JSON.parse(stdout); expect(receipt.count).toBe(1); expect(receipt.readyToUpload).toBe(false);
    expect(stdout).not.toMatch(/private-original-canary|private-exif-canary|jpeg-audit-private-canary/);
    expect(await readdir(f.out)).toEqual(["entries.tsv", "receipt.json"]); expect(JSON.parse(await readFile(path.join(f.out, "receipt.json"), "utf8"))).toEqual(receipt);
    expect(hash(await readFile(path.join(f.out, "entries.tsv")))).toBe(receipt.manifestSha256);
    expect(await readFile(path.join(f.root, "private-original-canary.jpg"))).toEqual(original); expect(await readFile(f.selection)).toEqual(beforeList);
    for (const name of await readdir(f.out)) expect((await lstat(path.join(f.out, name))).mode & 0o777).toBe(0o600);
  });
  it("refuses unsafe arguments/output/root/input policies with no partial report", async () => {
    const f = await setup(), args = ["--selection", f.selection, "--root", f.root, "--out", f.out, "--classification", "processed-jpeg-exports"];
    for (const invalid of [[...args, "--extra", "x"], args.slice(0, -2), args.map(v => v === f.out ? f.root : v), args.map(v => v === "processed-jpeg-exports" ? "camera-master" : v)]) expect(() => parseJpegAuditArguments(invalid)).toThrow();
    await chmod(path.join(f.root, "private-original-canary.jpg"), 0o644); await expect(runJpegExportAudit(f)).rejects.toThrow("LOCAL_INPUT_FAILED"); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
    await chmod(path.join(f.root, "private-original-canary.jpg"), 0o600); await rename(path.join(f.root, "private-original-canary.jpg"), path.join(f.root, "real.jpg")); await symlink(path.join(f.root, "real.jpg"), path.join(f.root, "private-original-canary.jpg"));
    await expect(runJpegExportAudit(f)).rejects.toThrow("LOCAL_INPUT_FAILED");
  });
  it("closes descriptors if a later open fails and never overwrites an existing report", async () => {
    const f = await setup(); await writeFile(f.selection, selection("private-original-canary.jpg", "missing.jpg"));
    const original = zipFiles.openZipBuildInput, held: Awaited<ReturnType<typeof original>>[] = [];
    vi.spyOn(zipFiles, "openZipBuildInput").mockImplementation(async (...args) => { const input = await original(...args); held.push(input); return input; });
    await expect(runJpegExportAudit(f)).rejects.toThrow("LOCAL_INPUT_FAILED");
    for (const input of held) await expect(input.handle.stat()).rejects.toMatchObject({ code: "EBADF" });
    await writeFile(f.selection, selection("private-original-canary.jpg")); await mkdir(f.out, { mode: 0o700 }); await writeFile(path.join(f.out, "existing"), "preserve");
    await expect(runJpegExportAudit(f)).rejects.toThrow("LOCAL_INPUT_FAILED"); expect(await readFile(path.join(f.out, "existing"), "utf8")).toBe("preserve");
  });
  it("preserves the shared CLI deadline during reads and final artifact verification", async () => {
    const f = await setup(), controller = new AbortController(), original = zipFiles.openZipBuildInput;
    vi.spyOn(AbortSignal, "timeout").mockReturnValueOnce(controller.signal);
    vi.spyOn(zipFiles, "openZipBuildInput").mockImplementation(async (...args) => {
      const input = await original(...args);
      if (args[0] !== f.selection) {
        const read = input.read;
        input.read = async (...where) => { controller.abort(new DOMException("", "TimeoutError")); return read(...where); };
      }
      return input;
    });
    await expect(runJpegExportAudit(f)).rejects.toThrow("DEADLINE_EXCEEDED"); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
    vi.restoreAllMocks();
    const g = await setup(), report = await auditJpegExports([source(await jpeg())], selection("a.jpg")), deadline = new AbortController(); let checks = 0;
    await expect(writeJpegAuditArtifacts(g.out, report, async () => {
      if (++checks === 5) deadline.abort(new DOMException("", "TimeoutError"));
    }, deadline.signal)).rejects.toThrow("DEADLINE_EXCEEDED");
    await expect(lstat(g.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("refuses report permissions changed while artifact bytes are being written", async () => {
    const f = await setup(), controller = new AbortController(), outputFile = path.join(f.out, "entries.tsv"), report = await auditJpegExports([source(await jpeg())], selection("a.jpg"));
    let changed = false;
    Object.defineProperty(controller.signal, "aborted", { get() { if (!changed && existsSync(outputFile)) { changed = true; chmodSync(outputFile, 0o644); } return false; } });
    await expect(writeJpegAuditArtifacts(f.out, report, async () => {}, controller.signal)).rejects.toThrow("OUTPUT_CHANGED");
    await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("removes only its own artifacts after changed sources/cancellation through receipt completion", async () => {
    const f = await setup(), report = await auditJpegExports([source(await jpeg())], selection("a.jpg")); let checks = 0;
    await expect(writeJpegAuditArtifacts(f.out, report, async () => { if (++checks === 5) throw Error("changed"); })).rejects.toThrow("changed"); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
    const g = await setup(), controller = new AbortController(); checks = 0;
    await expect(writeJpegAuditArtifacts(g.out, report, async () => { if (++checks === 5) controller.abort(); }, controller.signal)).rejects.toThrow("INTERRUPTED"); await expect(lstat(g.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("preserves foreign files on refusal and emits redacted CLI failures", async () => {
    const f = await setup(), report = await auditJpegExports([source(await jpeg())], selection("a.jpg")); let calls = 0;
    await expect(writeJpegAuditArtifacts(f.out, report, async () => { if (++calls === 3) await writeFile(path.join(f.out, "foreign"), "preserve"); })).rejects.toThrow("OUTPUT_CHANGED"); expect(await readdir(f.out)).toEqual(["foreign"]);
    const g = await setup(); await writeFile(path.join(g.root, "private-original-canary.jpg"), "private-error-canary");
    try { await exec(process.execPath, ["scripts/verify-jpeg-exports.mts", "--selection", g.selection, "--root", g.root, "--out", g.out, "--classification", "processed-jpeg-exports"]); throw Error("expected failure"); }
    catch (error) { const e = error as { stdout: string; stderr: string }; expect(e.stdout).toBe(""); expect(e.stderr).toBe("[jpeg-audit] INVALID_JPEG\n"); }
  });
});
