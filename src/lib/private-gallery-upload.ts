/**
 * The bounded upload preparation (ADR-0014 §7, §8c) — the plan that must be
 * committed before a single private object is written.
 *
 * ## Why a plan exists at all
 *
 * An object store and a database cannot share a transaction. §8c's answer is not
 * to pretend they can, but to make the database always know first: the server
 * commits the manifest and the assigned keys, moves the gallery `draft →
 * preparing`, and only then does the owner-run CLI receive an upload plan and
 * write bytes. That ordering is what gives the retention worker an **enclosing
 * preparation to reconcile** for every object that exists. An object written
 * without one would be invisible to cleanup and would live until the backstop
 * lifecycle rule's 275 days — the one failure mode the whole retention design is
 * built to avoid.
 *
 * The reverse order has no such property, which is why "upload first, record
 * after" is not an optimisation available here.
 *
 * ## What this module decides, and what it does not
 *
 * Everything up to the plan: whether the gallery may open one, whether the
 * declared manifest fits inside §8e's ceilings, and which key each item gets.
 * For a proof the returned plan also holds the complete filename, stable media
 * identity and server-minted placement identity that the future store must
 * commit alongside the key before the CLI writes any bytes.
 * It performs no IO, opens no transaction, and never talks to the store — the
 * administrator boundary (§4, AB#145) commits what this returns, and the CLI
 * uploads it. The separate completion step compares what was actually
 * written with metadata-only reads; no real bucket is wired up yet.
 *
 * ## The ceilings are declared, not measured
 *
 * A manifest entry's byte size is what the CLI *says* it will upload. This
 * module bounds the declaration so an oversized plan is refused before any key
 * exists; the completion step re-checks the real object with a metadata read,
 * because a declaration is a claim and the bucket is the fact. Both are needed:
 * checking only at completion would mean assigning keys and writing gigabytes
 * before refusing, and checking only here would trust the client.
 */

import { randomBytes } from "node:crypto";

import {
  PRIVATE_GALLERY_STATE_TRANSITIONS,
  type PrivateGalleryKind,
  type PrivateGalleryState,
  type PrivateGalleryUploadPreparation,
} from "@/lib/private-gallery";
import {
  PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES,
  PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_LONGEST_EDGE_PX,
  PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY,
  PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES,
  PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES,
} from "@/lib/private-gallery-limits";
import { buildPrivateGalleryObjectKey } from "@/lib/private-gallery-object-key";
import { PRIVATE_GALLERY_MAX_PREPARATION_DAYS } from "@/lib/private-gallery-retention";

const DAY_MS = 24 * 60 * 60 * 1000;

export type PrivateGalleryUploadErrorReason =
  | "invalid-parameter"
  | "wrong-state"
  | "empty-manifest"
  | "too-many-files"
  | "oversized-item"
  | "oversized-gallery"
  | "duplicate-zip"
  | "preparation-expired";

export class PrivateGalleryUploadError extends Error {
  readonly reason: PrivateGalleryUploadErrorReason;

  constructor(reason: PrivateGalleryUploadErrorReason, message: string) {
    super(`[private-gallery-upload] ${message}`);
    this.name = "PrivateGalleryUploadError";
    this.reason = reason;
  }
}

function fail(reason: PrivateGalleryUploadErrorReason, message: string): never {
  throw new PrivateGalleryUploadError(reason, message);
}

function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/** One thing the CLI intends to upload, as the administrator declared it. */
export type PrivateGalleryManifestEntry =
  | {
      readonly kind: "derivative";
      readonly derivativeKind: "delivery-preview";
      readonly nominalBytes: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: "derivative";
      readonly derivativeKind: "watermarked-proof";
      readonly nominalBytes: number;
      readonly width: number;
      readonly height: number;
      /** Complete source filename, retained for permanent proof references. */
      readonly filename: string;
      /** Stable identity supplied by the owner, distinct from placementId. */
      readonly mediaId: string;
    }
  | { readonly kind: "zip"; readonly nominalBytes: number };

/** One planned object: what to upload, and the key the server assigned it. */
export type PrivateGalleryPlannedObject =
  | {
      readonly objectKey: string;
      readonly objectKind: "preview";
      readonly nominalBytes: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly objectKey: string;
      readonly objectKind: "proof";
      readonly nominalBytes: number;
      readonly width: number;
      readonly height: number;
      readonly filename: string;
      readonly mediaId: string;
      /** Opaque server identity; never the visible 001-based reference. */
      readonly placementId: string;
    }
  | {
      readonly objectKey: string;
      readonly objectKind: "zip";
      readonly nominalBytes: number;
    };

export type PrivateGalleryUploadPlan = {
  readonly galleryKind: PrivateGalleryKind;
  readonly preparation: PrivateGalleryUploadPreparation;
  readonly objects: readonly PrivateGalleryPlannedObject[];
  readonly totalBytes: number;
};

export type PrivateGalleryUploadLimits = {
  readonly maxFiles: number;
  readonly maxDerivativeBytes: number;
  readonly maxDerivativeLongestEdgePx: number;
  readonly maxTotalBytes: number;
  readonly maxZipBytes: number;
  readonly maxPreparationDays: number;
};

export const PRIVATE_GALLERY_UPLOAD_LIMITS: PrivateGalleryUploadLimits =
  Object.freeze({
    maxFiles: PRIVATE_GALLERY_DEFAULT_MAX_FILES_PER_GALLERY,
    maxDerivativeBytes: PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_BYTES,
    maxDerivativeLongestEdgePx:
      PRIVATE_GALLERY_DEFAULT_MAX_DERIVATIVE_LONGEST_EDGE_PX,
    maxTotalBytes: PRIVATE_GALLERY_DEFAULT_MAX_TOTAL_BYTES,
    maxZipBytes: PRIVATE_GALLERY_DEFAULT_MAX_ZIP_BYTES,
    maxPreparationDays: PRIVATE_GALLERY_MAX_PREPARATION_DAYS,
  });

/**
 * The states a preparation may be opened from.
 *
 * `draft` is the first one, and `preparing` is here too because §8c allows a
 * regenerated ZIP for a gallery that already holds objects — the key is new and
 * immutable every time, so a second preparation adds objects rather than
 * replacing them. A `published` gallery is deliberately absent: adding objects
 * to a gallery a customer is already reading would change what they see with no
 * record of when, and the ADR's own path for that is a fresh publication.
 */
const PREPARABLE_STATES: readonly PrivateGalleryState[] = ["draft", "preparing"];

export type OpenPrivateGalleryUploadPreparationParams = {
  readonly galleryId: string;
  readonly galleryKind: PrivateGalleryKind;
  readonly state: PrivateGalleryState;
  readonly keyPrefix: string;
  readonly preparationId: string;
  readonly manifest: readonly PrivateGalleryManifestEntry[];
  readonly now: Date;
  readonly limits?: PrivateGalleryUploadLimits;
};

/**
 * Validates a declared manifest and assigns one opaque key per entry.
 *
 * Returns a plan; commits nothing. The caller writes
 * {@link PrivateGalleryUploadPlan.preparation}, gallery kind, and the complete
 * planned-object records in one transaction, moves the gallery to `preparing`,
 * and only then hands the plan to
 * the CLI.
 *
 * Refuses the **whole** manifest when any entry is bad. A partial plan would
 * leave the administrator believing a set was uploaded that was not, and would
 * put keys in the database for objects the CLI was never told to write —
 * phantom rows the worker would then try to clean up.
 */
export function openPrivateGalleryUploadPreparation(
  params: OpenPrivateGalleryUploadPreparationParams,
): PrivateGalleryUploadPlan {
  const {
    galleryId,
    galleryKind,
    state,
    keyPrefix,
    preparationId,
    manifest,
    now,
    limits = PRIVATE_GALLERY_UPLOAD_LIMITS,
  } = params;

  if (galleryKind !== "delivery" && galleryKind !== "proof") {
    fail("invalid-parameter", "galleryKind must be delivery or proof");
  }
  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  if (typeof preparationId !== "string" || preparationId.length === 0) {
    fail("invalid-parameter", "preparationId must be a non-empty string");
  }
  if (!PREPARABLE_STATES.includes(state)) {
    fail(
      "wrong-state",
      `a gallery in ${state} may not open an upload preparation`,
    );
  }
  // The machine is the authority on where `preparing` may be reached from, so a
  // state this module thought was preparable but the machine does not is a bug
  // here rather than a permitted edge.
  if (
    state !== "preparing" &&
    !PRIVATE_GALLERY_STATE_TRANSITIONS[state].includes("preparing")
  ) {
    fail("wrong-state", `${state} has no transition to preparing`);
  }
  if (manifest.length === 0) {
    fail("empty-manifest", "an upload preparation must plan at least one object");
  }
  if (manifest.length > limits.maxFiles) {
    fail(
      "too-many-files",
      `a gallery holds at most ${limits.maxFiles} files; this manifest declares ${manifest.length}`,
    );
  }

  let totalBytes = 0;
  let zipCount = 0;
  const proofMediaIds = new Set<string>();
  const objects: PrivateGalleryPlannedObject[] = [];

  for (const entry of manifest) {
    if (!isPositiveInteger(entry.nominalBytes)) {
      fail("invalid-parameter", "every manifest entry needs a positive size");
    }

    if (entry.kind === "zip") {
      if (galleryKind !== "delivery") {
        fail("invalid-parameter", "a proof gallery cannot plan a ZIP");
      }
      zipCount += 1;
      if (zipCount > 1) {
        // §8c: one active ZIP per gallery, named by an atomically-swapped
        // pointer. Two in one plan has no pointer that could answer for both.
        fail("duplicate-zip", "a preparation may plan at most one ZIP object");
      }
      if (entry.nominalBytes > limits.maxZipBytes) {
        fail(
          "oversized-item",
          `the ZIP is bounded at ${limits.maxZipBytes} bytes; this one declares ${entry.nominalBytes}`,
        );
      }
      totalBytes += entry.nominalBytes;
      objects.push({
        objectKey: buildPrivateGalleryObjectKey({
          keyPrefix,
          galleryId,
          kind: "zip",
        }),
        objectKind: "zip",
        nominalBytes: entry.nominalBytes,
      });
      continue;
    }

    if (entry.kind !== "derivative") {
      fail("invalid-parameter", "a manifest entry needs a known kind");
    }
    if (
      entry.derivativeKind !== "delivery-preview" &&
      entry.derivativeKind !== "watermarked-proof"
    ) {
      fail("invalid-parameter", "a derivative entry needs a known kind");
    }
    if (
      (galleryKind === "proof" && entry.derivativeKind !== "watermarked-proof") ||
      (galleryKind === "delivery" && entry.derivativeKind !== "delivery-preview")
    ) {
      fail("invalid-parameter", "the derivative kind does not match the gallery");
    }
    if (entry.derivativeKind === "watermarked-proof") {
      if (
        typeof entry.filename !== "string" ||
        entry.filename.trim().length === 0 ||
        Buffer.byteLength(entry.filename, "utf8") > 255 ||
        entry.filename === "." ||
        entry.filename === ".." ||
        /[/\\\x00-\x1f\x7f]/.test(entry.filename)
      ) {
        fail("invalid-parameter", "a proof needs a usable complete filename");
      }
      if (
        typeof entry.mediaId !== "string" ||
        entry.mediaId.trim().length === 0 ||
        Buffer.byteLength(entry.mediaId, "utf8") > 128 ||
        /[/\\\x00-\x1f\x7f]/.test(entry.mediaId) ||
        proofMediaIds.has(entry.mediaId)
      ) {
        fail("invalid-parameter", "a proof needs a unique stable media identity");
      }
      proofMediaIds.add(entry.mediaId);
    }
    if (!isPositiveInteger(entry.width) || !isPositiveInteger(entry.height)) {
      // Declared here rather than discovered later: without them the gallery
      // cannot reserve a frame at the photograph's own ratio, and the no-crop
      // rule is not expressible (`private-gallery-item.ts`).
      fail(
        "invalid-parameter",
        "a derivative entry needs positive intrinsic dimensions",
      );
    }
    const longestEdge = Math.max(entry.width, entry.height);
    if (longestEdge > limits.maxDerivativeLongestEdgePx) {
      fail(
        "oversized-item",
        `a private derivative is bounded at ${limits.maxDerivativeLongestEdgePx}px on its longest edge; this one declares ${longestEdge}px`,
      );
    }
    if (entry.nominalBytes > limits.maxDerivativeBytes) {
      fail(
        "oversized-item",
        `a private derivative is bounded at ${limits.maxDerivativeBytes} bytes; this one declares ${entry.nominalBytes}`,
      );
    }

    totalBytes += entry.nominalBytes;
    if (entry.derivativeKind === "watermarked-proof") {
      objects.push({
        objectKey: buildPrivateGalleryObjectKey({
          keyPrefix,
          galleryId,
          kind: "proof",
        }),
        objectKind: "proof",
        nominalBytes: entry.nominalBytes,
        width: entry.width,
        height: entry.height,
        filename: entry.filename,
        mediaId: entry.mediaId,
        placementId: randomBytes(16).toString("base64url"),
      });
    } else {
      objects.push({
        objectKey: buildPrivateGalleryObjectKey({
          keyPrefix,
          galleryId,
          kind: "preview",
        }),
        objectKind: "preview",
        nominalBytes: entry.nominalBytes,
        width: entry.width,
        height: entry.height,
      });
    }
  }

  if (totalBytes > limits.maxTotalBytes) {
    fail(
      "oversized-gallery",
      `a gallery is bounded at ${limits.maxTotalBytes} bytes in total; this manifest declares ${totalBytes}`,
    );
  }

  const openedAt = new Date(now.getTime());
  return {
    galleryKind,
    preparation: {
      galleryId,
      preparationId,
      objectKeys: objects.map((object) => object.objectKey),
      openedAt,
      deadline: new Date(
        openedAt.getTime() + limits.maxPreparationDays * DAY_MS,
      ),
    },
    objects,
    totalBytes,
  };
}

/**
 * Whether a preparation's window has closed.
 *
 * §7 makes publication after the deadline a refusal, and the retention worker
 * separately moves the gallery toward cleanup. The two are the same deadline
 * read by two callers, which is why it is a stored field on the preparation
 * rather than recomputed at each site: a publication check and a cleanup check
 * that disagreed by a millisecond would leave a gallery that can neither be
 * published nor collected.
 */
export function isPrivateGalleryPreparationExpired(
  preparation: Pick<PrivateGalleryUploadPreparation, "deadline">,
  now: Date,
): boolean {
  if (!isFiniteDate(now) || !isFiniteDate(preparation.deadline)) {
    fail("invalid-parameter", "now and the preparation deadline must be dates");
  }
  return now.getTime() >= preparation.deadline.getTime();
}

/**
 * Asserts a gallery may still be published from this preparation.
 *
 * Separate from the predicate so the refusal carries the ADR's reason: the
 * objects a late preparation wrote are already on the retention worker's
 * cleanup path, so publishing would hand a customer a gallery whose bytes are
 * scheduled for deletion.
 */
export function assertPrivateGalleryPreparationPublishable(
  preparation: Pick<PrivateGalleryUploadPreparation, "deadline">,
  now: Date,
): void {
  if (isPrivateGalleryPreparationExpired(preparation, now)) {
    fail(
      "preparation-expired",
      "the preparation window has closed; its objects are on the cleanup path and publishing would deliver a gallery already scheduled for deletion",
    );
  }
}
