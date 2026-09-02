/**
 * The six-month access clock and the retention worker's decision rules
 * (ADR-0014 §7).
 *
 * Pure, and deliberately so. The worker itself is a scheduled `scripts/*.mts`
 * job the ADR names as its own action item, and it cannot be written until the
 * private store and object store exist — but *what it decides* is fixed now, in
 * a module with no IO, no clock of its own, and no store. That is the same
 * split `evaluatePrivateGalleryExchangeRate` already uses for the persistent
 * exchange counter: the policy is testable today and the adapter later has an
 * exact thing to match rather than a paragraph to interpret.
 *
 * ## Why the metadata store owns the clock
 *
 * A bucket lifecycle rule keys on object age, a date, a prefix, or a tag —
 * never on a gallery's publication-derived `accessExpiresAt`, and upload can
 * precede publication by up to the preparation window. An age rule therefore
 * *cannot* implement the access clock. It is a backstop for objects the worker
 * missed (a crashed job, an orphaned upload), and
 * {@link PRIVATE_GALLERY_BACKSTOP_OBJECT_AGE_DAYS} is set beyond every
 * legitimate object lifetime so it can only ever hit a genuine orphan.
 *
 * ## Access ends before objects do
 *
 * At `accessExpiresAt` the gallery leaves `published`, and from that instant
 * every authorization check refuses regardless of what still exists in the
 * object store — `assertPrivateGallerySessionAuthorizesGallery` already refuses
 * any state that is not customer-visible. Deletion follows separately and may
 * take up to the grace window. The two are not the same event and this module
 * keeps them apart.
 *
 * Every window here is an **ADR-fixed maximum**: a deployment may lower one,
 * and must not raise it. {@link assertPrivateGalleryRetentionWindows} is what
 * makes that rule executable rather than advisory.
 */

import {
  canTransitionPrivateGalleryState,
  type PrivateGalleryState,
} from "@/lib/private-gallery";

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// The ADR-fixed windows
// ---------------------------------------------------------------------------

/** Calendar months of customer access, counted from the publication instant. */
export const PRIVATE_GALLERY_ACCESS_MONTHS = 6;

/** First upload → publication. Publication after this is refused (§7). */
export const PRIVATE_GALLERY_MAX_PREPARATION_DAYS = 30;

/** A revoked gallery that is never replaced enters cleanup after this. */
export const PRIVATE_GALLERY_MAX_SUSPENSION_DAYS = 30;

/**
 * Verified deletion must complete within this of the **cleanup trigger** — the
 * earlier of `accessExpiresAt`, an administrator delete, or an abandonment
 * deadline. Counted from the trigger and not from publication, so an early
 * delete is not silently handed the rest of the original access window.
 */
export const PRIVATE_GALLERY_DELETION_GRACE_DAYS = 30;

/**
 * The backstop bucket rule's object age. Derived, not chosen: the preparation
 * maximum, plus the longest six-calendar-month span, plus the suspension
 * window, plus the deletion grace, plus one day of headroom. A test pins the
 * arithmetic to the parts, so lowering a window without revisiting this is a
 * failure rather than a silent weakening.
 */
export const PRIVATE_GALLERY_BACKSTOP_OBJECT_AGE_DAYS = 275;

/** The same backstop policy's two other ages (§7). */
export const PRIVATE_GALLERY_BACKSTOP_NONCURRENT_VERSION_DAYS = 30;
export const PRIVATE_GALLERY_BACKSTOP_MULTIPART_ABORT_DAYS = 7;

/** The scheduled worker must run at least this often (§7). */
export const PRIVATE_GALLERY_MAX_WORKER_INTERVAL_HOURS = 24;

/** The longest a six-calendar-month span can be: 1 Aug → 1 Feb. */
export const PRIVATE_GALLERY_LONGEST_ACCESS_SPAN_DAYS = 184;

export type PrivateGalleryRetentionWindows = {
  readonly maxPreparationDays: number;
  readonly maxSuspensionDays: number;
  readonly deletionGraceDays: number;
};

export const PRIVATE_GALLERY_RETENTION_WINDOWS: PrivateGalleryRetentionWindows =
  Object.freeze({
    maxPreparationDays: PRIVATE_GALLERY_MAX_PREPARATION_DAYS,
    maxSuspensionDays: PRIVATE_GALLERY_MAX_SUSPENSION_DAYS,
    deletionGraceDays: PRIVATE_GALLERY_DELETION_GRACE_DAYS,
  });

export class PrivateGalleryRetentionError extends Error {
  constructor(message: string) {
    super(`[private-gallery-retention] ${message}`);
    this.name = "PrivateGalleryRetentionError";
  }
}

function fail(message: string): never {
  throw new PrivateGalleryRetentionError(message);
}

function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * Refuses a deployment that raises any window above the ADR maximum.
 *
 * "A deployment may lower them, but must not raise them" is the kind of rule
 * that stays true only while someone remembers it, so it is checked rather than
 * written down. A raised window would extend how long private objects live —
 * exactly the property §7 exists to bound.
 */
export function assertPrivateGalleryRetentionWindows(
  windows: PrivateGalleryRetentionWindows,
): void {
  const bounds: ReadonlyArray<
    [keyof PrivateGalleryRetentionWindows, number]
  > = [
    ["maxPreparationDays", PRIVATE_GALLERY_MAX_PREPARATION_DAYS],
    ["maxSuspensionDays", PRIVATE_GALLERY_MAX_SUSPENSION_DAYS],
    ["deletionGraceDays", PRIVATE_GALLERY_DELETION_GRACE_DAYS],
  ];

  for (const [name, maximum] of bounds) {
    const value = windows[name];
    if (!Number.isFinite(value) || value <= 0) {
      fail(`${name} must be a positive number of days`);
    }
    if (value > maximum) {
      fail(
        `${name} is ${value} days, above the ADR-0014 §7 maximum of ${maximum}; a deployment may lower a retention window but never raise one`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// The access clock
// ---------------------------------------------------------------------------

/**
 * `accessExpiresAt`: the publication instant with six added to the **UTC**
 * month, clamped to the target month's last day when it has no matching one,
 * with the time of day preserved (§7).
 *
 * Calendar months rather than a fixed number of days, because "six months" is
 * what a photographer tells a customer, and 180 days is a different promise in
 * a leap year than out of one. The clamp is what makes 31 August answerable at
 * all — there is no 31 February. All arithmetic is UTC, so no deployment's
 * local time zone or daylight-saving transition can move a customer's deadline.
 *
 * Computed once, when the gallery first enters `published`, and immutable after
 * that: a proof-gallery reopen does not shift it, and no client clock is
 * consulted. This function is the only place that value is derived — the
 * publication action (AB#145) calls it, and this story enforces its effect.
 */
export function computePrivateGalleryAccessExpiry(publishedAt: Date): Date {
  if (!isFiniteDate(publishedAt)) {
    fail("publishedAt must be a valid date");
  }

  const year = publishedAt.getUTCFullYear();
  const month = publishedAt.getUTCMonth() + PRIVATE_GALLERY_ACCESS_MONTHS;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;

  // Day 0 of the following month is the last day of the target month, which is
  // also how February's length answers for itself in a leap year.
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();

  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(publishedAt.getUTCDate(), lastDayOfTargetMonth),
      publishedAt.getUTCHours(),
      publishedAt.getUTCMinutes(),
      publishedAt.getUTCSeconds(),
      publishedAt.getUTCMilliseconds(),
    ),
  );
}

/**
 * When verified deletion must be complete by, counted from the cleanup trigger.
 * The caller supplies the trigger; this only adds the grace window, so an
 * administrator delete on day one gets the same 30 days a natural expiry does
 * rather than inheriting the remainder of the access window.
 */
export function computePrivateGalleryDeletionDeadline(
  cleanupTriggeredAt: Date,
  windows: PrivateGalleryRetentionWindows = PRIVATE_GALLERY_RETENTION_WINDOWS,
): Date {
  if (!isFiniteDate(cleanupTriggeredAt)) {
    fail("cleanupTriggeredAt must be a valid date");
  }
  assertPrivateGalleryRetentionWindows(windows);
  return new Date(
    cleanupTriggeredAt.getTime() + windows.deletionGraceDays * DAY_MS,
  );
}

// ---------------------------------------------------------------------------
// The scheduled decision
// ---------------------------------------------------------------------------

/**
 * The facts one scheduled run needs about one gallery. A record rather than a
 * `PrivateGallery`, for the reason `PrivateGalleryExchangeRateCounter` is also
 * its own type: these are the retention columns, and how a store lays them out
 * is the adapter slice's decision, not something to guess at here by widening
 * the domain model.
 */
export type PrivateGalleryRetentionInput = {
  readonly state: PrivateGalleryState;
  /** When `preparing` began — the first upload preparation's commit. */
  readonly preparationStartedAt?: Date;
  /** Immutable, set on first publication. Absent before that. */
  readonly accessExpiresAt?: Date;
  /** When the gallery entered `access-suspended` (a revoke). */
  readonly accessSuspendedAt?: Date;
  /** When cleanup was triggered — set as the gallery enters `expiring`. */
  readonly cleanupTriggeredAt?: Date;
  /**
   * Whether a human has acknowledged repeated deletion failure. A `deletion-failed`
   * gallery retries on every run until someone does; acknowledgement parks it
   * for manual intervention instead of retrying forever (§7).
   */
  readonly deletionFailureAcknowledged?: boolean;
};

export type PrivateGalleryRetentionReason =
  /** `preparing`/`ready` outlived the preparation maximum. */
  | "preparation-abandoned"
  /** `published` reached `accessExpiresAt`. */
  | "access-expired"
  /** `access-suspended` was never replaced within its window. */
  | "suspension-abandoned"
  /** `expiring` — objects may now be deleted. */
  | "cleanup-due"
  /** `deletion-failed` retries on the next scheduled run. */
  | "deletion-retry";

export type PrivateGalleryRetentionDecision =
  | { readonly due: false }
  | {
      readonly due: true;
      readonly to: PrivateGalleryState;
      readonly reason: PrivateGalleryRetentionReason;
      /**
       * True when this run is *late* — the deletion deadline has already
       * passed. The transition is still the right one; this is the signal the
       * worker reports rather than a reason to skip the work.
       */
      readonly overdue: boolean;
    };

/**
 * What one scheduled run should do with one gallery, or nothing.
 *
 * **A missing timestamp never means "not yet".** A `published` gallery with no
 * `accessExpiresAt`, or a `preparing` one with no `preparationStartedAt`, is a
 * data-integrity defect, and treating it as "no deadline reached" would let a
 * corrupt row keep private objects alive indefinitely — the exact failure the
 * bounded-lifetime rule exists to prevent. Those throw.
 *
 * `deleting` returns `due: false` on purpose: only the worker knows whether the
 * objects are actually gone, and that is an object-store read, not a decision.
 * The move to `deleted` follows verified deletion and belongs to the worker.
 */
export function evaluatePrivateGalleryRetention(
  input: PrivateGalleryRetentionInput,
  now: Date,
  windows: PrivateGalleryRetentionWindows = PRIVATE_GALLERY_RETENTION_WINDOWS,
): PrivateGalleryRetentionDecision {
  if (!isFiniteDate(now)) {
    fail("now must be a valid date");
  }
  assertPrivateGalleryRetentionWindows(windows);

  const overdue = isPrivateGalleryDeletionOverdue(
    input.cleanupTriggeredAt,
    now,
    windows,
  );

  const due = (
    to: PrivateGalleryState,
    reason: PrivateGalleryRetentionReason,
  ): PrivateGalleryRetentionDecision => {
    // The transition map is the authority on what is legal; a decision this
    // module invented that the machine forbids is a bug in this module.
    if (!canTransitionPrivateGalleryState(input.state, to)) {
      fail(`${input.state} → ${to} is not an allowed transition`);
    }
    return { due: true, to, reason, overdue };
  };

  switch (input.state) {
    case "draft":
      // Holds no objects, so an abandoned draft is a plain row delete rather
      // than the object-retention lifecycle. §7 lists `expiring` as reachable
      // only from the object-bearing states.
      return { due: false };

    case "preparing":
    case "ready": {
      const startedAt = requireDate(
        input.preparationStartedAt,
        input.state,
        "preparationStartedAt",
      );
      const deadline = startedAt.getTime() + windows.maxPreparationDays * DAY_MS;
      return now.getTime() >= deadline
        ? due("expiring", "preparation-abandoned")
        : { due: false };
    }

    case "published": {
      const expiresAt = requireDate(
        input.accessExpiresAt,
        input.state,
        "accessExpiresAt",
      );
      return now.getTime() >= expiresAt.getTime()
        ? due("expiring", "access-expired")
        : { due: false };
    }

    case "access-suspended": {
      const suspendedAt = requireDate(
        input.accessSuspendedAt,
        input.state,
        "accessSuspendedAt",
      );
      const deadline = suspendedAt.getTime() + windows.maxSuspensionDays * DAY_MS;
      return now.getTime() >= deadline
        ? due("expiring", "suspension-abandoned")
        : { due: false };
    }

    case "expiring":
      // Access has already stopped; objects may now go. No waiting period —
      // the grace window is a deadline for finishing, not a delay before
      // starting.
      return due("deleting", "cleanup-due");

    case "deletion-failed":
      return input.deletionFailureAcknowledged === true
        ? { due: false }
        : due("deleting", "deletion-retry");

    case "deleting":
    case "deleted":
      return { due: false };
  }
}

function requireDate(
  value: Date | undefined,
  state: PrivateGalleryState,
  field: string,
): Date {
  if (!isFiniteDate(value)) {
    fail(
      `a gallery in ${state} must carry a valid ${field}; a missing one is a data-integrity defect, not an unreached deadline`,
    );
  }
  return value;
}

/**
 * Whether verified deletion is already late. `false` when cleanup has not been
 * triggered — there is no deadline to miss yet.
 */
export function isPrivateGalleryDeletionOverdue(
  cleanupTriggeredAt: Date | undefined,
  now: Date,
  windows: PrivateGalleryRetentionWindows = PRIVATE_GALLERY_RETENTION_WINDOWS,
): boolean {
  if (cleanupTriggeredAt === undefined) return false;
  return (
    now.getTime() >=
    computePrivateGalleryDeletionDeadline(cleanupTriggeredAt, windows).getTime()
  );
}

/**
 * Whether a session row may be reaped. Every scheduled run reaps expired
 * sessions in bounded, expiry-indexed batches **independently of whether their
 * gallery has entered deletion** (§7) — a session outlives nothing, and waiting
 * for the gallery would leave rows behind for galleries that never expire.
 */
export function isPrivateGallerySessionReapable(
  session: { readonly expiresAt: Date },
  now: Date,
): boolean {
  if (!isFiniteDate(now) || !isFiniteDate(session.expiresAt)) {
    fail("now and expiresAt must be valid dates");
  }
  return now.getTime() >= session.expiresAt.getTime();
}
