/** Streams to fixed private filenames. Never uses tar extraction or HTTP. */
import { createHash } from "node:crypto";
import { open, mkdir } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { Parser, type ReadEntry } from "tar";
import { privateInput, readPrivateBytes, newPrivateDirectory, writePrivateBytes } from "./private-operation-files.mts";
import { digest, recoveryPlan, RECOVERY_LIMITS, safeArchiveEntry, type RecoveryAsset } from "./cms-recovery-plan.mts";

type Source = AsyncIterable<Buffer>;
async function hashInput(filename: string, maximum: number): Promise<string> {
  const input = await privateInput(filename, maximum), hash = createHash("sha256");
  try {
    for await (const chunk of input.handle.createReadStream({ autoClose: false })) hash.update(chunk);
    await input.unchanged(); return hash.digest("hex");
  } finally { await input.handle.close(); }
}
async function parseArchive(source: Source, visit: (entry: ReadEntry) => Promise<void>): Promise<void> {
  const tasks: Promise<void>[] = [], seen = new Set<string>(), active = new Set<ReadEntry>(); let bytes = 0, metadataEntries = 0, failure: Error | undefined;
  const parser = new Parser({ strict: true, maxMetaEntrySize: 64 * 1024, maxDecompressionRatio: 200,
    onReadEntry(entry) {
      active.add(entry);
      entry.on("error", () => {}); // also handled by the consuming async iterator
      const task = (async () => {
        safeArchiveEntry(entry.path, entry.type, entry.size, seen);
        bytes += entry.size;
        if (bytes > RECOVERY_LIMITS.totalBytes) throw new Error("ARCHIVE_TOTAL_LIMIT");
        await visit(entry);
      })().catch(() => { failure ??= new Error("ARCHIVE_ENTRY_REJECTED"); parser.abort(failure); }).finally(() => { active.delete(entry); });
      tasks.push(task);
    },
  });
  parser.on("ignoredEntry", () => { failure ??= new Error("UNSUPPORTED_ARCHIVE_ENTRY"); parser.abort(failure); });
  parser.on("meta", (metadata: string) => {
    metadataEntries++; bytes += Buffer.byteLength(metadata);
    if (metadataEntries > RECOVERY_LIMITS.entries || bytes > RECOVERY_LIMITS.totalBytes) { failure ??= new Error("ARCHIVE_METADATA_LIMIT"); parser.abort(failure); }
  });
  parser.on("error", () => {
    failure ??= new Error("INVALID_ARCHIVE");
    for (const entry of active) entry.destroy(failure);
  });
  // Register completion before feeding bytes; strict parser errors never echo paths.
  const completed = once(parser, "end").catch(() => { failure ??= new Error("INVALID_ARCHIVE"); });
  try {
    for await (const chunk of source) {
      if (failure) throw failure;
      const writable = parser.write(chunk);
      // A synchronous parser error can occur inside write, before a future
      // drain listener exists. Do not wait for an event that will never arrive.
      if (failure) throw failure;
      if (!writable) await once(parser, "drain");
    }
    parser.end(); await completed; await Promise.all(tasks);
    if (failure) throw failure;
  } catch {
    parser.abort(new Error("ARCHIVE_REJECTED"));
    // A rejected entry can keep the parser from draining. Abort destroys its
    // active stream; task failures are handled before they enter this array.
    await Promise.all(tasks); throw new Error("ARCHIVE_REJECTED");
  }
}
async function consume(entry: ReadEntry, maximum: number): Promise<void> {
  if (entry.size > maximum) throw new Error("METADATA_LIMIT");
  let size = 0; for await (const chunk of entry) { size += chunk.length; if (size > maximum) throw new Error("METADATA_LIMIT"); }
  if (size !== entry.size) throw new Error("TRUNCATED_ENTRY");
}
async function restoreAsset(source: Source, asset: RecoveryAsset, folder: string, expectedSha256?: string) {
  const handle = await open(path.join(folder, asset.id), "wx", 0o600), sha1 = createHash("sha1"), sha256 = createHash("sha256"); let size = 0;
  try {
    for await (const chunk of source) {
      size += chunk.length; if (size > asset.bytes) throw new Error("ASSET_SIZE_MISMATCH");
      sha1.update(chunk); sha256.update(chunk);
      // FileHandle.write may write fewer bytes than requested.
      let offset = 0; while (offset < chunk.length) { const written = await handle.write(chunk, offset, chunk.length - offset); if (!written.bytesWritten) throw new Error("OUTPUT_WRITE_FAILED"); offset += written.bytesWritten; }
    }
    const actualSha256 = sha256.digest("hex");
    if (size !== asset.bytes || sha1.digest("hex") !== asset.sha1 || (expectedSha256 !== undefined && actualSha256 !== expectedSha256)) throw new Error("ASSET_BYTES_MISMATCH");
    await handle.sync();
    return { assetId: asset.id, bytes: size, sha256: actualSha256 };
  } finally { await handle.close(); }
}
export async function rehearseRecovery(options: { manifest: string; snapshot: string; snapshotSha256: string; out: string }) {
  if (!digest(options.snapshotSha256, 64)) throw new Error("INVALID_SNAPSHOT_DIGEST");
  const [manifestBytes, snapshot] = await Promise.all([readPrivateBytes(options.manifest, RECOVERY_LIMITS.metadataBytes), readPrivateBytes(options.snapshot, RECOVERY_LIMITS.metadataBytes)]);
  if (createHash("sha256").update(snapshot).digest("hex") !== options.snapshotSha256) throw new Error("SNAPSHOT_DIGEST_MISMATCH");
  const plan = recoveryPlan(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)), snapshot);
  if (await hashInput(plan.archivePath, RECOVERY_LIMITS.totalBytes) !== plan.archiveSha256) throw new Error("ARCHIVE_DIGEST_MISMATCH");
  const folder = await newPrivateDirectory(options.out), objects = path.join(folder, "objects"); await mkdir(objects, { mode: 0o700 });
  await writePrivateBytes(folder, "raw-documents.ndjson", snapshot);
  const byMember = new Map(plan.assets.map(a => [a.member, a])), restored = new Map<string, { assetId: string; bytes: number; sha256: string }>();
  const additionIds = new Set(plan.additions.map(a => a.assetId)); let root: string | undefined, nested = false, officialData = false, officialManifest = false;
  const official = async (entry: ReadEntry) => {
    const parts = entry.path.replace(/\/$/, "").split("/");
    root ??= parts[0]; if (parts[0] !== root) throw new Error("MULTIPLE_EXPORT_ROOTS");
    const member = parts.slice(1).join("/");
    if (entry.type === "Directory") { if (!["", "images", "files"].includes(member)) throw new Error("UNEXPECTED_DIRECTORY"); await consume(entry, 0); return; }
    if (member === "data.ndjson" || member === "assets.json") {
      if (member === "data.ndjson") officialData = true; else officialManifest = true;
      await consume(entry, RECOVERY_LIMITS.metadataBytes); return;
    }
    const asset = byMember.get(member);
    if (!asset || entry.size !== asset.bytes || restored.has(asset.id) || additionIds.has(asset.id)) throw new Error("UNEXPECTED_OR_DUPLICATE_ASSET");
    restored.set(asset.id, await restoreAsset(entry, asset, objects));
  };
  const archive = await privateInput(plan.archivePath, RECOVERY_LIMITS.totalBytes), archiveHash = createHash("sha256");
  async function* archiveSource() {
    for await (const chunk of archive.handle.createReadStream({ autoClose: false })) { archiveHash.update(chunk); yield chunk; }
  }
  try {
    await parseArchive(archiveSource(), async entry => {
      if (entry.path === "sanity-export.tar.gz") {
        if (nested || root || entry.type !== "File") throw new Error("INVALID_WRAPPED_EXPORT"); nested = true;
        await parseArchive(entry, official);
      } else if (["raw-documents.ndjson", "manifest-before.json", "manifest-after.json", "dataset-metadata.json", "capture.json", "asset-byte-proof.json", "verification.json", "RECOVERY.md", "bundle-members.json"].includes(entry.path)) {
        if (!nested || entry.type !== "File") throw new Error("INVALID_WRAPPED_METADATA"); await consume(entry, RECOVERY_LIMITS.metadataBytes);
      } else { if (nested) throw new Error("UNEXPECTED_WRAPPED_ENTRY"); await official(entry); }
    });
    await archive.unchanged();
    if (archiveHash.digest("hex") !== plan.archiveSha256 || !officialData || !officialManifest) throw new Error("ARCHIVE_CHANGED_OR_INCOMPLETE");
  } finally { await archive.handle.close(); }
  for (const addition of plan.additions) {
    const asset = plan.assets.find(a => a.id === addition.assetId)!;
    const source = await privateInput(addition.path, RECOVERY_LIMITS.assetBytes);
    try { restored.set(asset.id, await restoreAsset(source.handle.createReadStream({ autoClose: false }), asset, objects, addition.sha256)); await source.unchanged(); }
    finally { await source.handle.close(); }
  }
  if (restored.size !== plan.assets.length) throw new Error("MISSING_ASSETS");
  // Read the newly written bytes back from disk before recording success.
  for (const asset of restored.values()) if (await hashInput(path.join(objects, asset.assetId), RECOVERY_LIMITS.assetBytes) !== asset.sha256) throw new Error("RECOVERED_ASSET_READBACK_MISMATCH");
  if (await hashInput(path.join(folder, "raw-documents.ndjson"), RECOVERY_LIMITS.metadataBytes) !== options.snapshotSha256) throw new Error("RECOVERED_SNAPSHOT_READBACK_MISMATCH");
  const receipt = { version: 1, completedAt: new Date().toISOString(), archiveSha256: plan.archiveSha256, snapshotSha256: options.snapshotSha256,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"), documentCount: plan.documentCount, assetCount: restored.size,
    assetBytes: plan.assets.reduce((n, a) => n + a.bytes, 0), additions: plan.additions.length, assets: [...restored.values()].sort((a, b) => a.assetId.localeCompare(b.assetId)),
    localBytesRecoveredAndReadBack: true, providerRestorePerformed: false, snapshotCompletenessVerified: false, cmsMutated: false, launchAccepted: false };
  await writePrivateBytes(folder, "receipt.json", JSON.stringify(receipt, null, 2) + "\n");
  return receipt;
}
