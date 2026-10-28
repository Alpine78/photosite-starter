/** Finite synthetic scope for the separately invoked cleanup rehearsal. */
import { createHash } from "node:crypto";
import { parseSanityJsonWithoutDuplicates } from "../src/lib/sanity-json.ts";

export const CASES = ["source-revision", "image-revision", "zip-revision", "late-referrer", "late-draft", "claim-response-loss", "delete-response-loss", "late-delete", "duplicate-runners"] as const;
export const FIXED_CURSOR_ID = "clientGalleryCleanupCursor.daily";
export type CaseName = typeof CASES[number];
export type Target = { projectId: string; dataset: "preview"; apiVersion: string };
export type Baseline = { id: string; type: string; revision: string };
export type Asset = { id: string; sha256: string; sha1: string; bytes: number };
export type Case = { name: CaseName; galleryId: string; controlId: string; draftId: string; referrerId: string; image: Asset; zip: Asset };
export type Manifest = { version: 1; sourceSha: string; nonce: string; createdAt: string; target: Target; baseline: Baseline[]; cases: Case[] };
export class RehearsalError extends Error { constructor(code: string) { super(`[cleanup-rehearsal] ${code}`); this.name = "RehearsalError"; } }
export function requireRehearsal(condition: unknown, code: string): asserts condition { if (!condition) throw new RehearsalError(code); }
export function manifestDigest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
const hex = (value: unknown, length: number): value is string => typeof value === "string" && new RegExp(`^[a-f0-9]{${length}}$`, "u").test(value);
export function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
function closed(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  requireRehearsal(record(value) && Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key)), "invalid_manifest");
}
export function strictJson(bytes: Uint8Array): unknown {
  requireRehearsal(bytes.length > 0 && bytes.length <= 128 * 1024 && !(bytes[0] === 239 && bytes[1] === 187 && bytes[2] === 191), "invalid_json");
  try { return parseSanityJsonWithoutDuplicates(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new RehearsalError("invalid_json"); }
}
export function targetOf(value: unknown): Target {
  closed(value, ["projectId", "dataset", "apiVersion"]);
  requireRehearsal(typeof value.projectId === "string" && /^[a-z0-9]{1,32}$/u.test(value.projectId) && value.dataset === "preview" &&
    typeof value.apiVersion === "string" && /^v\d{4}-\d{2}-\d{2}$/u.test(value.apiVersion) && value.apiVersion >= "v2025-02-19" &&
    Number.isFinite(Date.parse(value.apiVersion.slice(1))) && new Date(value.apiVersion.slice(1)).toISOString().slice(0, 10) === value.apiVersion.slice(1), "invalid_target");
  return value as Target;
}
export function assetEvidence(bytes: Uint8Array, kind: "image" | "zip"): Asset {
  const sha1 = createHash("sha1").update(bytes).digest("hex");
  return { id: kind === "image" ? `image-${sha1}-256x192-webp` : `file-${sha1}-zip`, sha1, sha256: manifestDigest(bytes), bytes: bytes.length };
}
function identities(nonce: string, name: CaseName, index: number) {
  const galleryId = `cleanupRehearsal-${nonce}-${index}`;
  return { name, galleryId, draftId: `drafts.${galleryId}`, referrerId: `${galleryId}-ref`, controlId: `clientGalleryCleanup.${manifestDigest(Buffer.from(galleryId))}` };
}
export function buildManifest(input: Omit<Manifest, "version" | "cases">, fixtures: ReadonlyMap<string, { image: Uint8Array; zip: Uint8Array }>): Manifest {
  return { version: 1, ...input, cases: CASES.map((name, index) => {
    const files = fixtures.get(name); requireRehearsal(files, "missing_fixture");
    return { ...identities(input.nonce, name, index), image: assetEvidence(files.image, "image"), zip: assetEvidence(files.zip, "zip") };
  }) };
}
export function expectedTypes(manifest: Manifest): ReadonlyMap<string, string> {
  const rows: [string, string][] = [[FIXED_CURSOR_ID, "clientGalleryCleanupCursor"]];
  for (const entry of manifest.cases) rows.push([entry.galleryId, "clientDeliveryGallery"], [entry.draftId, "clientDeliveryGallery"],
    [entry.controlId, "clientGalleryCleanup"], [entry.referrerId, "cleanupRehearsalReferrer"], [entry.image.id, "sanity.imageAsset"], [entry.zip.id, "sanity.fileAsset"]);
  return new Map(rows);
}
export function ownedIds(manifest: Manifest): ReadonlySet<string> { return new Set(expectedTypes(manifest).keys()); }
export function parseManifest(bytes: Uint8Array, approvedDigest: string, now: number): Manifest {
  requireRehearsal(hex(approvedDigest, 64) && manifestDigest(bytes) === approvedDigest, "approval_mismatch");
  const value = strictJson(bytes); closed(value, ["version", "sourceSha", "nonce", "createdAt", "target", "baseline", "cases"]);
  requireRehearsal(value.version === 1 && hex(value.sourceSha, 40) && hex(value.nonce, 32) && typeof value.createdAt === "string" &&
    Number.isFinite(Date.parse(value.createdAt)) && new Date(value.createdAt).toISOString() === value.createdAt &&
    Date.parse(value.createdAt) <= now + 60_000 && now - Date.parse(value.createdAt) <= 3 * 60 * 60_000, "invalid_manifest");
  targetOf(value.target);
  requireRehearsal(Array.isArray(value.baseline) && value.baseline.length <= 32 && Array.isArray(value.cases) && value.cases.length === CASES.length, "invalid_manifest");
  for (const baseline of value.baseline) {
    closed(baseline, ["id", "type", "revision"]);
    requireRehearsal(typeof baseline.id === "string" && /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u.test(baseline.id) &&
      ["system.group", "system.retention"].includes(baseline.type as string) && typeof baseline.revision === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(baseline.revision), "invalid_baseline");
  }
  let totalBytes = 0;
  for (const [index, entry] of value.cases.entries()) {
    closed(entry, ["name", "galleryId", "draftId", "referrerId", "controlId", "image", "zip"]);
    for (const [key, expected] of Object.entries(identities(value.nonce, CASES[index], index))) requireRehearsal(entry[key] === expected, "invalid_case");
    for (const kind of ["image", "zip"] as const) {
      const asset = entry[kind]; closed(asset, ["id", "sha1", "sha256", "bytes"]);
      requireRehearsal(hex(asset.sha1, 40) && hex(asset.sha256, 64) && Number.isSafeInteger(asset.bytes) && (asset.bytes as number) > 0 && (asset.bytes as number) <= 1024 * 1024 &&
        asset.id === (kind === "image" ? `image-${asset.sha1}-256x192-webp` : `file-${asset.sha1}-zip`), "invalid_asset");
      totalBytes += asset.bytes as number;
    }
  }
  const manifest = value as Manifest, ids = ownedIds(manifest);
  requireRehearsal(ids.size === 1 + CASES.length * 6 && new Set(manifest.baseline.map(row => row.id)).size === manifest.baseline.length &&
    manifest.baseline.every(row => !ids.has(row.id)) && totalBytes <= 2 * 1024 * 1024, "invalid_manifest");
  return manifest;
}
export function assertSnapshot(manifest: Manifest, rows: ReadonlyMap<string, Baseline>, initial = false): void {
  const baseline = new Map(manifest.baseline.map(row => [row.id, row])), expected = expectedTypes(manifest);
  for (const row of baseline.values()) {
    const actual = rows.get(row.id);
    requireRehearsal(actual?.type === row.type && actual.revision === row.revision, "baseline_changed");
  }
  for (const [id, row] of rows) requireRehearsal(row.id === id && (baseline.has(id) || !initial && expected.get(id) === row.type), "foreign_content");
}
/** No JSONPath patches, query deletes, wildcard ownership or unguarded deletion. */
export function assertMutations(manifest: Manifest, mutations: readonly unknown[]): void {
  requireRehearsal(Array.isArray(mutations) && mutations.length > 0 && mutations.length <= 200 && Buffer.byteLength(JSON.stringify({ mutations })) <= 128 * 1024, "mutation_refused");
  const expected = expectedTypes(manifest), assertions = new Set<string>();
  function refs(value: unknown, depth = 0): void {
    requireRehearsal(depth < 32, "mutation_refused");
    if (Array.isArray(value)) { value.forEach(child => refs(child, depth + 1)); return; }
    if (!record(value)) return;
    if ("_ref" in value || value._type === "reference") requireRehearsal(typeof value._ref === "string" && expected.has(value._ref) && (!Object.hasOwn(value, "_weak") || value._weak === false), "foreign_reference");
    Object.values(value).forEach(child => refs(child, depth + 1));
  }
  for (const mutation of mutations) {
    requireRehearsal(record(mutation) && Object.keys(mutation).length === 1, "mutation_refused");
    const kind = Object.keys(mutation)[0], payload = mutation[kind];
    requireRehearsal(["create", "patch", "delete"].includes(kind) && record(payload) && !("query" in payload), "mutation_refused");
    const id = (kind === "create" ? payload._id : payload.id) as string;
    requireRehearsal(typeof id === "string" && expected.has(id), "foreign_target"); refs(payload);
    if (kind === "create") {
      requireRehearsal(payload._type === expected.get(id) && !["sanity.imageAsset", "sanity.fileAsset"].includes(payload._type as string) && !["_rev", "_createdAt", "_updatedAt"].some(key => key in payload), "mutation_refused");
      assertions.add(id);
    } else if (kind === "patch") {
      requireRehearsal(Object.keys(payload).every(key => ["id", "ifRevisionID", "set", "unset"].includes(key)) && typeof payload.ifRevisionID === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(payload.ifRevisionID), "mutation_refused");
      const field = (key: unknown) => typeof key === "string" && /^[A-Za-z][A-Za-z0-9_]*$/u.test(key);
      requireRehearsal((payload.set === undefined || record(payload.set) && Object.keys(payload.set).every(field)) &&
        (payload.unset === undefined || Array.isArray(payload.unset) && payload.unset.every(field)), "mutation_refused");
      assertions.add(id);
    } else requireRehearsal(Object.keys(payload).length === 1 && assertions.has(id), "unguarded_delete");
  }
}
