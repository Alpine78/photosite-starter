import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { crc32, deflateRawSync } from "node:zlib";
import { chmod, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { DELIVERY_ZIP_LIMITS, inspectDeliveryZip, parseDeliveryZipManifest } from "./delivery-zip-integrity.mts";
import { parseDeliveryZipArguments, runDeliveryZipAudit } from "./verify-delivery-zip.mts";

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
let jpeg: Buffer;
beforeAll(async () => { jpeg = await sharp({ create: { width: 3, height: 2, channels: 3, background: "#aabbcc" } }).jpeg().toBuffer(); });
const network = vi.fn(() => { throw new Error("Offline only"); });
beforeEach(() => { network.mockClear(); vi.stubGlobal("fetch", network); });
afterEach(() => { vi.unstubAllGlobals(); expect(network).not.toHaveBeenCalled(); });

// Synthetic ZIP32 writer only for these corruption tests. Golden interoperability is checked separately.
function fixture(options: { method?: number; descriptor?: "signed" | "unsigned"; count?: number; data?: Buffer; garbage?: boolean } = {}) {
  const rows: Buffer[] = [], directory: Buffer[] = [], lines = ["delivery-zip-v1"], locals: number[] = [], centrals: number[] = [];
  const data = options.data ?? jpeg, method = options.method ?? 0;
  let offset = 0;
  for (let index = 0; index < (options.count ?? 1); index++) {
    const name = Buffer.from(`image-${String(index + 1).padStart(4, "0")}.jpg`), compressed = method === 0 ? data : deflateRawSync(data);
    const payload = options.garbage ? Buffer.concat([compressed, Buffer.from([0])]) : compressed;
    const crc = crc32(data), flags = 0x800 | (options.descriptor ? 8 : 0), header = Buffer.alloc(30), central = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(flags, 6); header.writeUInt16LE(method, 8);
    if (!options.descriptor) { header.writeUInt32LE(crc, 14); header.writeUInt32LE(payload.length, 18); header.writeUInt32LE(data.length, 22); }
    header.writeUInt16LE(name.length, 26);
    central.writeUInt32LE(0x02014b50); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(flags, 8); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(payload.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(0x81a40000, 38); central.writeUInt32LE(offset, 42);
    const tail = Buffer.alloc(options.descriptor === "signed" ? 16 : options.descriptor ? 12 : 0);
    if (tail.length) { const shift = tail.length === 16 ? 4 : 0; if (shift) tail.writeUInt32LE(0x08074b50); tail.writeUInt32LE(crc, shift); tail.writeUInt32LE(payload.length, shift + 4); tail.writeUInt32LE(data.length, shift + 8); }
    locals.push(offset); rows.push(header, name, payload, tail); directory.push(central, name); offset += header.length + name.length + payload.length + tail.length;
    lines.push(`${name.toString()}\t${data.length}\t${sha256(data)}`);
  }
  const centralStart = offset;
  for (let i = 0; i < directory.length; i += 2) { centrals.push(offset); offset += directory[i].length + directory[i + 1].length; }
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(locals.length, 8); end.writeUInt16LE(locals.length, 10);
  end.writeUInt32LE(offset - centralStart, 12); end.writeUInt32LE(centralStart, 16);
  return { archive: Buffer.concat([...rows, ...directory, end]), manifest: Buffer.from(`${lines.join("\n")}\n`), locals, centrals, end: offset, centralStart };
}

describe("bounded whole-package integrity", () => {
  // Produced independently with Python3 stdlib zipfile, fixed timestamp, no CI Python dependency.
  it.each([
    "UEsDBBQAAAAAAAAAUV1qzr4MJwAAACcAAAAOAAAAaW1hZ2UtMDAwMS5qcGdpbmRlcGVuZGVudCBaSVAgaW50ZXJvcGVyYWJpbGl0eSBzYW1wbGVQSwECFAMUAAAAAAAAAFFdas6+DCcAAAAnAAAADgAAAAAAAAAAAAAAgAEAAAAAaW1hZ2UtMDAwMS5qcGdQSwUGAAAAAAEAAQA8AAAAUwAAAAAA",
    "UEsDBBQAAAAIAAAAUV1qzr4MJwAAACcAAAAOAAAAaW1hZ2UtMDAwMS5qcGfLzEtJLUgFEnklClGeAQqZeSWpRfkFqUWJSZk5mSWVCsWJuQU5qQBQSwECFAMUAAAACAAAAFFdas6+DCcAAAAnAAAADgAAAAAAAAAAAAAAgAEAAAAAaW1hZ2UtMDAwMS5qcGdQSwUGAAAAAAEAAQA8AAAAUwAAAAAA",
    "UEsDBBQACAAIAAAAUV0AAAAAAAAAAAAAAAAOAAAAaW1hZ2UtMDAwMS5qcGfLzEtJLUgFEnklClGeAQqZeSWpRfkFqUWJSZk5mSWVCsWJuQU5qQBQSwcIas6+DCcAAAAnAAAAUEsBAhQDFAAIAAgAAABRXWrOvgwnAAAAJwAAAA4AAAAAAAAAAAAAAIABAAAAAGltYWdlLTAwMDEuanBnUEsFBgAAAAABAAEAPAAAAGMAAAAAAA==",
  ])("accepts independently constructed STORE/DEFLATE/descriptor golden archives %#", (base64) => {
    const manifest = Buffer.from("delivery-zip-v1\nimage-0001.jpg\t39\t7d3e33eae6d1b6d568666e1ef1b2ce27a6543f571369d31cfc7fc5f2341cb768\n");
    expect(inspectDeliveryZip(Buffer.from(base64, "base64"), manifest).entries).toBe(1);
  });
  it.each([0, 8])("verifies real JPEG bytes in STORE/DEFLATE method %s without changing them", (method) => {
    const f = fixture({ method, count: 2 }), before = Buffer.from(f.archive), result = inspectDeliveryZip(f.archive, f.manifest);
    expect(result).toMatchObject({ entries: 2, expandedBytes: jpeg.length * 2, archiveSha256: sha256(before), readyToUpload: false,
      checks: { jpegEligibility: "not-checked", metadataSuitability: "not-checked", manifestAuthority: "not-established", provider: "not-contacted" } });
    expect(f.archive).toEqual(before); expect(JSON.stringify(result)).not.toContain("image-0001");
  });
  it.each(["signed", "unsigned"] as const)("supports %s descriptors with more than one entry", (descriptor) => {
    const f = fixture({ descriptor, method: 8, count: 2 }); expect(inspectDeliveryZip(f.archive, f.manifest).entries).toBe(2);
  });
  it("disambiguates an unsigned CRC equal to the optional descriptor signature", () => {
    const bytes = Buffer.from("ac0a7ad5", "hex"); expect(crc32(bytes)).toBe(0x08074b50);
    const f = fixture({ data: bytes, descriptor: "unsigned" }); expect(inspectDeliveryZip(f.archive, f.manifest).entries).toBe(1);
  });
  it("checks the 256-entry bound without enlarging the authoring limit", () => {
    const f = fixture({ method: 8, count: 256 }); expect(inspectDeliveryZip(f.archive, f.manifest).entries).toBe(256);
    expect(() => parseDeliveryZipManifest(fixture({ count: 257 }).manifest)).toThrow("INVALID_MANIFEST");
  });
  it("does not treat container integrity as JPEG eligibility", () => {
    const f = fixture({ data: Buffer.from("intentionally not JPEG") }); expect(inspectDeliveryZip(f.archive, f.manifest).checks.jpegEligibility).toBe("not-checked");
  });
  it("rejects trailing bytes inside an otherwise valid DEFLATE stream", () => {
    const f = fixture({ method: 8, garbage: true }); expect(() => inspectDeliveryZip(f.archive, f.manifest)).toThrow("DEFLATE_TRAILING_BYTES");
  });
  it("refuses expansion above the declared bound before a successful decode", () => {
    const f = fixture({ method: 8, data: Buffer.alloc(100_000, 0) });
    f.archive.writeUInt32LE(1, 22); f.archive.writeUInt32LE(1, f.centrals[0] + 24);
    const manifest = Buffer.from(`delivery-zip-v1\nimage-0001.jpg\t1\t${sha256(Buffer.alloc(1))}\n`);
    expect(() => inspectDeliveryZip(f.archive, manifest)).toThrow("INVALID_DEFLATE");
  });
  it("checks the complete ordered intended byte set, not just a valid container", () => {
    const f = fixture({ count: 2 });
    expect(() => inspectDeliveryZip(f.archive, Buffer.from(f.manifest.toString().replace(sha256(jpeg), "a".repeat(64))))).toThrow("ENTRY_HASH");
    expect(() => inspectDeliveryZip(f.archive, fixture().manifest)).toThrow("ENTRY_SET_MISMATCH");
  });
  it.each([
    ["encryption", (f: ReturnType<typeof fixture>) => f.archive.writeUInt16LE(0x801, f.centrals[0] + 8)],
    ["method", (f: ReturnType<typeof fixture>) => f.archive.writeUInt16LE(99, f.centrals[0] + 10)],
    ["ZIP64", (f: ReturnType<typeof fixture>) => f.archive.writeUInt16LE(45, f.centrals[0] + 6)],
    ["extra", (f: ReturnType<typeof fixture>) => f.archive.writeUInt16LE(1, f.centrals[0] + 30)],
    ["comment", (f: ReturnType<typeof fixture>) => f.archive.writeUInt16LE(1, f.centrals[0] + 32)],
    ["split", (f: ReturnType<typeof fixture>) => f.archive.writeUInt16LE(1, f.end + 4)],
    ["symlink", (f: ReturnType<typeof fixture>) => f.archive.writeUInt32LE(0xa1ff0000, f.centrals[0] + 38)],
    ["symlink with DOS host", (f: ReturnType<typeof fixture>) => { f.archive.writeUInt16LE(20, f.centrals[0] + 4); f.archive.writeUInt32LE(0xa1ff0000, f.centrals[0] + 38); }],
    ["volume label", (f: ReturnType<typeof fixture>) => f.archive.writeUInt32LE(8, f.centrals[0] + 38)],
    ["directory", (f: ReturnType<typeof fixture>) => f.archive.writeUInt32LE(0x10, f.centrals[0] + 38)],
    ["path", (f: ReturnType<typeof fixture>) => f.archive.write("../x", f.centrals[0] + 46)],
    ["local name", (f: ReturnType<typeof fixture>) => f.archive.write("../x", 30)],
    ["local CRC", (f: ReturnType<typeof fixture>) => f.archive.writeUInt32LE(0, 14)],
    ["CRC", (f: ReturnType<typeof fixture>) => { f.archive.writeUInt32LE(0, 14); f.archive.writeUInt32LE(0, f.centrals[0] + 16); }],
    ["overlap", (f: ReturnType<typeof fixture>) => f.archive.writeUInt32LE(1, f.centrals[0] + 42)],
    ["timestamp mismatch", (f: ReturnType<typeof fixture>) => f.archive.writeUInt16LE(1, 10)],
    ["central length", (f: ReturnType<typeof fixture>) => f.archive.writeUInt32LE(1, f.end + 12)],
    ["count", (f: ReturnType<typeof fixture>) => f.archive.writeUInt16LE(2, f.end + 8)],
  ] as const)("refuses %s without disclosing input", (_name, change) => {
    const f = fixture(); change(f); expect(() => inspectDeliveryZip(f.archive, f.manifest)).toThrow(/^\[delivery-zip\] [A-Z_]+$/);
  });
  it("refuses missing/trailing/hidden bytes and corrupted descriptors", () => {
    const f = fixture(); for (const b of [f.archive.subarray(1), f.archive.subarray(0, -1), Buffer.concat([f.archive, Buffer.from([0])])]) expect(() => inspectDeliveryZip(b, f.manifest)).toThrow();
    const d = fixture({ descriptor: "signed" }); d.archive.writeUInt32LE(0, d.centralStart - 12); expect(() => inspectDeliveryZip(d.archive, d.manifest)).toThrow("DATA_DESCRIPTOR");
  });
  it.each(["", "delivery-zip-v1\n", "delivery-zip-v1\r\n", "delivery-zip-v1\n../secret.jpg\t1\tHASH\n", "delivery-zip-v1\nimage-0002.jpg\t1\tHASH\n"])("refuses a malformed manifest %j", (text) => {
    expect(() => parseDeliveryZipManifest(Buffer.from(text))).toThrow();
  });
  it("refuses noncanonical text, duplicate names, oversized manifests/entries/total", () => {
    const f = fixture(), text = f.manifest.toString();
    for (const m of [Buffer.from(text.slice(0, -1)), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), f.manifest]), Buffer.from(text.replace("\t" + jpeg.length, "\t0" + jpeg.length)), Buffer.from(text.replace("\t" + jpeg.length, "\t25000001")), Buffer.alloc(DELIVERY_ZIP_LIMITS.manifest + 1)]) expect(() => parseDeliveryZipManifest(m)).toThrow();
    const line = (n: number) => `image-${String(n).padStart(4, "0")}.jpg\t25000000\t${"a".repeat(64)}\n`;
    expect(() => parseDeliveryZipManifest(Buffer.from("delivery-zip-v1\n" + Array.from({ length: 5 }, (_, i) => line(i + 1)).join("")))).toThrow("EXPANSION_LIMIT");
    expect(() => parseDeliveryZipManifest(Buffer.from("delivery-zip-v1\n" + line(1) + line(1)))).toThrow("INVALID_MANIFEST");
  });
});

describe("real owner-only CLI", () => {
  let root: string;
  beforeEach(async () => { root = await mkdtemp(path.join(tmpdir(), "delivery-zip-test-")); await chmod(root, 0o700); });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const cli = path.resolve("scripts/verify-delivery-zip.mts");
  async function files() {
    const f = fixture({ method: 8 }), zip = path.join(root, "private-package.zip"), manifest = path.join(root, "private-manifest.tsv");
    await writeFile(zip, f.archive, { mode: 0o600 }); await writeFile(manifest, f.manifest, { mode: 0o600 });
    return { f, zip, manifest };
  }
  it("prints only the fixed redacted report and never creates/extracts a file", async () => {
    const { f, zip, manifest } = await files();
    const r = spawnSync(process.execPath, [cli, "--zip", zip, "--manifest", manifest], { encoding: "utf8" });
    expect(r.status).toBe(0); expect(r.stderr).toBe("");
    expect(JSON.parse(r.stdout)).toMatchObject({ entries: 1, archiveSha256: sha256(f.archive), readyToUpload: false });
    expect(r.stdout).not.toContain(root); expect(r.stdout).not.toContain("image-0001");
    expect(await readdir(root)).toEqual(["private-manifest.tsv", "private-package.zip"]); expect(await readFile(zip)).toEqual(f.archive); expect(await readFile(manifest)).toEqual(f.manifest);
  });
  it("rejects public modes, symlinks and malformed input with constant diagnostics", async () => {
    const { zip, manifest } = await files(); await chmod(manifest, 0o644);
    await expect(runDeliveryZipAudit({ zip, manifest })).rejects.toThrow("PRIVATE_INPUT_REQUIRED");
    await chmod(manifest, 0o600); const alias = path.join(root, "alias"); await symlink(manifest, alias);
    await expect(runDeliveryZipAudit({ zip, manifest: alias })).rejects.toThrow("PRIVATE_INPUT_REQUIRED");
    const r = spawnSync(process.execPath, [cli, "--zip", zip, "--manifest", path.join(root, "customer-secret-missing")], { encoding: "utf8" });
    expect(r.status).toBe(1); expect(r.stdout).toBe(""); expect(r.stderr).toBe("[delivery-zip] LOCAL_INPUT_FAILED\n");
  });
  it("refuses tracked or unignored Git inputs but accepts ignored private artifacts", async () => {
    const { zip, manifest } = await files(); execFileSync("git", ["init", "--quiet", root]);
    await expect(runDeliveryZipAudit({ zip, manifest })).rejects.toThrow("LOCAL_INPUT_FAILED");
    await writeFile(path.join(root, ".gitignore"), "private-*\n"); expect((await runDeliveryZipAudit({ zip, manifest })).entries).toBe(1);
    execFileSync("git", ["-C", root, "add", "--force", "private-manifest.tsv"]);
    await expect(runDeliveryZipAudit({ zip, manifest })).rejects.toThrow("LOCAL_INPUT_FAILED");
  });
  it.each([[], ["--zip", "x"], ["--apply", "yes"], ["--zip", "x", "--zip", "y"], ["--zip", "x", "--manifest", "x"], ["--zip", "x", "--manifest", "y", "--token", "secret"]].map(args => ({ args })))("closes the argument boundary $args", ({ args }) => {
    expect(() => parseDeliveryZipArguments(args)).toThrow("INVALID_ARGUMENTS");
  });
});
