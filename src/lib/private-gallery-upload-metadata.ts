/** Exact-key, read-only metadata collection for a committed private preparation. */
import "server-only";
import { performance } from "node:perf_hooks";
import type { PrivateGalleryUploadPlan } from "@/lib/private-gallery-upload";
import type { PrivateGalleryObjectObservation } from "@/lib/private-gallery-upload-completion";
import { privateGalleryObjectKeyPrefix, isPrivateGalleryObjectKeyInPrefix } from "@/lib/private-gallery-object-key";
import { snapshotPrivateGalleryUploadCompletionEvidence } from "@/lib/private-gallery-upload-evidence";
import { PRIVATE_GALLERY_MAX_PREPARATION_DAYS } from "@/lib/private-gallery-retention";
import { PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY, PRIVATE_GALLERY_DEFAULT_MAX_CLI_UPLOAD_CONCURRENCY,
  PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES, PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_LONGEST_EDGE_PX,
  PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES, PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES } from "@/lib/private-gallery-limits";

export const PRIVATE_UPLOAD_METADATA_READ_TIMEOUT_MS = 5000;
export const PRIVATE_UPLOAD_METADATA_PASS_TIMEOUT_MS = 30000;
type Reason = "invalid-plan" | "invalid-time" | "preparation-expired" | "aborted" | "read-timeout" |
  "pass-timeout" | "reader-failed" | "invalid-metadata";
export class PrivateGalleryUploadMetadataError extends Error {
  constructor(readonly reason: Reason) {
    super(`[private-upload-metadata] ${reason}`);
    this.name = "PrivateGalleryUploadMetadataError";
  }
}
export type PrivateGalleryUploadMetadataReader = {
  /**
   * Metadata only, never listing or reading the object body. Undefined means a
   * definitive not-found response, not a permission/transport ambiguity. 403,
   * 5xx, throttle and uncertain responses must throw. Honor signal cancellation.
   * Return a closed DTO; do not echo an object key or raw provider response.
   */
  head(input: { readonly objectKey: string; readonly signal: AbortSignal }): Promise<Omit<PrivateGalleryObjectObservation, "objectKey"> | undefined>;
};
function fail(reason: Reason): never { throw new PrivateGalleryUploadMetadataError(reason); }
function validDate(value: unknown): value is Date { return value instanceof Date && Number.isFinite(value.getTime()); }

function snapshotPlan(plan: PrivateGalleryUploadPlan, keyPrefix: string) {
  if (!plan || !["proof", "delivery"].includes(plan.galleryKind) || !plan.preparation ||
      !Array.isArray(plan.objects) || plan.objects.length < 1 || plan.objects.length > PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY ||
      !Array.isArray(plan.preparation.objectKeys) || plan.preparation.objectKeys.length !== plan.objects.length ||
      !validDate(plan.preparation.openedAt) || !validDate(plan.preparation.deadline) ||
      plan.preparation.deadline <= plan.preparation.openedAt ||
      plan.preparation.deadline.getTime() - plan.preparation.openedAt.getTime() > PRIVATE_GALLERY_MAX_PREPARATION_DAYS * 86400000) fail("invalid-plan");
  let prefix: string;
  try { prefix = privateGalleryObjectKeyPrefix({ keyPrefix, galleryId: plan.preparation.galleryId }); }
  catch { fail("invalid-plan"); }
  const keys: string[] = [];
  let total = 0, zipCount = 0;
  for (const object of plan.objects) {
    if (!object || typeof object.objectKey !== "string" || !isPrivateGalleryObjectKeyInPrefix(object.objectKey, keyPrefix) ||
        !object.objectKey.startsWith(prefix) ||
        (plan.galleryKind === "proof" ? object.objectKind !== "proof" : !["preview", "zip"].includes(object.objectKind)) ||
        !new RegExp(`^${object.objectKind}/[A-Za-z0-9_-]{22}$`).test(object.objectKey.slice(prefix.length)) ||
        !Number.isSafeInteger(object.nominalBytes) || object.nominalBytes < 1) fail("invalid-plan");
    if (object.objectKind === "zip") {
      if (++zipCount > 1 || object.nominalBytes > PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES) fail("invalid-plan");
    } else if (object.nominalBytes > PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES ||
        !Number.isSafeInteger(object.width) || !Number.isSafeInteger(object.height) || object.width < 1 || object.height < 1 ||
        Math.max(object.width, object.height) > PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_LONGEST_EDGE_PX) fail("invalid-plan");
    total += object.nominalBytes;
    if (!Number.isSafeInteger(total) || total > PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES) fail("invalid-plan");
    keys.push(object.objectKey);
  }
  const preparedKeys = new Set(plan.preparation.objectKeys);
  if (total !== plan.totalBytes || new Set(keys).size !== keys.length || preparedKeys.size !== keys.length ||
      keys.some((key) => !preparedKeys.has(key))) fail("invalid-plan");
  return { keys, openedAt: plan.preparation.openedAt.getTime(), deadline: plan.preparation.deadline.getTime() };
}

/**
 * Observations only: the store still owns revision/deadline CAS and verification.
 * Missing observations cannot make its incomplete set ready. Immutability and
 * checksum/version semantics remain the live provider gate; HEAD proves no ZIP
 * membership, decoded pixels or protection against a subsequent object overwrite.
 * A large slow plan may exceed this pass budget and must fail without acceptance.
 */
export async function collectPrivateGalleryUploadMetadata(input: {
  readonly plan: PrivateGalleryUploadPlan; readonly keyPrefix: string;
  readonly reader: PrivateGalleryUploadMetadataReader; readonly clock: () => Date; readonly signal?: AbortSignal;
}): Promise<readonly PrivateGalleryObjectObservation[]> {
  if (input.signal?.aborted) fail("aborted");
  let captured: ReturnType<typeof snapshotPlan>;
  try { captured = snapshotPlan(input.plan, input.keyPrefix); } catch { fail("invalid-plan"); }
  const now = () => {
    let value;
    try { value = input.clock(); } catch { fail("invalid-time"); }
    if (!validDate(value)) fail("invalid-time");
    return value.getTime();
  };
  const initialNow = now();
  if (initialNow < captured.openedAt) fail("invalid-time");
  if (initialNow >= captured.deadline) fail("preparation-expired");
  const budget = Math.min(PRIVATE_UPLOAD_METADATA_PASS_TIMEOUT_MS, captured.deadline - initialNow);
  const started = performance.now();
  const controller = new AbortController();
  let terminal: Reason | undefined;
  const stop = (reason: Reason) => { if (!terminal) { terminal = reason; controller.abort(); } };
  const onAbort = () => stop("aborted");
  input.signal?.addEventListener("abort", onAbort, { once: true });
  if (input.signal?.aborted) stop("aborted");
  const passTimer = setTimeout(() => stop(captured.deadline - initialNow <= PRIVATE_UPLOAD_METADATA_PASS_TIMEOUT_MS ? "preparation-expired" : "pass-timeout"), budget);
  const remaining = () => {
    if (terminal) fail(terminal);
    const current = now();
    if (current < initialNow) fail("invalid-time");
    if (current >= captured.deadline) fail("preparation-expired");
    const elapsed = performance.now() - started;
    if (elapsed >= budget) fail("pass-timeout");
    return Math.min(PRIVATE_UPLOAD_METADATA_READ_TIMEOUT_MS, budget - elapsed, captured.deadline - current);
  };
  const scope = { objects: captured.keys, preparation: { objectKeys: captured.keys } };
  const rows: (PrivateGalleryObjectObservation | undefined)[] = new Array(captured.keys.length);
  let cursor = 0;
  function read(objectKey: string): Promise<PrivateGalleryObjectObservation | undefined> {
    const timeout = remaining();
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined = undefined;
      const finish = (result?: PrivateGalleryObjectObservation) => {
        if (settled) return;
        settled = true;
        if (timer !== undefined) clearTimeout(timer);
        controller.signal.removeEventListener("abort", cancelled);
        if (terminal) reject(new PrivateGalleryUploadMetadataError(terminal));
        else resolve(result);
      };
      const cancelled = () => finish();
      controller.signal.addEventListener("abort", cancelled, { once: true });
      if (controller.signal.aborted) { finish(); return; }
      timer = setTimeout(() => stop("read-timeout"), timeout);
      // Both rejection paths are attached immediately, including synchronous throws.
      void Promise.resolve().then(() => input.reader.head({ objectKey, signal: controller.signal })).then((value) => {
        if (settled) return;
        try {
          if (value === undefined) { finish(); return; }
          if (!value || typeof value !== "object" || Array.isArray(value) ||
              Object.keys(value).some((key) => !["sizeBytes", "etag", "checksum"].includes(key))) fail("invalid-metadata");
          const { sizeBytes, etag, checksum } = value;
          if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) fail("invalid-metadata");
          const observation = snapshotPrivateGalleryUploadCompletionEvidence({ receipts: [],
            observations: [{ objectKey, sizeBytes, ...(etag === undefined ? {} : { etag }), ...(checksum === undefined ? {} : { checksum }) }] }, scope).observations[0];
          if (observation.checksum) Object.freeze(observation.checksum);
          finish(Object.freeze(observation));
        } catch { stop("invalid-metadata"); }
      }, () => stop("reader-failed"));
    });
  }
  try {
    const worker = async () => {
      while (!terminal && cursor < captured.keys.length) {
        const index = cursor++;
        try { rows[index] = await read(captured.keys[index]); }
        catch (error) {
          stop(error instanceof PrivateGalleryUploadMetadataError ? error.reason : "reader-failed");
          throw new PrivateGalleryUploadMetadataError(terminal!);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(captured.keys.length, PRIVATE_GALLERY_DEFAULT_MAX_CLI_UPLOAD_CONCURRENCY) }, worker));
    remaining();
    return Object.freeze(rows.filter((row): row is PrivateGalleryObjectObservation => row !== undefined));
  } catch (error) {
    stop(error instanceof PrivateGalleryUploadMetadataError ? error.reason : "reader-failed");
    throw new PrivateGalleryUploadMetadataError(terminal!);
  } finally {
    clearTimeout(passTimer);
    input.signal?.removeEventListener("abort", onAbort);
  }
}
