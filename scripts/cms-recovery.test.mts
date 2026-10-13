import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdtemp, writeFile, readFile, rm, stat, symlink, appendFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Header } from "tar";
import { recoveryAsset, recoveryPlan, safeArchiveEntry, RECOVERY_LIMITS } from "./cms-recovery-plan.mts";
import { boundedRecoverySource, rehearseRecovery } from "./cms-recovery-files.mts";
import { privateInput } from "./private-operation-files.mts";
const hash = (bytes: Buffer, algorithm = "sha256") => createHash(algorithm).update(bytes).digest("hex");
const bytes = Buffer.from("synthetic original asset bytes"), sha1 = hash(bytes, "sha1");
const asset = { _id: `image-${sha1}-32x24-jpg`, _rev: "rev", _type: "sanity.imageAsset", size: bytes.length, sha1hash: sha1, extension: "jpg" };
const snapshot = Buffer.from(JSON.stringify(asset) + "\n");
type Member = { name: string; bytes?: Buffer; type?: "File" | "SymbolicLink" | "Link" | "Directory"; linkpath?: string };
function tar(members: Member[]): Buffer {
  return Buffer.concat([...members.flatMap(m => {
    const payload = m.bytes ?? Buffer.alloc(0), header = new Header({ path: m.name, size: payload.length, type: m.type ?? "File", linkpath: m.linkpath, mode: 0o600 });
    header.encode(); return [header.block!, payload, Buffer.alloc((512 - payload.length % 512) % 512)];
  }), Buffer.alloc(1024)]);
}
const assetMember = { name: `export/images/${sha1}-32x24.jpg`, bytes };
const normal = () => [{ name: "export/data.ndjson", bytes: snapshot }, { name: "export/assets.json", bytes: Buffer.from("[]") }, assetMember];
async function exercise(run: (folder: string, manifest: Record<string, unknown>, save: (name: string, data: Buffer | string) => Promise<string>) => Promise<void>, archive = gzipSync(tar(normal()))) {
  const folder = await mkdtemp(path.join(tmpdir(), "recovery-fixture-"));
  const save = async (name: string, data: Buffer | string) => { const target = path.join(folder, name); await writeFile(target, data, { mode: 0o600 }); return target; };
  try {
    const manifest = { archivePath: await save("archive.tar.gz", archive), archiveSha256: hash(archive), assetDocuments: [asset], originalAdditions: [] };
    await save("snapshot.ndjson", snapshot); await run(folder, manifest, save);
  } finally { await rm(folder, { recursive: true }); }
}
const options = (folder: string) => ({ manifest: path.join(folder, "manifest.json"), snapshot: path.join(folder, "snapshot.ndjson"), snapshotSha256: hash(snapshot), out: path.join(folder, "out") });
describe("offline CMS recovery", () => {
  it.each([false, true])("recovers exact disk bytes from plain/wrapped gzip export (wrapped=%s)", wrapped => exercise(async (folder, manifest, save) => {
    await save("manifest.json", JSON.stringify(manifest));
    const receipt = await rehearseRecovery(options(folder));
    expect(receipt).toMatchObject({ assetCount: 1, documentCount: 1, localBytesRecoveredAndReadBack: true, providerRestorePerformed: false, cmsMutated: false });
    expect(await readFile(path.join(folder, "out", "objects", asset._id))).toEqual(bytes);
    expect(await readFile(path.join(folder, "out", "raw-documents.ndjson"))).toEqual(snapshot);
    expect((await stat(path.join(folder, "out", "objects", asset._id))).mode & 0o777).toBe(0o600);
    await expect(rehearseRecovery(options(folder))).rejects.toThrow();
  }, wrapped ? gzipSync(tar([{ name: "sanity-export.tar.gz", bytes: gzipSync(tar(normal())) }, { name: "raw-documents.ndjson", bytes: snapshot }])) : gzipSync(tar(normal()))));
  it("restores and hashes additions while preserving their source", () => exercise(async (folder, manifest, save) => {
    manifest.originalAdditions = [{ assetId: asset._id, bytes: bytes.length, path: await save("original.jpg", bytes), sha256: hash(bytes) }];
    await save("manifest.json", JSON.stringify(manifest)); expect((await rehearseRecovery(options(folder))).additions).toBe(1);
    expect(await readFile(path.join(folder, "original.jpg"))).toEqual(bytes);
  }, gzipSync(tar(normal().slice(0, 2)))));
  it.each([
    { name: "../escape", bytes }, { name: "/absolute", bytes }, { name: "export/../escape", bytes },
    { name: "export/link", type: "SymbolicLink" as const, linkpath: "/tmp/escape" },
    { name: "export/link", type: "Link" as const, linkpath: "export/images/fixture" },
    assetMember, { name: "export/images/unexpected.jpg", bytes },
  ])("rejects unsafe, duplicate or unexpected entry $name", member => exercise(async (folder, manifest, save) => {
    await save("manifest.json", JSON.stringify(manifest));
    await expect(rehearseRecovery(options(folder))).rejects.toThrow();
    await expect(readFile(path.join(folder, "out", "receipt.json"))).rejects.toThrow();
  }, gzipSync(tar([...normal(), member]))));
  it("refuses missing or corrupt asset bytes", async () => {
    for (const members of [normal().slice(0, 2), [...normal().slice(0, 2), { ...assetMember, bytes: Buffer.alloc(bytes.length) }]]) await exercise(async (folder, manifest, save) => {
      await save("manifest.json", JSON.stringify(manifest)); await expect(rehearseRecovery(options(folder))).rejects.toThrow();
    }, gzipSync(tar(members)));
  });
  it("refuses an incorrect snapshot/archive/addition digest", async () => {
    for (const kind of ["snapshot", "archive", "addition"]) await exercise(async (folder, manifest, save) => {
      if (kind === "archive") manifest.archiveSha256 = "0".repeat(64);
      if (kind === "addition") manifest.originalAdditions = [{ assetId: asset._id, bytes: bytes.length, path: await save("original.jpg", bytes), sha256: "0".repeat(64) }];
      await save("manifest.json", JSON.stringify(manifest));
      await expect(rehearseRecovery({ ...options(folder), ...(kind === "snapshot" ? { snapshotSha256: "0".repeat(64) } : {}) })).rejects.toThrow();
    });
  });
  it("rejects truncated archive input", () => exercise(async (folder, manifest, save) => {
    await save("manifest.json", JSON.stringify(manifest)); await expect(rehearseRecovery(options(folder))).rejects.toThrow();
  }, Buffer.from("invalid archive")));
  it("terminates a parser refusal during an active incomplete asset", () => exercise(async (folder, manifest, save) => {
    await save("manifest.json", JSON.stringify(manifest));
    await expect(rehearseRecovery(options(folder))).rejects.toThrow();
    await expect(readFile(path.join(folder, "out", "receipt.json"))).rejects.toThrow();
  }, gzipSync(tar(normal()).subarray(0, 2560 + 5))));
  it("terminates a synchronous gzip expansion refusal without waiting for drain", () => exercise(async (folder, manifest, save) => {
    await save("manifest.json", JSON.stringify(manifest));
    await expect(rehearseRecovery(options(folder))).rejects.toThrow();
  }, gzipSync(tar([{ name: "export/data.ndjson", bytes: Buffer.alloc(4 * 1024 * 1024) }]))));
  it("refuses symlink original sources", () => exercise(async (folder, manifest, save) => {
    const original = await save("original.jpg", bytes); await symlink(original, path.join(folder, "linked.jpg"));
    manifest.originalAdditions = [{ assetId: asset._id, bytes: bytes.length, path: path.join(folder, "linked.jpg"), sha256: hash(bytes) }];
    await save("manifest.json", JSON.stringify(manifest)); await expect(rehearseRecovery(options(folder))).rejects.toThrow();
  }, gzipSync(tar(normal().slice(0, 2)))));
  it("bounds archive entries and rejects traversal, links and repeated names", () => {
    for (const [name, type, size] of [["safe", "File", RECOVERY_LIMITS.totalBytes + 1], ["safe", "Directory", 1], ["bad\\path", "File", 0], ["../bad", "File", 0]] as const) expect(() => safeArchiveEntry(name, type, size, new Set())).toThrow();
    const seen = new Set<string>(); safeArchiveEntry("images/", "Directory", 0, seen); expect(() => safeArchiveEntry("images", "Directory", 0, seen)).toThrow();
  });
  it("binds complete asset identities to the supplied raw snapshot", () => {
    const manifest = { archivePath: "private/archive", archiveSha256: "a".repeat(64), assetDocuments: [asset], originalAdditions: [] };
    for (const invalid of [{ ...manifest, assetDocuments: [asset, asset] }, { ...manifest, assetDocuments: [{ ...asset, size: bytes.length + 1 }] }, { ...manifest, assetDocuments: [{ ...asset, sha1hash: "wrong" }] }, { ...manifest, originalAdditions: [{ assetId: "unknown", bytes: 1, path: "file", sha256: "a".repeat(64) }] }]) expect(() => recoveryPlan(invalid, snapshot)).toThrow();
  });
  it("matches the pinned official export fallback for numeric file extensions", () => {
    expect(recoveryAsset({ ...asset, _id: `file-${sha1}-mp3`, _type: "sanity.fileAsset", extension: "mp3" }).member).toBe(`files/${sha1}-mp3.bin`);
  });
  it("never extends an admitted stream bound when its opened source grows", () => exercise(async (_folder, _manifest, save) => {
    const filename = await save("growing-original", bytes), input = await privateInput(filename, 100);
    try {
      await appendFile(filename, Buffer.alloc(1000));
      const chunks: Buffer[] = []; for await (const chunk of boundedRecoverySource(input)) chunks.push(chunk);
      expect(Buffer.concat(chunks)).toEqual(bytes);
      await expect(input.unchanged()).rejects.toThrow("INPUT_CHANGED");
    } finally { await input.handle.close(); }
  }));
});
