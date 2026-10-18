import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import { mkdtemp, mkdir, chmod, readFile, writeFile, lstat, readdir, rm, symlink, link, readlink } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { getEventListeners } from "node:events";
import { auditJpegMetadata, inventoryJpegEnvelopes, JPEG_ENVELOPE_CATEGORIES } from "./jpeg-metadata-inventory.mts";
import { assertSingleJpeg, auditJpegExports, walkSingleJpegSegments } from "./jpeg-export-audit.mts";
import { runJpegMetadataInventory } from "./inventory-jpeg-metadata.mts";
import { buildWholeDeliveryZip } from "./delivery-zip-build.mts";
import { inspectDeliveryZip } from "./delivery-zip-integrity.mts";
import { writeJpegAuditArtifacts } from "./jpeg-audit-files.mts";
import * as files from "./delivery-zip-build-files.mts";
const exec = promisify(execFile), roots: string[] = [];
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const selection = (...names: string[]) => Buffer.from(`processed-jpeg-selection-v1\n${names.join("\n")}\n`);
const source = (bytes: Buffer) => ({ size: bytes.length, async read(at: number, count: number) { return bytes.subarray(at, at + count); }, async unchanged() {} });
async function jpeg(progressive = false) { return sharp({ create: { width: 32, height: 16, channels: 3, background: "red" } }).withExif({ IFD0: { Artist: "private-metadata-value-canary" } }).jpeg({ progressive }).toBuffer(); }
function segment(marker: number, payload = Buffer.alloc(0)) { const out = Buffer.alloc(payload.length + 4); out[0] = 255; out[1] = marker; out.writeUInt16BE(payload.length + 2, 2); payload.copy(out, 4); return out; }
function inject(bytes: Buffer, ...segments: Buffer[]) { return Buffer.concat([bytes.subarray(0, 2), ...segments, bytes.subarray(2)]); }
const signatures = [[0xe1, "Exif\0\0", 6], [0xe1, "http://ns.adobe.com/xap/1.0/\0", 29], [0xe1, "http://ns.adobe.com/xmp/extension/\0", 35], [0xe2, "ICC_PROFILE\0", 12], [0xed, "Photoshop 3.0\0", 14], [0xe0, "JFIF\0", 5], [0xe0, "JFXX\0", 5], [0xee, "Adobe", 5]] as const;
async function setup() {
  const base = await mkdtemp(path.join(os.tmpdir(), "jpeg-metadata-private-canary-")); roots.push(base); await chmod(base, 0o700);
  const root = path.join(base, "exports"), selected = path.join(base, "selection.txt"), out = path.join(base, "report"); await mkdir(root, { mode: 0o700 });
  await writeFile(path.join(root, "private-source-canary.jpg"), await jpeg(), { mode: 0o600 }); await writeFile(selected, selection("private-source-canary.jpg"), { mode: 0o600 });
  return { base, root, out, selection: selected };
}
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("opaque metadata header-prefix inventory", () => {
  it.each([false, true])("inventories real ordinary/progressive=%s JPEG without changing a byte or emitting values", async progressive => {
    const bytes = await jpeg(progressive), before = Buffer.from(bytes), baseline = inventoryJpegEnvelopes(bytes);
    expect(baseline.headerSegments[0]).toBeGreaterThan(0); expect(baseline.payloadBytes[0]).toBeGreaterThan(0); expect(bytes).toEqual(before);
    expect(JSON.stringify(baseline)).not.toMatch(/private|Artist|Exif|orientation/);
    const profiled = await sharp(bytes).withIccProfile("p3").jpeg({ progressive }).toBuffer(); expect(inventoryJpegEnvelopes(profiled).headerSegments[3]).toBeGreaterThan(0);
  });
  it("pins exact marker/signature lengths and counts even opaque invalid contents as prefix matches only", async () => {
    const bytes = await jpeg(), baseline = inventoryJpegEnvelopes(bytes);
    for (const [index, [marker, text, length]] of signatures.entries()) {
      const prefix = Buffer.from(text); expect(prefix.length).toBe(length);
      const data = Buffer.concat([prefix, Buffer.from("private-invalid-XML-TIFF-profile-canary")]);
      const result = inventoryJpegEnvelopes(inject(bytes, segment(marker, data), segment(marker, data)));
      expect(result.headerSegments[index] - baseline.headerSegments[index]).toBe(2); expect(result.payloadBytes[index] - baseline.payloadBytes[index]).toBe(2 * data.length);
      expect(JSON.stringify(result)).not.toContain("canary");
    }
  });
  it("does not read prefixes past a short segment, match a wrong marker or assume nonstandard Exif is absent", async () => {
    const bytes = await jpeg(), baseline = inventoryJpegEnvelopes(bytes);
    for (const [marker, text] of signatures) {
      const prefix = Buffer.from(text), parts = [segment(marker, prefix.subarray(0, -1)), segment(0xe3, prefix)];
      const result = inventoryJpegEnvelopes(inject(bytes, ...parts));
      expect(result.headerSegments.slice(0, 8)).toEqual(baseline.headerSegments.slice(0, 8)); expect(result.headerSegments[9] - baseline.headerSegments[9]).toBe(2);
    }
    const variant = inventoryJpegEnvelopes(inject(bytes, segment(0xe1, Buffer.from("Exif\0\xff", "latin1"))));
    expect(variant.headerSegments[0]).toBe(baseline.headerSegments[0]); expect(variant.headerSegments[9] - baseline.headerSegments[9]).toBe(1);
  });
  it("counts a nested JPEG thumbnail as one opaque Exif segment and keeps empty/repeated COM and unknown APP", async () => {
    const bytes = await jpeg(), baseline = inventoryJpegEnvelopes(bytes), payload = Buffer.concat([Buffer.from("Exif\0\0"), bytes]);
    const result = inventoryJpegEnvelopes(inject(bytes, segment(0xe1, payload), segment(0xfe), segment(0xfe, Buffer.from("private-comment-canary")), segment(0xeb, Buffer.from("private-vendor-canary"))));
    expect(result.headerSegments[0] - baseline.headerSegments[0]).toBe(1); expect(result.payloadBytes[0] - baseline.payloadBytes[0]).toBe(payload.length);
    expect(result.headerSegments[8] - baseline.headerSegments[8]).toBe(2); expect(result.payloadBytes[8] - baseline.payloadBytes[8]).toBe(22);
    expect(result.headerSegments[9] - baseline.headerSegments[9]).toBe(1);
  });
  it("traverses scan boundaries, fill/restart/stuffed bytes without finding APP/COM in synthetic nondecodable entropy", () => {
    const entropy = Buffer.from([0x11, 255, 0, 0xe1, 0, 8, 69, 120, 105, 102, 0, 0, 255, 0xd0, 255, 255, 0xd1, 0x22]);
    const bytes = Buffer.concat([Buffer.from([255, 216]), segment(0xc2), segment(0xda), entropy,
      Buffer.from([255]), segment(0xed, Buffer.from("Photoshop 3.0\0")), segment(0xda), entropy, segment(0xfe), Buffer.from([255, 217])]);
    const result = inventoryJpegEnvelopes(bytes);
    expect(result.headerSegments).toEqual([0, 0, 0, 0, 1, 0, 0, 0, 1, 0]); expect(result.payloadBytes[4]).toBe(14);
    // This proves marker-envelope traversal, never pixel decodability.
  });
  it("preserves parser outcomes/codes across every truncation and propagates visitor errors without partial inventory", async () => {
    const bytes = await jpeg();
    const code = (call: () => unknown) => { try { call(); return "accepted"; } catch (error) { return (error as Error).message; } };
    for (let length = 0; length <= bytes.length; length++) {
      const cut = bytes.subarray(0, length);
      expect(code(() => walkSingleJpegSegments(cut, () => {}))).toBe(code(() => assertSingleJpeg(cut)));
      expect(code(() => inventoryJpegEnvelopes(cut))).toBe(code(() => assertSingleJpeg(cut)));
    }
    const sentinel = Error("visitor-private-canary"); expect(() => walkSingleJpegSegments(bytes, () => { throw sentinel; })).toThrow(sentinel);
    const malformed = Buffer.from([255, 225, 0, 1]);
    for (const bad of [inject(bytes, malformed), bytes.subarray(0, -1), Buffer.concat([bytes, Buffer.from([0])]), Buffer.concat([bytes, bytes]), inject(bytes, segment(0xe2, Buffer.from("MPF\0")))]) expect(() => inventoryJpegEnvelopes(bad)).toThrow(/\[jpeg-audit\]/);
  });
});

describe("private ordered metadata evidence", () => {
  it("uses the exact builder/decode manifest and keeps each selected hash/order without metadata values", async () => {
    const bytes = [await jpeg(), await jpeg(true)], ports = bytes.map(source), selected = selection("private-a.jpg", "private-b.jpeg"), before = bytes.map(x => Buffer.from(x));
    const result = await auditJpegMetadata(ports, selected), decoded = await auditJpegExports(ports, selected), chunks: Buffer[] = [];
    const built = await buildWholeDeliveryZip(ports, { async write(b) { chunks.push(Buffer.from(b)); } });
    expect(result.manifest).toBe(decoded.manifest); expect(result.manifest).toBe(built.manifest); expect(inspectDeliveryZip(Buffer.concat(chunks), Buffer.from(result.manifest)).entries).toBe(2);
    expect(result.receipt.images.map(x => x.sha256)).toEqual(bytes.map(hash)); expect(bytes).toEqual(before); expect(result.receipt.readyToUpload).toBe(false); expect(result.receipt.published).toBe(false);
    expect(result.receipt.checks).toMatchObject({ metadataSuitability: "unproven-even-with-zero-counts", jpegDecoding: "not-performed", metadataPayloads: "opaque-not-parsed-or-validated", publicationPermission: "not-established" });
    expect(JSON.stringify(result)).not.toMatch(/private-|Artist|GPS|orientation/); expect(result.receipt.categories).toEqual(JPEG_ENVELOPE_CATEGORIES);
  });
  it("bounds all reads, verifies EOF, rejects aggregate limits before IO and snapshots selection", async () => {
    const tiny = await jpeg(), app = segment(0xef, Buffer.alloc(60_000)), bytes = inject(tiny, app, app), list = selection("a.jpg"), expected = hash(list), read = vi.fn(async (at: number, count: number) => { expect(count).toBeLessThanOrEqual(65_536); return bytes.subarray(at, at + count); });
    const pending = auditJpegMetadata([{ ...source(bytes), read }], list); list.fill(0); const result = await pending;
    expect(result.receipt.selectionSha256).toBe(expected); expect(read.mock.calls.at(-1)).toEqual([bytes.length, 1]);
    const huge = { ...source(tiny), size: 25_000_000, read: vi.fn() };
    await expect(auditJpegMetadata(Array(41).fill(huge), selection(...Array.from({ length: 41 }, (_, i) => `${i}.jpg`)))).rejects.toThrow("INPUT_LIMIT"); expect(huge.read).not.toHaveBeenCalled();
    await expect(auditJpegMetadata([{ ...source(tiny), read: async (at, count) => at === tiny.length ? Buffer.from([0]) : tiny.subarray(at, at + count) }], selection("a.jpg"))).rejects.toThrow("SOURCE_CHANGED");
    await expect(auditJpegMetadata([], selection("a.jpg"))).rejects.toThrow("INVALID_INPUT");
  });
  it("preserves timeout/caller cancellation and removes per-await listeners, including final unchanged checks", async () => {
    const bytes = await jpeg(), controller = new AbortController(); controller.abort();
    await expect(auditJpegMetadata([source(bytes)], selection("a.jpg"), { signal: controller.signal })).rejects.toThrow("INTERRUPTED");
    await expect(auditJpegMetadata([{ ...source(bytes), read: async () => new Promise(() => {}) }], selection("a.jpg"), { timeoutMs: 5 })).rejects.toThrow("DEADLINE_EXCEEDED");
    const live = new AbortController(); await auditJpegMetadata([source(bytes)], selection("a.jpg"), { signal: live.signal }); expect(getEventListeners(live.signal, "abort")).toHaveLength(0);
    let checks = 0; await expect(auditJpegMetadata([{ ...source(bytes), async unchanged() { if (++checks === 4) throw Error("private-change-canary"); } }], selection("a.jpg"))).rejects.toThrow("LOCAL_INPUT_FAILED");
  });
  it("fits a worst-case256-image pretty receipt with8-digit counters inside the real writer budget", async () => {
    const report = await auditJpegMetadata([source(await jpeg())], selection("a.jpg"));
    const worst = { ...report.receipt, count: 256, images: Array.from({ length: 256 }, (_, i) => ({ ...report.receipt.images[0], name: `image-${String(i + 1).padStart(4, "0")}.jpg`, bytes: 25_000_000, sha256: "f".repeat(64), headerSegments: Array(10).fill(99_999_999), payloadBytes: Array(10).fill(99_999_999) })) };
    expect(Buffer.byteLength(JSON.stringify(worst, null, 2) + "\n")).toBeLessThanOrEqual(256_000);
    const f = await setup(); await writeJpegAuditArtifacts(f.out, { manifest: report.manifest, receipt: worst }, async () => {});
    expect(JSON.parse(await readFile(path.join(f.out, "receipt.json"), "utf8"))).toEqual(worst);
  });
  it("runs actual CLI with private artifacts, fixed redaction and exact original input bytes", async () => {
    const f = await setup(), original = await readFile(path.join(f.root, "private-source-canary.jpg")), list = await readFile(f.selection);
    const { stdout, stderr } = await exec(process.execPath, ["scripts/inventory-jpeg-metadata.mts", "--selection", f.selection, "--root", f.root, "--out", f.out, "--classification", "processed-jpeg-exports"]);
    expect(stderr).toBe(""); expect(stdout).not.toMatch(/private-|Artist|GPS/); const receipt = JSON.parse(stdout); expect(receipt.readyToUpload).toBe(false); expect(receipt.images[0].sha256).toBe(hash(original));
    expect(await readdir(f.out)).toEqual(["entries.tsv", "receipt.json"]); expect(JSON.parse(await readFile(path.join(f.out, "receipt.json"), "utf8"))).toEqual(receipt);
    expect((await lstat(f.out)).mode & 0o777).toBe(0o700); for (const file of await readdir(f.out)) expect((await lstat(path.join(f.out, file))).mode & 0o777).toBe(0o600);
    expect(await readFile(path.join(f.root, "private-source-canary.jpg"))).toEqual(original); expect(await readFile(f.selection)).toEqual(list);
  });
  it("refuses missing canary paths without Node filesystem details or a partial report", async () => {
    const f = await setup(); await writeFile(f.selection, selection("private-missing-canary.jpg"));
    try { await exec(process.execPath, ["scripts/inventory-jpeg-metadata.mts", "--selection", f.selection, "--root", f.root, "--out", f.out, "--classification", "processed-jpeg-exports"]); throw Error("expected refusal"); }
    catch (error) { const e = error as { stdout: string; stderr: string }; expect(e.stdout).toBe(""); expect(e.stderr).toBe("[jpeg-audit] LOCAL_INPUT_FAILED\n"); }
    await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("retains shared private guards and closes earlier descriptors after changed selection, symlink/hardlink or output collision", async () => {
    const f = await setup(), original = files.openZipBuildInput, held: Awaited<ReturnType<typeof original>>[] = [];
    vi.spyOn(files, "openZipBuildInput").mockImplementation(async (...args) => { const input = await original(...args); held.push(input); return input; });
    await chmod(path.join(f.root, "private-source-canary.jpg"), 0o644); await expect(runJpegMetadataInventory(f)).rejects.toThrow("LOCAL_INPUT_FAILED");
    for (const input of held) await expect(input.handle.stat()).rejects.toMatchObject({ code: "EBADF" });
    await chmod(path.join(f.root, "private-source-canary.jpg"), 0o600); await link(path.join(f.root, "private-source-canary.jpg"), path.join(f.root, "alias.jpg")); await expect(runJpegMetadataInventory(f)).rejects.toThrow("LOCAL_INPUT_FAILED");
    const g = await setup(); await symlink(path.join(g.root, "private-source-canary.jpg"), path.join(g.root, "alias.jpg")); await writeFile(g.selection, selection("alias.jpg")); await expect(runJpegMetadataInventory(g)).rejects.toThrow("LOCAL_INPUT_FAILED");
    const h = await setup(); await mkdir(h.out, { mode: 0o700 }); await writeFile(path.join(h.out, "foreign"), "preserve"); await expect(runJpegMetadataInventory(h)).rejects.toThrow("LOCAL_INPUT_FAILED"); expect(await readFile(path.join(h.out, "foreign"), "utf8")).toBe("preserve");
  });
  it("cancels through final artifact writes without preserving a partial success", async () => {
    const f = await setup(), controller = new AbortController(), original = files.openZipBuildInput;
    vi.spyOn(files, "openZipBuildInput").mockImplementation(async (...args) => {
      const input = await original(...args), unchanged = input.unchanged;
      input.unchanged = async () => { await unchanged(); if (await lstat(path.join(f.out, "entries.tsv")).catch(() => undefined)) controller.abort(); };
      return input;
    });
    await expect(runJpegMetadataInventory(f, controller.signal)).rejects.toThrow("INTERRUPTED"); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
});


describe("actual owner CLI interruption and changed inputs", () => {
  it("detects an on-disk selected manifest change through the shared input verifier", async () => {
    const f = await setup(), original = files.openZipBuildInput; let changed = false;
    vi.spyOn(files, "openZipBuildInput").mockImplementation(async (...args) => {
      const input = await original(...args);
      if (args[0] !== f.selection) { const read = input.read; input.read = async (...where) => { const bytes = await read(...where); if (!changed) { changed = true; await writeFile(f.selection, selection("another-private-canary.jpg")); } return bytes; }; }
      return input;
    });
    await expect(runJpegMetadataInventory(f)).rejects.toThrow("LOCAL_INPUT_FAILED"); await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it.skipIf(process.platform !== "linux")("handles real SIGTERM after the actual CLI opens its selected input, without path leakage or partial success", async () => {
    const f = await setup(), bytes = await jpeg(), names = Array.from({ length: 32 }, (_, i) => `synthetic-${i}.jpg`);
    for (const name of names) await writeFile(path.join(f.root, name), bytes, { mode: 0o600 }); await writeFile(f.selection, selection(...names));
    const child = spawn(process.execPath, ["scripts/inventory-jpeg-metadata.mts", "--selection", f.selection, "--root", f.root, "--out", f.out, "--classification", "processed-jpeg-exports"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = ""; child.stdout.on("data", part => { stdout += part; }); child.stderr.on("data", part => { stderr += part; });
    const exited = new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => { child.on("error", reject); child.on("exit", (code, signal) => resolve({ code, signal })); });
    let opened = false;
    try {
      const until = Date.now() + 3000;
      while (Date.now() < until && child.exitCode === null && child.signalCode === null) {
        const directory = `/proc/${child.pid}/fd`, descriptors = await readdir(directory).catch(() => []);
        const targets = await Promise.all(descriptors.map(fd => readlink(path.join(directory, fd)).catch(() => "")));
        if (targets.includes(f.selection)) { opened = true; break; }
        await new Promise(resolve => setTimeout(resolve, 5));
      }
      expect(opened).toBe(true); child.kill("SIGTERM");
      expect(await exited).toEqual({ code: 130, signal: null }); expect(stdout).toBe(""); expect(stderr).toBe("[jpeg-audit] INTERRUPTED\n");
      await expect(lstat(f.out)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await exited; } }
  });
});
