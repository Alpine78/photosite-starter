/** Pure recovery inventory. Archive paths are lookup keys, never output paths. */
export const RECOVERY_LIMITS = { metadataBytes: 256 * 1024 * 1024, assetBytes: 8 * 1024 ** 3, totalBytes: 256 * 1024 ** 3, entries: 100_000, assets: 50_000 };
export type RecoveryAsset = { id: string; sha1: string; bytes: number; member: string };
export type RecoveryAddition = { assetId: string; path: string; bytes: number; sha256: string };
export type RecoveryPlan = { archivePath: string; archiveSha256: string; assets: RecoveryAsset[]; additions: RecoveryAddition[]; documentCount: number };
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
export const digest = (v: unknown, length: number): v is string => typeof v === "string" && new RegExp(`^[a-f0-9]{${length}}$`).test(v);
export function recoveryAsset(d: unknown): RecoveryAsset {
  if (!object(d) || typeof d._id !== "string") throw new Error("INVALID_ASSET");
  const match = /^(image|file)-([a-f0-9]{40})(?:-([1-9][0-9]{0,7})x([1-9][0-9]{0,7}))?-([a-z0-9]{1,12})$/.exec(d._id);
  if (!match || d.sha1hash !== match[2] || d.extension !== match[5] || d._type !== `sanity.${match[1]}Asset` || !Number.isSafeInteger(d.size) || (d.size as number) <= 0 || (d.size as number) > RECOVERY_LIMITS.assetBytes || ((match[1] === "image") !== Boolean(match[3]))) throw new Error("INVALID_ASSET");
  // Match the pinned @sanity/export AssetHandler.generateFilename, including
  // its .bin fallback for extension tokens containing digits.
  const filename = /^(image|file)-(.*?)(-[a-z]+)?$/.exec(d._id)!;
  return { id: d._id, sha1: match[2], bytes: d.size as number,
    member: `${match[1] === "image" ? "images" : "files"}/${filename[2]}.${filename[3]?.slice(1) ?? "bin"}` };
}
export function recoveryPlan(manifest: unknown, snapshot: Buffer): RecoveryPlan {
  if (!object(manifest) || typeof manifest.archivePath !== "string" || manifest.archivePath.length > 4096 || !digest(manifest.archiveSha256, 64) || !Array.isArray(manifest.assetDocuments) || !Array.isArray(manifest.originalAdditions) || manifest.assetDocuments.length > RECOVERY_LIMITS.assets || manifest.originalAdditions.length > RECOVERY_LIMITS.assets || snapshot.length > RECOVERY_LIMITS.metadataBytes) throw new Error("INVALID_MANIFEST");
  const lines = new TextDecoder("utf-8", { fatal: true }).decode(snapshot).split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (!lines.length || lines.length > RECOVERY_LIMITS.entries) throw new Error("SNAPSHOT_LIMIT");
  const documents = lines.map(line => {
    if (Buffer.byteLength(line) > 4 * 1024 * 1024) throw new Error("SNAPSHOT_LINE_LIMIT");
    const d: unknown = JSON.parse(line);
    if (!object(d) || typeof d._id !== "string" || !/^[a-zA-Z0-9_-][a-zA-Z0-9_.-]{0,199}$/.test(d._id) || typeof d._rev !== "string" || !/^[a-zA-Z0-9_.-]{1,200}$/.test(d._rev) || typeof d._type !== "string" || !/^[a-zA-Z0-9_.-]{1,100}$/.test(d._type)) throw new Error("INVALID_RAW_DOCUMENT");
    return d;
  });
  if (new Set(documents.map(d => d._id)).size !== documents.length) throw new Error("DUPLICATE_RAW_DOCUMENT");
  const assets = manifest.assetDocuments.map(recoveryAsset), current = documents.filter(d => d._type === "sanity.imageAsset" || d._type === "sanity.fileAsset").map(recoveryAsset);
  const identities = new Map(assets.map(a => [a.id, a]));
  if (identities.size !== assets.length || !assets.length || current.length !== assets.length || current.some(a => JSON.stringify(a) !== JSON.stringify(identities.get(a.id)))) throw new Error("SNAPSHOT_ASSET_COVERAGE_MISMATCH");
  if (assets.reduce((n, a) => n + a.bytes, 0) > RECOVERY_LIMITS.totalBytes) throw new Error("TOTAL_ASSET_LIMIT");
  const additions = manifest.originalAdditions.map(a => {
    if (!object(a) || typeof a.assetId !== "string" || typeof a.path !== "string" || a.path.length > 4096 || !digest(a.sha256, 64) || a.bytes !== identities.get(a.assetId)?.bytes) throw new Error("INVALID_ADDITION");
    return { assetId: a.assetId, path: a.path, bytes: a.bytes as number, sha256: a.sha256 };
  });
  if (new Set(additions.map(a => a.assetId)).size !== additions.length) throw new Error("DUPLICATE_ADDITION");
  return { archivePath: manifest.archivePath, archiveSha256: manifest.archiveSha256, assets, additions, documentCount: documents.length };
}
export function safeArchiveEntry(name: string, type: string, bytes: number, seen: Set<string>): void {
  const parts = name.replace(/\/$/, "").split("/");
  if (!name || name.length > 512 || /[\\\x00-\x1f\x7f]/.test(name) || parts.some(p => !p || p === "." || p === "..") || seen.has(parts.join("/")) || !["File", "OldFile", "Directory"].includes(type) || !Number.isSafeInteger(bytes) || bytes < 0 || bytes > RECOVERY_LIMITS.totalBytes || (type === "Directory" && bytes !== 0) || seen.size >= RECOVERY_LIMITS.entries) throw new Error("UNSAFE_OR_DUPLICATE_ARCHIVE_ENTRY");
  seen.add(parts.join("/"));
}
