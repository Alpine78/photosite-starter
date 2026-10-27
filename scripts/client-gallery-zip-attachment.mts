/** Pure approval binding for the controlled owner-run ZIP writer. This is not an ACL. */
import path from "node:path";
import { canonicalJson, digest, LIMITS, strictJson } from "./identity-retirement-reconciliation.mts";
import { parsePublicReadTarget } from "./sanity-read-http.mts";
import { parseClientGalleryZipReference, parseClientGalleryZipAsset } from "../src/lib/client-gallery-zip-contract.ts";
export class ZipAttachmentError extends Error {
  readonly code: string;
  constructor(code: string) { super(`[client-gallery-zip] ${code}`); this.code = code; }
}
export function refuseAttachment(code: string): never { throw new ZipAttachmentError(code); }
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![null, Object.prototype].includes(Object.getPrototypeOf(value))) return refuseAttachment("INVALID_DATA");
  return value as Record<string, unknown>;
}
function keys(row: Record<string, unknown>, names: readonly string[]) {
  if (Object.keys(row).length !== names.length || names.some(name => !Object.hasOwn(row, name))) refuseAttachment("INVALID_INPUT");
}
function cleanTree(value: unknown): void {
  if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) refuseAttachment("INVALID_INPUT"); cleanTree(child);
  }
}
export function privateJson(bytes: Uint8Array): unknown {
  if (!bytes.length || bytes.length > 65_536) return refuseAttachment("INVALID_INPUT");
  try {
    const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    const value = strictJson(text, { ...LIMITS, bytes: 65_536, nodes: 4096, depth: 16 }); cleanTree(value); return value;
  } catch { return refuseAttachment("INVALID_INPUT"); }
}
export type AttachmentInput = Readonly<{
  target: { projectId: string; dataset: string; apiVersion: string }; galleryId: string;
  expectedDraftRevision: string; expectedExistingZip: string | null; assetId: string | null;
  classification?: "processed-jpeg-exports"; exportsDirectory?: string; selectionFile?: string; archiveFile?: string;
}>;
const fileId = (value: unknown): value is string => typeof value === "string" && /^file-[a-f0-9]{40}-zip$/u.exec(value)?.[0] === value;
export function parseAttachmentInput(value: unknown): AttachmentInput {
  const row = record(value), attach = row.assetId !== null;
  keys(row, ["target", "galleryId", "expectedDraftRevision", "expectedExistingZip", "assetId", ...(attach ? ["classification", "exportsDirectory", "selectionFile", "archiveFile"] : [])]);
  const target = record(row.target); keys(target, ["projectId", "dataset", "apiVersion"]);
  if ([target.projectId, target.dataset, target.apiVersion].some(v => typeof v !== "string" || v.trim() !== v || /[\p{Cc}]/u.test(v))) return refuseAttachment("INVALID_INPUT");
  try {
    parsePublicReadTarget(target as AttachmentInput["target"]);
    // Doc includeAllVersions=false is supported from this dated API contract.
    if ((target.apiVersion as string) < "v2025-02-19") return refuseAttachment("INVALID_TARGET");
  } catch { return refuseAttachment("INVALID_TARGET"); }
  if (typeof row.galleryId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(row.galleryId) || row.galleryId.trim() !== row.galleryId || /^(?:drafts|versions)\./u.test(row.galleryId) || row.galleryId.includes("..") ||
    typeof row.expectedDraftRevision !== "string" || /^[A-Za-z0-9_-]{1,128}$/u.exec(row.expectedDraftRevision)?.[0] !== row.expectedDraftRevision ||
    row.expectedExistingZip !== null && !fileId(row.expectedExistingZip) || attach && !fileId(row.assetId) || !attach && row.expectedExistingZip === null) return refuseAttachment("INVALID_INPUT");
  if (attach && (row.classification !== "processed-jpeg-exports" || [row.exportsDirectory, row.selectionFile, row.archiveFile].some(v => typeof v !== "string" || v.length > 4096 || /[\p{Cc}]/u.test(v) || !path.isAbsolute(v) || path.normalize(v) !== v))) return refuseAttachment("INVALID_INPUT");
  return row as AttachmentInput;
}
export const hashRecord = (value: unknown) => digest(Buffer.from(canonicalJson(value)));
export function authoredHash(value: unknown): string {
  const row = record(value); return hashRecord(Object.fromEntries(Object.entries(row).filter(([key]) => !["_rev", "_createdAt", "_updatedAt"].includes(key))));
}
export function zipField(assetId: string) { return { _type: "file", asset: { _type: "reference", _ref: assetId } }; }
export function attachmentPlan(input: AttachmentInput, draftValue: unknown, assetValue: unknown, reports: Readonly<Record<string, unknown>>) {
  const draft = record(draftValue);
  const allowed = ["_id", "_type", "_rev", "_createdAt", "_updatedAt", "_system", "handle", "title", "available", "availabilityMode", "expiryInstant", "items", "deliveryZip"];
  if (draft._id !== `drafts.${input.galleryId}` || draft._type !== "clientDeliveryGallery" || draft._rev !== input.expectedDraftRevision || Object.keys(draft).some(k => !allowed.includes(k)) || Buffer.byteLength(canonicalJson(draft)) > 256 * 1024) return refuseAttachment("STALE_OR_INVALID_DRAFT");
  let old: string | null;
  try { old = parseClientGalleryZipReference(draft.deliveryZip)?.assetId ?? null; } catch { return refuseAttachment("INVALID_EXISTING_ZIP"); }
  if (old !== input.expectedExistingZip) return refuseAttachment("EXISTING_ZIP_MISMATCH");
  let asset: ReturnType<typeof parseClientGalleryZipAsset> | null = null;
  if (input.assetId) { try { asset = parseClientGalleryZipAsset(assetValue, input.assetId); } catch { return refuseAttachment("INVALID_ASSET"); } }
  const after = { ...draft }; if (input.assetId) after.deliveryZip = zipField(input.assetId); else delete after.deliveryZip;
  if (Buffer.byteLength(canonicalJson(after)) > 256 * 1024) refuseAttachment("DRAFT_SIZE_LIMIT");
  const plan = { domain: "photosite-client-gallery-zip-attachment", schemaVersion: 1, toolVersion: 1, input,
    sourceHash: authoredHash(draft), expectedPostHash: authoredHash(after), asset,
    assetDocumentHash: asset ? hashRecord(assetValue) : null,
    reportDigests: Object.fromEntries(Object.entries(reports).map(([key, report]) => [key, hashRecord(report)])),
    alreadyMatching: old === input.assetId };
  return { ...plan, digest: hashRecord(plan) };
}
export type AttachmentPlan = ReturnType<typeof attachmentPlan>;
export function attachmentMutation(plan: AttachmentPlan) {
  return { patch: { id: `drafts.${plan.input.galleryId}`, ifRevisionID: plan.input.expectedDraftRevision,
    ...(plan.input.assetId ? { set: { deliveryZip: zipField(plan.input.assetId) } } : { unset: ["deliveryZip"] }) } };
}
export function reconcileAttachment(plan: AttachmentPlan, observed: unknown): "observed" | "not-observed" | "uncertain" {
  try {
    const row = record(observed); if (row._id !== `drafts.${plan.input.galleryId}` || row._type !== "clientDeliveryGallery") return "uncertain";
    if (typeof row._rev !== "string" || /^[A-Za-z0-9_-]{1,128}$/u.exec(row._rev)?.[0] !== row._rev) return "uncertain";
    if (row._rev !== plan.input.expectedDraftRevision && authoredHash(row) === plan.expectedPostHash) return "observed";
    if (row._rev === plan.input.expectedDraftRevision && authoredHash(row) === plan.sourceHash) return "not-observed";
  } catch { /* Closed uncertain outcome, no provider content. */ }
  return "uncertain";
}
export function parseAttachmentArguments(args: readonly string[]) {
  const flags = new Map<string, string>(); let apply = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]; if (key === "--apply" && !apply) { apply = true; continue; }
    if (!["--input", "--output", "--approved-digest"].includes(key) || flags.has(key) || !args[i + 1] || args[i + 1].startsWith("--")) return refuseAttachment("INVALID_ARGUMENTS"); flags.set(key, args[++i]);
  }
  if (!flags.has("--input") || !flags.has("--output") || apply !== flags.has("--approved-digest") || apply && !/^[a-f0-9]{64}$/u.test(flags.get("--approved-digest")!)) return refuseAttachment("INVALID_ARGUMENTS");
  return { input: path.resolve(flags.get("--input")!), output: path.resolve(flags.get("--output")!), apply, approvedDigest: flags.get("--approved-digest") };
}
