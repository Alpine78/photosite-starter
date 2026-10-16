/** Pure state machine shared by the server domain and owner-run retention tooling. */
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

