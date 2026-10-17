import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { crc32, createDeflateRaw, deflateRawSync } from "node:zlib";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { chmod, link, lstat, mkdtemp, open, readFile, readdir, rename, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { inspectDeliveryZip, parseDeliveryZipManifest, parseLargeDeliveryZipManifest } from "./delivery-zip-integrity.mts";
import { inspectLargeDeliveryZip, LARGE_DELIVERY_ZIP_LIMITS, type ZipReadPort } from "./delivery-zip-streaming.mts";
import { openPrivateZipInput, runLargeDeliveryZipAudit } from "./verify-delivery-zip-large.mts";

const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const network = vi.fn(() => { throw new Error("Offline only"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(() => { vi.unstubAllGlobals(); expect(network).not.toHaveBeenCalled(); });
function headers(index: number, size: number, compressed: number, crc: number, offset: number, method = 0, descriptor?: "signed" | "unsigned", jpeg = false) {
  const name = Buffer.from(`image-${String(index + 1).padStart(4, "0")}.${jpeg ? "jpeg" : "jpg"}`), header = Buffer.alloc(30), central = Buffer.alloc(46);
  const flags = 0x800 | (descriptor ? 8 : 0);
  header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8); header.writeUInt16LE(name.length, 26);
  if (!descriptor) { header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed, 18); header.writeUInt32LE(size, 22); }
  central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
  central.writeUInt32LE(crc, 16); central.writeUInt32LE(compressed, 20); central.writeUInt32LE(size, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0x81a40000, 38); central.writeUInt32LE(offset, 42);
  const tail = Buffer.alloc(descriptor === "signed" ? 16 : descriptor ? 12 : 0);
  if (tail.length) { const shift = tail.length === 16 ? 4 : 0; if (shift) tail.writeUInt32LE(0x08074b50); tail.writeUInt32LE(crc, shift); tail.writeUInt32LE(compressed, shift + 4); tail.writeUInt32LE(size, shift + 8); }
  return { header, name, central, tail };
}
function eocd(count: number, centralSize: number, centralStart: number) {
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10); end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(centralStart, 16); return end;
}
function fixture(options: { data?: Buffer; method?: number; descriptor?: "signed" | "unsigned"; count?: number; garbage?: boolean; jpeg?: boolean } = {}) {
  const data = options.data ?? Buffer.from("synthetic byte set, eligibility deliberately unproven"), method = options.method ?? 0;
  const payload = method === 8 ? deflateRawSync(data) : data;
  const compressed = options.garbage ? Buffer.concat([payload, Buffer.from([0])]) : payload;
  const rows: Buffer[] = [], directory: Buffer[] = [], locals: number[] = [], centrals: number[] = [], lines = ["delivery-zip-v1"];
  let offset = 0;
  for (let index = 0; index < (options.count ?? 1); index++) {
    const h = headers(index, data.length, compressed.length, crc32(data), offset, method, options.descriptor, options.jpeg);
    locals.push(offset); rows.push(h.header, h.name, compressed, h.tail); directory.push(h.central, h.name); offset += 30 + h.name.length + compressed.length + h.tail.length;
    lines.push(`${h.name.toString()}\t${data.length}\t${hash(data)}`);
  }
  const centralStart = offset;
  for (let i = 0; i < directory.length; i += 2) { centrals.push(offset); offset += directory[i].length + directory[i + 1].length; }
  return { archive: Buffer.concat([...rows, ...directory, eocd(locals.length, offset - centralStart, centralStart)]), manifest: Buffer.from(lines.join("\n") + "\n"), locals, centrals, centralStart, end: offset };
}
function port(bytes: Buffer) {
  const requests: { at: number; length: number }[] = [];
  return { size: bytes.length, requests, async read(at: number, length: number) { requests.push({ at, length }); return bytes.subarray(at, at + length); } };
}

// This builder writes real >100MB STORE payloads with 64KiB buffers, never a whole-large buffer.
async function largeFixture(file: string) {
  const output = await open(file, "wx", 0o600), chunk = Buffer.alloc(65_536, 0x37), size = 21_000_000;
  const directory: Buffer[] = [], lines = ["delivery-zip-v1"], whole = createHash("sha256"); let position = 0;
  async function append(bytes: Buffer) { await output.writeFile(bytes); whole.update(bytes); position += bytes.length; }
  let crc = 0; const digest = createHash("sha256");
  for (let at = 0; at < size;) { const bytes = chunk.subarray(0, Math.min(chunk.length, size - at)); crc = crc32(bytes, crc); digest.update(bytes); at += bytes.length; }
  const entryHash = digest.digest("hex");
  try {
    for (let index = 0; index < 5; index++) {
      const h = headers(index, size, size, crc, position); await append(h.header); await append(h.name);
      for (let at = 0; at < size;) { const bytes = chunk.subarray(0, Math.min(chunk.length, size - at)); await append(bytes); at += bytes.length; }
      directory.push(h.central, h.name); lines.push(`${h.name.toString()}\t${size}\t${entryHash}`);
    }
    const centralStart = position;
    for (const bytes of directory) await append(bytes);
    await append(eocd(5, position - centralStart, centralStart));
    return { manifest: Buffer.from(lines.join("\n") + "\n"), archiveBytes: position, sha256: whole.digest("hex") };
  } finally { await output.close(); }
}

describe("streamed whole ZIP32 integrity", () => {
  it.each([0, 8])("agrees with the unchanged buffered inspector for method %s", async (method) => {
    const f = fixture({ method, count: 2 }), input = port(f.archive);
    expect(await inspectLargeDeliveryZip(input, f.manifest)).toEqual(inspectDeliveryZip(f.archive, f.manifest));
    expect(input.requests.reduce((sum, request) => sum + request.length, 0)).toBe(f.archive.length);
    expect(Math.max(...input.requests.map(request => request.length))).toBeLessThanOrEqual(65_536);
  });
  it.each(["signed", "unsigned"] as const)("verifies multi-entry DEFLATE %s descriptors", async (descriptor) => {
    const f = fixture({ method: 8, descriptor, count: 2 }); expect((await inspectLargeDeliveryZip(port(f.archive), f.manifest)).entries).toBe(2);
  });
  it("handles an unsigned CRC equal to the optional descriptor signature", async () => {
    const data = Buffer.from("ac0a7ad5", "hex"); expect(crc32(data)).toBe(0x08074b50);
    const f = fixture({ data, descriptor: "unsigned" }); expect((await inspectLargeDeliveryZip(port(f.archive), f.manifest)).entries).toBe(1);
  });
  it("accepts the complete256-entry .jpeg profile within the bounded central directory", async () => {
    const f = fixture({ count: 256, jpeg: true, method: 8 }); expect((await inspectLargeDeliveryZip(port(f.archive), f.manifest)).entries).toBe(256);
  });
  it.each([
    "UEsDBBQAAAAAAAAAUV1qzr4MJwAAACcAAAAOAAAAaW1hZ2UtMDAwMS5qcGdpbmRlcGVuZGVudCBaSVAgaW50ZXJvcGVyYWJpbGl0eSBzYW1wbGVQSwECFAMUAAAAAAAAAFFdas6+DCcAAAAnAAAADgAAAAAAAAAAAAAAgAEAAAAAaW1hZ2UtMDAwMS5qcGdQSwUGAAAAAAEAAQA8AAAAUwAAAAAA",
    "UEsDBBQAAAAIAAAAUV1qzr4MJwAAACcAAAAOAAAAaW1hZ2UtMDAwMS5qcGfLzEtJLUgFEnklClGeAQqZeSWpRfkFqUWJSZk5mSWVCsWJuQU5qQBQSwECFAMUAAAACAAAAFFdas6+DCcAAAAnAAAADgAAAAAAAAAAAAAAgAEAAAAAaW1hZ2UtMDAwMS5qcGdQSwUGAAAAAAEAAQA8AAAAUwAAAAAA",
  ])("accepts independent Python ZIP32 golden input %#", async (base64) => {
    const manifest = Buffer.from("delivery-zip-v1\nimage-0001.jpg\t39\t7d3e33eae6d1b6d568666e1ef1b2ce27a6543f571369d31cfc7fc5f2341cb768\n");
    expect((await inspectLargeDeliveryZip(port(Buffer.from(base64, "base64")), manifest)).entries).toBe(1);
  });
  it("keeps default manifest100MB and separate large-profile1GB bounds", () => {
    const manifest = (count: number) => Buffer.from("delivery-zip-v1\n" + Array.from({ length: count }, (_, i) => `image-${String(i + 1).padStart(4, "0")}.jpg\t25000000\t${"a".repeat(64)}\n`).join(""));
    expect(() => parseDeliveryZipManifest(manifest(5))).toThrow("EXPANSION_LIMIT");
    expect(parseLargeDeliveryZipManifest(manifest(40))).toHaveLength(40);
    expect(() => parseLargeDeliveryZipManifest(manifest(41))).toThrow("EXPANSION_LIMIT");
    expect(() => parseLargeDeliveryZipManifest(manifest(257))).toThrow("INVALID_MANIFEST");
  });
  it("refuses oversized archive and manifest-expanded limit before any archive read", async () => {
    const f = fixture(), read = vi.fn();
    await expect(inspectLargeDeliveryZip({ size: 1_000_000_001, read }, f.manifest)).rejects.toThrow("ARCHIVE_SIZE");
    await expect(inspectLargeDeliveryZip({ size: NaN, read }, f.manifest)).rejects.toThrow("ARCHIVE_SIZE");
    const line = (i: number) => `image-${String(i + 1).padStart(4, "0")}.jpg\t25000000\t${"a".repeat(64)}\n`;
    await expect(inspectLargeDeliveryZip({ size: 22, read }, Buffer.from("delivery-zip-v1\n" + Array.from({ length: 41 }, (_, i) => line(i)).join("")))).rejects.toThrow("EXPANSION_LIMIT");
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects short reads, stalled reads, pre-abort, and fixed diagnostics", async () => {
    const f = fixture();
    await expect(inspectLargeDeliveryZip({ size: f.archive.length, read: async () => new Uint8Array(0) }, f.manifest)).rejects.toThrow("TRUNCATED_ARCHIVE");
    await expect(inspectLargeDeliveryZip({ size: f.archive.length, read: () => new Promise(() => {}) }, f.manifest, { timeoutMs: 10 })).rejects.toThrow("AUDIT_CANCELLED");
    const read = vi.fn(), controller = new AbortController(); controller.abort();
    await expect(inspectLargeDeliveryZip({ size: f.archive.length, read }, f.manifest, { signal: controller.signal })).rejects.toThrow("AUDIT_CANCELLED"); expect(read).not.toHaveBeenCalled();
    await expect(inspectLargeDeliveryZip({ size: f.archive.length, read: async () => { throw new Error("secret-customer-path"); } }, f.manifest)).rejects.toThrow(/^\[delivery-zip\] LOCAL_READ_FAILED$/);
  });
  it("binds the report to the validated manifest snapshot and rejects invalid deadlines", async () => {
    const f = fixture(), expectedHash = hash(f.manifest), input = port(f.archive);
    const result = await inspectLargeDeliveryZip({ size: input.size, async read(at, length) {
      f.manifest.fill(0); return input.read(at, length);
    } }, f.manifest);
    expect(result.manifestSha256).toBe(expectedHash);
    const valid = fixture();
    for (const timeoutMs of [0, 330_001, NaN]) await expect(inspectLargeDeliveryZip(port(valid.archive), valid.manifest, { timeoutMs })).rejects.toThrow("INVALID_DEADLINE");
  });
  it.each([
    ["encryption", 8, 0x801, 2], ["ZIP64", 6, 45, 2], ["extra", 30, 1, 2], ["comment", 32, 1, 2], ["disk", 34, 1, 2],
    ["unknown flags", 8, 0x810, 2], ["STORE level bits", 8, 0x802, 2], ["unknown method", 10, 99, 2], ["version", 6, 21, 2],
    ["symlink", 38, 0xa1ff0000, 4], ["directory", 38, 0x10, 4], ["volume", 38, 8, 4], ["overlap", 42, 1, 4], ["size", 24, 25_000_001, 4],
  ] as const)("refuses central %s", async (_label, offset, value, width) => {
    const f = fixture(); if (width === 2) f.archive.writeUInt16LE(value, f.centrals[0] + offset); else f.archive.writeUInt32LE(value, f.centrals[0] + offset);
    await expect(inspectLargeDeliveryZip(port(f.archive), f.manifest)).rejects.toThrow(/^\[delivery-zip\] [A-Z_]+$/);
  });
  it.each([0, 4, 6, 8, 10, 14, 18, 22, 26, 28, 30])("refuses changed local-header byte %s", async (offset) => {
    const f = fixture(); f.archive[offset] ^= 1; await expect(inspectLargeDeliveryZip(port(f.archive), f.manifest)).rejects.toThrow("LOCAL_HEADER");
  });
  it("refuses malformed layout, count, path, descriptors, hash, CRC and compressed garbage", async () => {
    const mutations: ((f: ReturnType<typeof fixture>) => void)[] = [
      f => f.archive.writeUInt32LE(1, f.end + 12), f => f.archive.writeUInt16LE(2, f.end + 8), f => f.archive.writeUInt16LE(1, f.end + 4),
      f => f.archive.write("../x", f.centrals[0] + 46), f => f.archive.writeUInt32LE(0, 14),
      f => { f.archive.writeUInt32LE(0, 14); f.archive.writeUInt32LE(0, f.centrals[0] + 16); },
    ];
    for (const change of mutations) { const f = fixture(); change(f); await expect(inspectLargeDeliveryZip(port(f.archive), f.manifest)).rejects.toThrow(); }
    const f = fixture(), d = fixture({ descriptor: "signed" }), g = fixture({ method: 8, garbage: true });
    d.archive.writeUInt32LE(0, d.centralStart - 12); await expect(inspectLargeDeliveryZip(port(d.archive), d.manifest)).rejects.toThrow("DATA_DESCRIPTOR");
    await expect(inspectLargeDeliveryZip(port(f.archive), Buffer.from(f.manifest.toString().replace(hash(Buffer.from("synthetic byte set, eligibility deliberately unproven")), "a".repeat(64))))).rejects.toThrow("ENTRY_HASH");
    await expect(inspectLargeDeliveryZip(port(g.archive), g.manifest)).rejects.toThrow(/DEFLATE_TRAILING_BYTES|INVALID_DEFLATE/);
    for (const input of [f.archive.subarray(1), f.archive.subarray(0, -1), Buffer.concat([f.archive, Buffer.from([0])])]) await expect(inspectLargeDeliveryZip(port(input), f.manifest)).rejects.toThrow();
  });
  it("cancels during payload reads without continuing later reads", async () => {
    const f = fixture({ data: Buffer.alloc(200_000), method: 8 }), input = port(f.archive), controller = new AbortController();
    const read: ZipReadPort["read"] = async (at, length) => { const result = await input.read(at, length); if (at === 44) controller.abort(); return result; };
    await expect(inspectLargeDeliveryZip({ size: input.size, read }, f.manifest, { signal: controller.signal })).rejects.toThrow("AUDIT_CANCELLED");
  });
});

describe("real private streaming CLI and stable inputs", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "large-zip-")); await chmod(root, 0o700); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const cli = path.resolve("scripts/verify-delivery-zip-large.mts");
  async function files() {
    const f = fixture({ method: 8 }), zip = path.join(root, "source.zip"), manifest = path.join(root, "set.tsv");
    await writeFile(zip, f.archive, { mode: 0o600 }); await writeFile(manifest, f.manifest, { mode: 0o600 }); return { f, zip, manifest };
  }
  it("audits an actual whole105MB STORE file with bounded reads and matching one-pass hash", async () => {
    const zip = path.join(root, "whole.zip"), f = await largeFixture(zip), input = await openPrivateZipInput(zip, LARGE_DELIVERY_ZIP_LIMITS.archive);
    const requests: number[] = [];
    try {
      const result = await inspectLargeDeliveryZip({ size: input.size, read: async (at, length) => { requests.push(length); return input.read(at, length); } }, f.manifest);
      expect(result).toMatchObject({ archiveBytes: f.archiveBytes, expandedBytes: 105_000_000, archiveSha256: f.sha256, readyToUpload: false });
      expect(Math.max(...requests)).toBeLessThanOrEqual(65_536); expect(requests.reduce((a, b) => a + b, 0)).toBe(f.archiveBytes); await input.unchanged();
    } finally { await input.handle.close(); }
    const manifest = path.join(root, "set.tsv"); await writeFile(manifest, f.manifest, { mode: 0o600 });
    const before = await lstat(zip, { bigint: true }), command = spawnSync(process.execPath, [cli, "--zip", zip, "--manifest", manifest], { encoding: "utf8", timeout: 30_000 });
    expect(command.status).toBe(0); expect(command.stderr).toBe(""); expect(JSON.parse(command.stdout)).toMatchObject({ archiveBytes: f.archiveBytes, archiveSha256: f.sha256 });
    expect(command.stdout).not.toContain(root); expect(command.stdout).not.toContain("image-0001"); expect(await readdir(root)).toEqual(["set.tsv", "whole.zip"]);
    const after = await lstat(zip, { bigint: true }); expect([after.size, after.mtimeNs, after.ctimeNs]).toEqual([before.size, before.mtimeNs, before.ctimeNs]);
  }, 30_000);
  it("refuses a sparse over1GB file without scanning it", async () => {
    const { zip, manifest } = await files(); await truncate(zip, 1_000_000_001);
    const command = spawnSync(process.execPath, [cli, "--zip", zip, "--manifest", manifest], { encoding: "utf8", timeout: 5000 });
    expect(command.status).toBe(1); expect(command.stdout).toBe(""); expect(command.stderr).toBe("[delivery-zip] PRIVATE_INPUT_REQUIRED\n");
  });
  it("refuses a high-ratio64MiB DEFLATE bomb within bounded isolated-process memory", async () => {
    const pieces: Buffer[] = [], chunk = Buffer.alloc(65_536);
    async function* zeros() { for (let i = 0; i < 1024; i++) yield chunk; }
    await pipeline(Readable.from(zeros(), { objectMode: false }), createDeflateRaw(),
      new Writable({ write(bytes: Buffer, _encoding, done) { pieces.push(Buffer.from(bytes)); done(); } }));
    const compressed = Buffer.concat(pieces), expected = Buffer.from([0]);
    expect(67_108_864 / compressed.length).toBeGreaterThan(900);
    const h = headers(0, 1, compressed.length, crc32(expected), 0, 8), start = 30 + h.name.length + compressed.length;
    const zip = path.join(root, "bomb.zip"), manifest = path.join(root, "set.tsv");
    await writeFile(zip, Buffer.concat([h.header, h.name, compressed, h.central, h.name, eocd(1, 46 + h.name.length, start)]), { mode: 0o600 });
    await writeFile(manifest, `delivery-zip-v1\nimage-0001.jpg\t1\t${hash(expected)}\n`, { mode: 0o600 });
    const source = `import {runLargeDeliveryZipAudit} from ${JSON.stringify(pathToFileURL(path.resolve("scripts/verify-delivery-zip-large.mts")).href)};
      const before=process.resourceUsage().maxRSS;
      try { await runLargeDeliveryZipAudit({zip:process.argv[1],manifest:process.argv[2]});process.exitCode=2; }
      catch(error) { console.log(JSON.stringify({error:error.message,peakDeltaKiB:process.resourceUsage().maxRSS-before})); }`;
    const result = spawnSync(process.execPath, ["--input-type=module", "-e", source, zip, manifest], { encoding: "utf8", timeout: 10_000 });
    expect(result.status).toBe(0); expect(result.stderr).toBe("");
    const report = JSON.parse(result.stdout); expect(report.error).toBe("[delivery-zip] EXPANSION_LIMIT");
    // Fresh process, no test-runner/fixture allocation: no allocation of the 64MiB expanded member.
    expect(report.peakDeltaKiB).toBeLessThan(32 * 1024);
  }, 15_000);
  it("rejects changed source contents, modes and replacement paths on open descriptors", async () => {
    for (const mutation of ["bytes", "mode", "replacement"] as const) {
      const { zip, f } = await files(), input = await openPrivateZipInput(zip, LARGE_DELIVERY_ZIP_LIMITS.archive);
      try {
        if (mutation === "bytes") await writeFile(zip, f.archive);
        if (mutation === "mode") await chmod(zip, 0o644);
        if (mutation === "replacement") { await rename(zip, zip + ".old"); await writeFile(zip, f.archive, { mode: 0o600 }); }
        await expect(input.unchanged()).rejects.toThrow(/INPUT_CHANGED|PRIVATE_INPUT_REQUIRED/);
      } finally { await input.handle.close(); }
      await rm(zip); await rm(path.join(root, "set.tsv"));
    }
  });
  it("rejects world-readable parents/files, links, symlinked parent, tracked and unignored input", async () => {
    const { zip, manifest } = await files(); await chmod(manifest, 0o644); await expect(runLargeDeliveryZipAudit({ zip, manifest })).rejects.toThrow("PRIVATE_INPUT_REQUIRED"); await chmod(manifest, 0o600);
    const alias = path.join(root, "alias"); await symlink(zip, alias); await expect(runLargeDeliveryZipAudit({ zip: alias, manifest })).rejects.toThrow("PRIVATE_INPUT_REQUIRED");
    const hard = path.join(root, "hard"); await link(zip, hard); await expect(runLargeDeliveryZipAudit({ zip, manifest })).rejects.toThrow("PRIVATE_INPUT_REQUIRED"); await rm(hard);
    const outsideAlias = root + "-alias"; await symlink(root, outsideAlias);
    try { await expect(runLargeDeliveryZipAudit({ zip: path.join(outsideAlias, "source.zip"), manifest })).rejects.toThrow("PRIVATE_INPUT_REQUIRED"); } finally { await rm(outsideAlias); }
    await chmod(root, 0o755); await expect(runLargeDeliveryZipAudit({ zip, manifest })).rejects.toThrow("PRIVATE_INPUT_REQUIRED"); await chmod(root, 0o700);
    execFileSync("git", ["init", "--quiet", root]); await expect(runLargeDeliveryZipAudit({ zip, manifest })).rejects.toThrow("LOCAL_INPUT_FAILED");
    await writeFile(path.join(root, ".gitignore"), "source.zip\nset.tsv\n"); expect((await runLargeDeliveryZipAudit({ zip, manifest })).entries).toBe(1);
    execFileSync("git", ["-C", root, "add", "--force", "set.tsv"]); await expect(runLargeDeliveryZipAudit({ zip, manifest })).rejects.toThrow("LOCAL_INPUT_FAILED");
  });
  it("prints constant errors for invalid args and missing private source", async () => {
    for (const args of [["--token", "private-secret"], ["--zip", path.join(root, "customer-secret"), "--manifest", path.join(root, "missing")]]) {
      const command = spawnSync(process.execPath, [cli, ...args], { encoding: "utf8" });
      expect(command.status).toBe(1); expect(command.stdout).toBe(""); expect(command.stderr).toMatch(/^\[delivery-zip\] (INVALID_ARGUMENTS|LOCAL_INPUT_FAILED)\n$/); expect(command.stderr).not.toContain(root);
    }
    const { zip, manifest, f } = await files(); expect((await runLargeDeliveryZipAudit({ zip, manifest })).readyToUpload).toBe(false); expect(await readFile(zip)).toEqual(f.archive);
  });
});
