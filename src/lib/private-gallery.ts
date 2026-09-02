/**
 * The private client-gallery domain model (ADR-0014).
 *
 * This is the shape the private metadata store keeps and the private routes,
 * the owner-run upload CLI, the publication state machine, and the retention
 * worker all read — every one of which is a **later slice of AB#29**. Slice 1
 * ships only the parts of the model that ADR-0014 already fixes and that can be
 * tested with no store and no live infrastructure: the gallery **state
 * machine** (§5, §7) and the record types the ADR names.
 *
 * Scope is the **delivery gallery** (AB#29). The proof-selection records — the
 * versioned confirmation snapshot, the pricing snapshot, the `001`-based
 * reference — are AB#130's and are deliberately absent here; AB#130 extends
 * this model on the same boundary.
 *
 * The module carries the `server-only` marker and sits behind the ESLint import
 * boundary (`eslint.config.mjs`) with `private-gallery-config.ts`: a route or
 * component that reached for `PrivateGallery` would be about to render private
 * customer data in a tree that must not know its shape. This is the same
 * mechanism — and the same known limits (it matches `@/lib/...` alias imports,
 * not a relative path or an indirect re-export) — that ADR-0006 uses for the
 * Sanity boundary.
 */

import "server-only";

/**
 * Every state a private gallery can be in (ADR-0014 §5, §7). The array is the
 * canonical runtime list; {@link PrivateGalleryState} is derived from it so the
 * two cannot drift, and a store row or an API payload can be validated against
 * it — a bare TypeScript union could not be.
 */
export const PRIVATE_GALLERY_STATES = [
  /** Created, linked to a customer/job. Holds no objects. */
  "draft",
  /** An upload preparation is open; the owner CLI may be writing objects. */
  "preparing",
  /** Objects uploaded and server-verified; not yet visible to the customer. */
  "ready",
  /** Live: the customer capability authorizes viewing and the ZIP download. */
  "published",
  /** Revoked by the administrator; a replace can return it to `published`. */
  "access-suspended",
  /** Access has ended (expiry or delete); every authorization check refuses. */
  "expiring",
  /** The retention worker is deleting this gallery's objects. */
  "deleting",
  /** Objects verified gone. Terminal — never returns to `published`. */
  "deleted",
  /** A deletion run failed partway; the next scheduled worker run retries. */
  "deletion-failed",
] as const;

export type PrivateGalleryState = (typeof PRIVATE_GALLERY_STATES)[number];

export function isPrivateGalleryState(
  value: unknown,
): value is PrivateGalleryState {
  return (
    typeof value === "string" &&
    (PRIVATE_GALLERY_STATES as readonly string[]).includes(value)
  );
}

/**
 * The only state in which a customer request is served (ADR-0014 §5). Every
 * other state — including `access-suspended` and every retention state — refuses
 * every customer request immediately.
 */
export const PRIVATE_GALLERY_CUSTOMER_VISIBLE_STATES = ["published"] as const;

export function isPrivateGalleryCustomerVisible(
  state: PrivateGalleryState,
): boolean {
  return (
    PRIVATE_GALLERY_CUSTOMER_VISIBLE_STATES as readonly PrivateGalleryState[]
  ).includes(state);
}

/**
 * States that hold objects, and from which an administrator delete is valid
 * (ADR-0014 §7). `draft` holds no objects; the retention states are already on
 * the deletion path.
 */
export const PRIVATE_GALLERY_OBJECT_BEARING_STATES = [
  "preparing",
  "ready",
  "published",
  "access-suspended",
] as const;

/** The terminal state. A gallery here never becomes available again (§7). */
export const PRIVATE_GALLERY_TERMINAL_STATE = "deleted" satisfies PrivateGalleryState;

/**
 * The allowed state transitions (ADR-0014 §5, §7). A delete from any
 * object-bearing state and the automatic-expiry edges both land on `expiring`;
 * the retention worker then drives `expiring → deleting → deleted`, with
 * `deleting → deletion-failed → deleting` as the retry loop. There is no edge
 * back to `published` from `deleting` or later — the §7 deletion guard.
 *
 * `draft` reaches only `preparing`. It holds no objects, so removing an
 * abandoned draft is a plain row delete, not the object-retention lifecycle —
 * the ADR lists `expiring` as reachable only from `preparing`, `ready`,
 * `published`, and `access-suspended`.
 */
export const PRIVATE_GALLERY_STATE_TRANSITIONS: Readonly<
  Record<PrivateGalleryState, readonly PrivateGalleryState[]>
> = {
  draft: ["preparing"],
  preparing: ["ready", "expiring"],
  ready: ["published", "expiring"],
  published: ["access-suspended", "expiring"],
  "access-suspended": ["published", "expiring"],
  expiring: ["deleting"],
  deleting: ["deleted", "deletion-failed"],
  deleted: [],
  "deletion-failed": ["deleting"],
};

export function canTransitionPrivateGalleryState(
  from: PrivateGalleryState,
  to: PrivateGalleryState,
): boolean {
  return PRIVATE_GALLERY_STATE_TRANSITIONS[from].includes(to);
}

/** Which private derivative a placement's object is (ADR-0014 §5). */
export type PrivateGalleryDerivativeKind =
  | "delivery-preview"
  | "watermarked-proof";

/**
 * One private gallery.
 *
 * Two identities, deliberately separate (ADR-0014 §3): `galleryId` is a stable
 * internal identity — the foreign-key target every child record points at, and
 * a component of the capability envelope's associated data. `galleryHandle` is
 * the opaque, non-enumerable random string carried in the shareable link and
 * the only value a capability lookup is ever keyed by; it is not secret but it
 * is not the primary key either. The capability secret itself is never stored
 * here (see {@link PrivateGalleryCapability}).
 *
 * `accessExpiresAt` is computed once, when the gallery first enters
 * `published`, and is then immutable (§7). `activeZipObjectKey` is the single
 * atomically-swapped pointer to the current immutable delivery ZIP (§8c) —
 * absent for a proof gallery and for a delivery gallery before its ZIP is
 * verified.
 */
/**
 * Which product a gallery is (ADR-0014 §8c). The two differ in what makes them
 * *ready*, not merely in what they display: a delivery gallery is not ready
 * until a verified ZIP exists, and a proof gallery has no ZIP at all.
 *
 * A discriminant rather than an inference from `activeZipObjectKey`, because a
 * delivery gallery before its ZIP is verified and a proof gallery that will
 * never have one look identical by that field — and treating the first as the
 * second would publish a delivery gallery with nothing to download.
 */
export type PrivateGalleryKind = "delivery" | "proof";

export type PrivateGallery = {
  readonly galleryId: string;
  readonly galleryHandle: string;
  readonly kind: PrivateGalleryKind;
  readonly state: PrivateGalleryState;
  /**
   * Bumped by every revoke, replace, and delete. A session whose generation no
   * longer matches is refused (§5).
   */
  readonly capabilityGeneration: number;
  readonly createdAt: Date;
  /** First transition into `published`; absent until then. */
  readonly publishedAt?: Date;
  /** Immutable once set; `min` clock for every signed-URL TTL (§5, §7). */
  readonly accessExpiresAt?: Date;
  /**
   * The one current delivery ZIP object key, swapped atomically on every
   * regeneration (§8c). Which {@link PrivateGalleryZipVersion} is current is
   * answered only by this pointer, never a flag on the version.
   */
  readonly activeZipObjectKey?: string;
};

/**
 * The stored, **recoverable** capability for one generation (ADR-0014
 * "Capability storage"). The secret is held as an AES-256-GCM envelope so
 * "resend access link" and "copy access link" can reconstruct the exact link;
 * `keyId` names the keyring key it is sealed under, so decryption never scans
 * the keyring (the scan is only for retiring an old key). The envelope's
 * associated data is the tuple `["private-gallery-capability-v1", galleryId,
 * handle, generation]`, which is why this record carries `galleryId` and the
 * generation. The plaintext capability is never stored.
 */
export type PrivateGalleryCapability = {
  readonly galleryId: string;
  readonly capabilityGeneration: number;
  readonly keyId: string;
  readonly envelope: string;
  readonly createdAt: Date;
};

/**
 * A server-side access session (ADR-0014 §3). The cookie carries the raw
 * CSPRNG session identifier; the store keeps **only its hash** and a lookup
 * hashes the cookie value and matches — the session id never needs
 * reconstructing, unlike the capability, so the plaintext bearer is never
 * persisted. The record is bound to its gallery and to the capability
 * generation it was minted against, and is refused once the gallery's
 * generation moves past it (§5). `expiresAt` is the absolute lifetime,
 * `min(sessionTTL ≤ 7 days, accessExpiresAt − createdAt)`, never renewed on
 * activity.
 */
export type PrivateGallerySession = {
  /** Hash of the session cookie's value — never the raw bearer identifier. */
  readonly sessionIdHash: string;
  /** Foreign key to {@link PrivateGallery.galleryId}. */
  readonly galleryId: string;
  readonly capabilityGeneration: number;
  readonly createdAt: Date;
  readonly expiresAt: Date;
};

/**
 * One placement in a private gallery. `placementId` is server-owned and opaque;
 * `objectKey` is opaque and encodes no customer name, filename, job number, or
 * sequential id (ADR-0014 §2). `nominalBytes` is what a signed-URL mint charges
 * against the per-gallery access budget (§8e).
 */
export type PrivateGalleryPlacement = {
  /** Foreign key to {@link PrivateGallery.galleryId}. */
  readonly galleryId: string;
  readonly placementId: string;
  readonly objectKey: string;
  readonly order: number;
  readonly derivativeKind: PrivateGalleryDerivativeKind;
  readonly nominalBytes: number;
  /**
   * The derivative's **true intrinsic pixels** — not a display size, not a
   * requested one.
   *
   * Required, because `AGENTS.md`'s no-crop rule ("gallery, preview, and hero
   * images must always show their original aspect ratio and full frame") cannot
   * be expressed at all without them: a layout that does not know a
   * photograph's shape can only guess it, and guessing is cropping. They are
   * also what reserves the right box before any byte arrives, so a gallery does
   * not reflow as it loads. ADR-0005 makes this the rule for a public
   * rendition; ADR-0014 §5 says it applies to a private preview "exactly as to
   * a public one".
   */
  readonly width: number;
  readonly height: number;
  /**
   * Alternative text, when the photographer authored some. Optional because a
   * delivery gallery is the customer's own shoot — they know what is in it —
   * and an invented description would be worse than none.
   */
  readonly alt?: string;
};

/**
 * An immutable ZIP object for a delivery gallery (ADR-0014 §8c). A regeneration
 * writes a new version under a new key; the server then atomically swaps
 * {@link PrivateGallery.activeZipObjectKey} to it in one transaction. This
 * record never says whether it is the current one — that is the pointer's job,
 * so two versions can never disagree about it. The predecessor is retained past
 * the longest signed TTL so an in-flight `Range` resume does not break.
 */
export type PrivateGalleryZipVersion = {
  /** Foreign key to {@link PrivateGallery.galleryId}. */
  readonly galleryId: string;
  readonly objectKey: string;
  readonly nominalBytes: number;
  readonly createdAt: Date;
};

/**
 * A bounded upload plan, committed in one Postgres transaction before any
 * object write, so the retention worker always has an enclosing preparation to
 * reconcile (ADR-0014 §8c, §7).
 */
export type PrivateGalleryUploadPreparation = {
  /** Foreign key to {@link PrivateGallery.galleryId}. */
  readonly galleryId: string;
  readonly preparationId: string;
  readonly objectKeys: readonly string[];
  readonly openedAt: Date;
  /** The 30-day preparation maximum; publication after it is refused (§7). */
  readonly deadline: Date;
};

/** Kind of a queued outbox message. AB#130 adds `proof-confirmation`. */
export type PrivateGalleryOutboxKind = "delivery-notification";

export type PrivateGalleryOutboxState = "pending" | "sent" | "failed";

/**
 * One row of the durable, idempotent notification/worker outbox (ADR-0014
 * §8d). `lastError` is a redacted error class only — never a recipient, a
 * gallery reference, or message content (§6).
 */
export type PrivateGalleryOutboxRecord = {
  /** Foreign key to {@link PrivateGallery.galleryId}. */
  readonly galleryId: string;
  readonly outboxId: string;
  readonly kind: PrivateGalleryOutboxKind;
  readonly idempotencyKey: string;
  readonly state: PrivateGalleryOutboxState;
  readonly attempts: number;
  readonly lastError?: string;
  readonly createdAt: Date;
};
