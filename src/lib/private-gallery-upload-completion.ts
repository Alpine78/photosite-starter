/**
 * Upload completion: reconciling what the CLI says it wrote against what the
 * object store actually holds (ADR-0014 §8c).
 *
 * ## Why this is a reconciliation and not a transaction
 *
 * The preceding S3 writes are not transactionally coupled to anything — they
 * cannot be. §8c's answer is that the database committed the plan *first*
 * (`private-gallery-upload.ts`), the CLI wrote only that plan, and this step
 * then compares three independent accounts of the same objects:
 *
 * 1. the **plan** — what the server assigned and expects,
 * 2. the **receipts** — what the CLI reports it uploaded,
 * 3. the **observations** — metadata-only reads of those exact keys.
 *
 * Only the third is evidence. A receipt is the CLI's claim and is used to carry
 * a checksum the store cannot compute for us, never as proof that an object
 * exists or is the right size. This module is pure: the caller performs the
 * `HEAD` reads and commits the result in one transaction.
 *
 * ## An ETag is not a content hash
 *
 * §8c states this outright and it is the one place a plausible shortcut would be
 * wrong. For a single-part upload many S3 implementations happen to return the
 * MD5 of the body; for a **multipart** upload — which every object near the ZIP
 * ceiling is — the ETag is a digest *of the part digests* plus a part count, and
 * comparing it against a hash of the file fails for correct data. Worse, it
 * would sometimes pass, so the mistake would look like a working check. An ETag
 * is therefore recorded for operational reference and **never** compared as
 * content.
 *
 * Which checksum algorithm a deployment uses is deliberately not fixed here.
 * ADR-0014 §8c leaves "the provider-supported checksum semantics" to be selected
 * against the real provider, so this module is algorithm-agnostic: it compares
 * only when both sides declare the *same* named algorithm, and refuses rather
 * than guessing when they do not.
 *
 * ## Failing closed, and staying bounded
 *
 * Any mismatch fails the whole completion: the gallery stays `preparing`, the
 * administrator sees a bounded list of what was wrong, and the CLI may retry.
 * Nothing is partially accepted, because a half-verified gallery would be a
 * gallery a customer could be shown with photographs missing. An abandoned
 * preparation is not this module's problem — the retention worker removes it and
 * its objects once the 30-day window closes.
 */

import type { PrivateGalleryUploadPreparation } from "@/lib/private-gallery";
import { isPrivateGalleryObjectKeyInPrefix } from "@/lib/private-gallery-object-key";
import { isPrivateGalleryPreparationExpired } from "@/lib/private-gallery-upload";
import { PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS } from "@/lib/private-gallery-delivery";

/**
 * How long a superseded ZIP object is kept after the pointer moves off it
 * (§8c): the longest a ZIP URL can live, plus a clock-skew margin.
 *
 * The margin is **this slice's choice**, not an ADR-fixed number — §8c says
 * "a clock-skew margin" without one. An hour is generous against any realistic
 * disagreement between the signer's clock and the store's, and the cost of
 * being generous is one extra object for one extra hour; the cost of being
 * tight is a customer's in-flight 20 GB download failing partway.
 */
export const PRIVATE_GALLERY_ZIP_PREDECESSOR_CLOCK_SKEW_MARGIN_MS = 60 * 60 * 1000;

export const PRIVATE_GALLERY_ZIP_PREDECESSOR_RETENTION_MS =
  PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS * 1000 +
  PRIVATE_GALLERY_ZIP_PREDECESSOR_CLOCK_SKEW_MARGIN_MS;

/** The most failures reported at once, so one bad run cannot flood a status. */
export const PRIVATE_GALLERY_MAX_REPORTED_VERIFICATION_FAILURES = 20;

/**
 * A named content digest. The algorithm travels with the value so nothing can
 * compare two digests that were never comparable.
 */
export type PrivateGalleryChecksum = {
  readonly algorithm: "sha256" | "crc32c";
  readonly value: string;
};

/** What the CLI reports having uploaded. A claim, never evidence. */
export type PrivateGalleryUploadReceipt = {
  readonly objectKey: string;
  readonly checksum?: PrivateGalleryChecksum;
};

/** What a metadata-only read of one key returned. This is the evidence. */
export type PrivateGalleryObjectObservation = {
  readonly objectKey: string;
  readonly sizeBytes: number;
  /** Recorded for operational reference; never compared as content (§8c). */
  readonly etag?: string;
  readonly checksum?: PrivateGalleryChecksum;
};

/** What the plan expects at one key. */
export type PrivateGalleryPlannedObjectExpectation = {
  readonly objectKey: string;
  readonly objectKind: "preview" | "proof" | "zip";
  readonly nominalBytes: number;
};

export type PrivateGalleryVerificationFailureReason =
  /** The store holds nothing at a key the plan assigned. */
  | "missing"
  /** Present, but not the size the plan declared. */
  | "size-mismatch"
  /** The store returned an object at a key this plan never assigned. */
  | "unplanned"
  /** A checksum was declared but the store reported none to compare it with. */
  | "checksum-unavailable"
  /** Both sides named a digest and they disagree. */
  | "checksum-mismatch"
  /** The two sides named different algorithms, so nothing was comparable. */
  | "checksum-algorithm-mismatch"
  /** The key does not belong to this deployment's configured prefix. */
  | "outside-prefix";

export type PrivateGalleryVerificationFailure = {
  readonly objectKey: string;
  readonly reason: PrivateGalleryVerificationFailureReason;
};

export type PrivateGalleryVerifiedObject = {
  readonly objectKey: string;
  readonly objectKind: "preview" | "proof" | "zip";
  readonly sizeBytes: number;
  readonly etag?: string;
  readonly checksum?: PrivateGalleryChecksum;
};

export type PrivateGalleryZipPointerSwap = {
  /** The new active ZIP. */
  readonly objectKey: string;
  /** Present only when this replaces one; when the predecessor may be swept. */
  readonly retainPredecessorUntil?: Date;
  readonly predecessorObjectKey?: string;
};

export type PrivateGalleryCompletionOutcome =
  | {
      readonly verified: true;
      readonly objects: readonly PrivateGalleryVerifiedObject[];
      /** Present only when the plan carried a ZIP. */
      readonly zipSwap?: PrivateGalleryZipPointerSwap;
    }
  | {
      readonly verified: false;
      readonly failures: readonly PrivateGalleryVerificationFailure[];
      /** True when the list was cut to the reporting bound. */
      readonly truncated: boolean;
    };

export type PrivateGalleryCompletionErrorReason =
  | "invalid-parameter"
  | "preparation-expired"
  | "plan-mismatch"
  | "duplicate-observation";

export class PrivateGalleryCompletionError extends Error {
  readonly reason: PrivateGalleryCompletionErrorReason;

  constructor(reason: PrivateGalleryCompletionErrorReason, message: string) {
    super(`[private-gallery-upload-completion] ${message}`);
    this.name = "PrivateGalleryCompletionError";
    this.reason = reason;
  }
}

function fail(reason: PrivateGalleryCompletionErrorReason, message: string): never {
  throw new PrivateGalleryCompletionError(reason, message);
}

function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

export type VerifyPrivateGalleryUploadParams = {
  readonly preparation: PrivateGalleryUploadPreparation;
  /** The plan's expectations, in the order the plan assigned them. */
  readonly expected: readonly PrivateGalleryPlannedObjectExpectation[];
  /** The CLI's reported receipts. Optional per object; used only for checksums. */
  readonly receipts: readonly PrivateGalleryUploadReceipt[];
  /** Metadata-only reads of exactly the planned keys. */
  readonly observations: readonly PrivateGalleryObjectObservation[];
  readonly keyPrefix: string;
  readonly now: Date;
  /** The gallery's current `activeZipObjectKey`, when it has one. */
  readonly currentZipObjectKey?: string;
};

/**
 * Decides whether an upload preparation is complete and correct.
 *
 * Throws only for a caller mistake — an expired preparation, a plan that does
 * not describe the preparation it came with, or two observations of one key.
 * Everything an ordinary failed upload produces is a *returned* failure list,
 * because that is an administrator-visible status rather than an exception.
 */
export function verifyPrivateGalleryUpload(
  params: VerifyPrivateGalleryUploadParams,
): PrivateGalleryCompletionOutcome {
  const {
    preparation,
    expected,
    receipts,
    observations,
    keyPrefix,
    now,
    currentZipObjectKey,
  } = params;

  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  if (isPrivateGalleryPreparationExpired(preparation, now)) {
    // Its objects are already on the retention worker's cleanup path, so
    // verifying them would only bless bytes scheduled for deletion.
    fail(
      "preparation-expired",
      "the preparation window closed before completion was called",
    );
  }

  const expectedByKey = new Map<string, PrivateGalleryPlannedObjectExpectation>();
  for (const item of expected) {
    if (expectedByKey.has(item.objectKey)) {
      fail("plan-mismatch", "the plan names one key more than once");
    }
    expectedByKey.set(item.objectKey, item);
  }

  // The preparation row is the authority on which keys this completion covers;
  // a plan that disagrees with it is a caller mistake, not a failed upload.
  if (
    expectedByKey.size !== preparation.objectKeys.length ||
    !preparation.objectKeys.every((key) => expectedByKey.has(key))
  ) {
    fail(
      "plan-mismatch",
      "the expectations do not describe exactly the preparation's assigned keys",
    );
  }

  const observedByKey = new Map<string, PrivateGalleryObjectObservation>();
  for (const observation of observations) {
    if (observedByKey.has(observation.objectKey)) {
      fail("duplicate-observation", "one key was observed more than once");
    }
    observedByKey.set(observation.objectKey, observation);
  }

  const receiptByKey = new Map<string, PrivateGalleryUploadReceipt>();
  for (const receipt of receipts) receiptByKey.set(receipt.objectKey, receipt);

  const failures: PrivateGalleryVerificationFailure[] = [];
  const verifiedObjects: PrivateGalleryVerifiedObject[] = [];

  // An object the plan never assigned means the CLI wrote somewhere it was not
  // told to, or the caller read a key from outside this preparation. Either way
  // nothing here vouches for it, and accepting the rest would leave an
  // unaccounted object in the bucket that no manifest covers.
  for (const key of observedByKey.keys()) {
    if (!expectedByKey.has(key)) {
      failures.push({ objectKey: key, reason: "unplanned" });
    }
  }

  for (const item of expected) {
    if (!isPrivateGalleryObjectKeyInPrefix(item.objectKey, keyPrefix)) {
      failures.push({ objectKey: item.objectKey, reason: "outside-prefix" });
      continue;
    }

    const observation = observedByKey.get(item.objectKey);
    if (observation === undefined) {
      failures.push({ objectKey: item.objectKey, reason: "missing" });
      continue;
    }
    if (!isNonNegativeInteger(observation.sizeBytes)) {
      failures.push({ objectKey: item.objectKey, reason: "size-mismatch" });
      continue;
    }
    // The declaration was a claim; this is the fact it is measured against.
    if (observation.sizeBytes !== item.nominalBytes) {
      failures.push({ objectKey: item.objectKey, reason: "size-mismatch" });
      continue;
    }

    const declared = receiptByKey.get(item.objectKey)?.checksum;
    if (declared !== undefined) {
      const observed = observation.checksum;
      if (observed === undefined) {
        // Never fall back to the ETag: for a multipart upload it is a digest of
        // part digests, so comparing it against a content hash fails for
        // correct data — and sometimes passes, which is worse.
        failures.push({
          objectKey: item.objectKey,
          reason: "checksum-unavailable",
        });
        continue;
      }
      if (observed.algorithm !== declared.algorithm) {
        failures.push({
          objectKey: item.objectKey,
          reason: "checksum-algorithm-mismatch",
        });
        continue;
      }
      if (observed.value !== declared.value) {
        failures.push({
          objectKey: item.objectKey,
          reason: "checksum-mismatch",
        });
        continue;
      }
    }

    verifiedObjects.push({
      objectKey: item.objectKey,
      objectKind: item.objectKind,
      sizeBytes: observation.sizeBytes,
      ...(observation.etag === undefined ? {} : { etag: observation.etag }),
      ...(observation.checksum === undefined
        ? {}
        : { checksum: observation.checksum }),
    });
  }

  if (failures.length > 0) {
    // Nothing is partially accepted: a half-verified gallery is one a customer
    // could be shown with photographs missing.
    return {
      verified: false,
      failures: failures.slice(
        0,
        PRIVATE_GALLERY_MAX_REPORTED_VERIFICATION_FAILURES,
      ),
      truncated:
        failures.length > PRIVATE_GALLERY_MAX_REPORTED_VERIFICATION_FAILURES,
    };
  }

  const zip = verifiedObjects.find((object) => object.objectKind === "zip");
  if (zip === undefined) {
    return { verified: true, objects: verifiedObjects };
  }

  // §8c: the pointer moves in the same transaction that records these objects,
  // and the object it moved off is kept until every URL that could name it has
  // expired. Without that margin a regeneration would break an in-flight
  // download — including a `Range` resume — that was minted against the old key.
  const predecessor =
    currentZipObjectKey !== undefined && currentZipObjectKey !== zip.objectKey
      ? currentZipObjectKey
      : undefined;

  return {
    verified: true,
    objects: verifiedObjects,
    zipSwap: {
      objectKey: zip.objectKey,
      ...(predecessor === undefined
        ? {}
        : {
            predecessorObjectKey: predecessor,
            retainPredecessorUntil: new Date(
              now.getTime() + PRIVATE_GALLERY_ZIP_PREDECESSOR_RETENTION_MS,
            ),
          }),
    },
  };
}
