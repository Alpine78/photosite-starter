/**
 * Server-assigned private object keys (ADR-0014 §5, §7, §8c).
 *
 * A key is never something a caller supplies — §5 makes that a hard rule, and
 * `private-gallery-delivery.ts` enforces it by having no field to supply one in.
 * This module is the other half: the only place a key is *created*, so every
 * object in the private bucket has a shape the retention worker, the
 * least-privilege IAM policies, and the backstop lifecycle rule all agree on.
 *
 * ## What a key may not contain
 *
 * Nothing about the customer, and nothing about the photograph. Not a name, not
 * a shoot title, not an original filename, not a capture date, not the gallery
 * handle from the shareable link. A key is not browser-facing, but it *is*
 * visible to anyone who can list the bucket — the photographer, the retention
 * worker, and the storage provider's own operational tooling — and a bucket
 * listing that reads `.../smith-wedding-2026/DSC_0431.jpg` has published the
 * customer relationship to every one of them. The same reasoning ADR-0002
 * applies to `archiveLocator` and provider internals applies here.
 *
 * ## Why the random part is not a counter
 *
 * Sibling keys must not be guessable from one key. The runtime credential holds
 * object-read on the whole prefix and deliberately **no `ListBucket`** (§8a), so
 * a key it can read is the only object it can name — unless keys are sequential,
 * in which case reading one implies reading the gallery. 128 bits of CSPRNG is
 * what makes "no list permission" mean something.
 *
 * ## Why the shape is fixed rather than free
 *
 * The retention worker enumerates by prefix, the backstop lifecycle rule matches
 * by prefix, and all three credentials are scoped to one. A key built any other
 * way would silently sit outside every one of those and be missed by cleanup
 * while remaining readable — the worst combination available.
 */

import { randomBytes } from "node:crypto";

/** Which object a key names. Not sensitive; it is a storage-side class. */
export type PrivateGalleryObjectKind = "preview" | "proof" | "zip";

/** 128 bits, per ADR-0014 §3's CSPRNG floor for a non-enumerable identifier. */
export const PRIVATE_GALLERY_OBJECT_TOKEN_BYTES = 16;

/**
 * Well under S3's own 1 024-byte key limit, and under it with room for the
 * longest prefix a deployment may configure.
 */
export const PRIVATE_GALLERY_MAX_OBJECT_KEY_LENGTH = 512;

/**
 * A single key segment: lowercase letters, digits, hyphen, underscore. No dot,
 * no slash, nothing that a path-walking tool, a lifecycle rule's prefix match,
 * or a URL parser could read as structure.
 */
const KEY_SEGMENT = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/**
 * The configured prefix: one or more `/`-joined segments, no leading, trailing,
 * or doubled separator. Deliberately the same rule `private-gallery-config.ts`
 * validates `PRIVATE_GALLERY_S3_KEY_PREFIX` against, restated here so a key can
 * never be built from a prefix that was not checked.
 */
const KEY_PREFIX = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/;

export class PrivateGalleryObjectKeyError extends Error {
  constructor(message: string) {
    super(`[private-gallery-object-key] ${message}`);
    this.name = "PrivateGalleryObjectKeyError";
  }
}

function fail(message: string): never {
  throw new PrivateGalleryObjectKeyError(message);
}

export type PrivateGalleryObjectKeyParams = {
  /** `PRIVATE_GALLERY_S3_KEY_PREFIX`, already validated by the config module. */
  readonly keyPrefix: string;
  /** The internal gallery id. Opaque, and validated as one segment here. */
  readonly galleryId: string;
  readonly kind: PrivateGalleryObjectKind;
};

/**
 * A fresh, non-enumerable key for one object.
 *
 * Shape: `<keyPrefix>/g/<galleryId>/<kind>/<128-bit token>`. The gallery segment
 * groups a gallery's objects so the retention worker's prefix-scoped
 * enumeration can verify a cleanup left nothing behind — the manifest says what
 * *should* be gone, and a prefix listing is how the worker checks it actually
 * is. The token is what makes a sibling unguessable.
 *
 * Every part is validated before it is joined, so a `galleryId` carrying a slash
 * or a dot cannot escape the prefix that every credential and lifecycle rule is
 * scoped to. That is not a theoretical concern: an id is opaque to this module,
 * and "opaque" is not the same as "safe to interpolate into a path".
 */
export function buildPrivateGalleryObjectKey(
  params: PrivateGalleryObjectKeyParams,
): string {
  const { kind } = params;
  if (kind !== "preview" && kind !== "proof" && kind !== "zip") {
    fail("the object kind is not one this boundary assigns keys for");
  }

  const token = randomBytes(PRIVATE_GALLERY_OBJECT_TOKEN_BYTES).toString(
    "base64url",
  );
  const key = `${privateGalleryObjectKeyPrefix(params)}${kind}/${token}`;

  if (key.length > PRIVATE_GALLERY_MAX_OBJECT_KEY_LENGTH) {
    fail(
      `the assembled key is ${key.length} characters, above this boundary's ${PRIVATE_GALLERY_MAX_OBJECT_KEY_LENGTH}-character bound`,
    );
  }
  return key;
}

/**
 * The prefix a gallery's own objects live under — what the retention worker
 * lists to verify a cleanup, and the only place its delete permission needs to
 * reach for one gallery.
 *
 * Trailing separator included on purpose: `…/g/gallery-1` would also prefix-match
 * `…/g/gallery-10`, and a cleanup that enumerated a neighbouring gallery's
 * objects would be a deletion bug rather than a listing one.
 *
 * Every part is validated before it is joined, so a `galleryId` carrying a slash
 * or a dot cannot escape the prefix that every credential and lifecycle rule is
 * scoped to. That is not a theoretical concern: an id is opaque to this module,
 * and "opaque" is not the same as "safe to interpolate into a path".
 */
export function privateGalleryObjectKeyPrefix(params: {
  readonly keyPrefix: string;
  readonly galleryId: string;
}): string {
  const { keyPrefix, galleryId } = params;

  if (typeof keyPrefix !== "string" || !KEY_PREFIX.test(keyPrefix)) {
    fail(
      "the configured key prefix is not one or more lowercase path segments with no leading, trailing, or doubled separator",
    );
  }
  if (typeof galleryId !== "string" || !KEY_SEGMENT.test(galleryId)) {
    fail(
      "the gallery id is not usable as a single opaque key segment; a value carrying a separator, a dot, or uppercase would place the object outside the prefix every credential and lifecycle rule is scoped to",
    );
  }
  return `${keyPrefix}/g/${galleryId}/`;
}

/**
 * Whether a stored key still belongs to the prefix this deployment is scoped to
 * — the read-time counterpart of building one.
 *
 * A row whose key sits outside the configured prefix cannot have been written by
 * this deployment's own CLI credential, and signing it would ask the runtime
 * credential for an object its policy does not cover. Checked before a mint
 * rather than trusted, because a key is data in a database that a migration, a
 * restore, or a reconfigured prefix could have left inconsistent.
 */
export function isPrivateGalleryObjectKeyInPrefix(
  objectKey: string,
  keyPrefix: string,
): boolean {
  if (typeof objectKey !== "string" || typeof keyPrefix !== "string") {
    return false;
  }
  if (!KEY_PREFIX.test(keyPrefix)) return false;
  if (
    objectKey.length === 0 ||
    objectKey.length > PRIVATE_GALLERY_MAX_OBJECT_KEY_LENGTH
  ) {
    return false;
  }
  // Segment-wise rather than a bare `startsWith`, so `photos-private/...` never
  // passes as being inside `photos`.
  if (!objectKey.startsWith(`${keyPrefix}/`)) return false;
  // No traversal, no empty segment, nothing a lifecycle prefix match would read
  // differently from this check.
  return objectKey
    .split("/")
    .every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}
