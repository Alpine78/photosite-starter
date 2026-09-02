/**
 * When a private gallery may leave `preparing` for `ready` (ADR-0014 §8c,
 * "Readiness is per gallery kind").
 *
 * The two kinds do not differ only in what they show. A **delivery** gallery is
 * not ready until its web derivatives *and* a verified, durably-present, active
 * immutable ZIP object exist — publishing one without the ZIP would hand a
 * customer a gallery whose entire promise, "download all delivered files as one
 * package", is missing, and they would have no way to tell that from a gallery
 * that simply had not finished loading. A **proof** gallery has no ZIP at all.
 *
 * That is why `PrivateGalleryKind` is a stored discriminant rather than an
 * inference from `activeZipObjectKey`: a delivery gallery *before* its ZIP is
 * verified and a proof gallery that will never have one are indistinguishable
 * by that field, and guessing would publish the first as though it were the
 * second.
 *
 * **Proof readiness is AB#130's, and is refused here rather than guessed.**
 * §8c gives it three conditions this story owns none of — watermarked
 * derivatives uploaded, the pricing snapshot frozen, and every proof assigned
 * its permanent `001`-based reference. Returning "ready" for a proof gallery on
 * the strength of the one condition this module can see would be worse than
 * refusing: it would look like a decision.
 */

import type { PrivateGallery } from "@/lib/private-gallery";
import type { PrivateGalleryVerifiedObject } from "@/lib/private-gallery-upload-completion";

export type PrivateGalleryReadinessBlocker =
  /** No web derivative is present, so there is nothing to view. */
  | "no-derivatives"
  /** A delivery gallery with no verified ZIP object among its verified set. */
  | "no-verified-zip"
  /** The gallery's `activeZipObjectKey` does not name a verified object. */
  | "zip-pointer-unverified"
  /** The gallery is not in a state readiness is even a question for. */
  | "wrong-state"
  /** Proof readiness belongs to AB#130 and is not decided here. */
  | "proof-readiness-unimplemented";

export type PrivateGalleryReadiness =
  | { readonly ready: true }
  | { readonly ready: false; readonly blockers: readonly PrivateGalleryReadinessBlocker[] };

/**
 * Whether this gallery's verified objects satisfy its kind's readiness rule.
 *
 * `verifiedObjects` is the set the completion step verified as durably present
 * — not what a plan intended. Readiness is a statement about the object store,
 * so it is derived from evidence rather than from intent.
 *
 * Every blocker is reported, not just the first: an administrator fixing one
 * missing thing at a time, only to be told about the next, is how a publication
 * takes four attempts instead of one.
 */
export function evaluatePrivateGalleryReadiness(params: {
  readonly gallery: PrivateGallery;
  readonly verifiedObjects: readonly PrivateGalleryVerifiedObject[];
}): PrivateGalleryReadiness {
  const { gallery, verifiedObjects } = params;
  const blockers: PrivateGalleryReadinessBlocker[] = [];

  // Readiness is only a question on the way out of preparation. Asking it of a
  // published or deleting gallery is a caller mistake, and answering "ready"
  // would invite a second publication of something already live.
  if (gallery.state !== "preparing" && gallery.state !== "ready") {
    blockers.push("wrong-state");
  }

  const hasDerivative = verifiedObjects.some(
    (object) => object.objectKind === "preview" || object.objectKind === "proof",
  );
  if (!hasDerivative) blockers.push("no-derivatives");

  if (gallery.kind === "proof") {
    // The one condition this module can see is met, and two it cannot are not.
    blockers.push("proof-readiness-unimplemented");
    return { ready: false, blockers };
  }

  const verifiedZip = verifiedObjects.find(
    (object) => object.objectKind === "zip",
  );
  if (verifiedZip === undefined) {
    blockers.push("no-verified-zip");
  } else if (gallery.activeZipObjectKey !== verifiedZip.objectKey) {
    // The pointer is what a signed URL is minted against (§8c), so a pointer
    // naming anything other than the object just verified would publish a
    // download of bytes nothing vouched for — including the case where the
    // pointer is still absent because the swap has not been committed.
    blockers.push("zip-pointer-unverified");
  }

  return blockers.length === 0
    ? { ready: true }
    : { ready: false, blockers };
}
