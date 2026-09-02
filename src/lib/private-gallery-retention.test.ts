import { describe, expect, it } from "vitest";

import { PRIVATE_GALLERY_STATES } from "@/lib/private-gallery";
import {
  assertPrivateGalleryRetentionWindows,
  computePrivateGalleryAccessExpiry,
  computePrivateGalleryDeletionDeadline,
  evaluatePrivateGalleryRetention,
  isPrivateGalleryDeletionOverdue,
  isPrivateGallerySessionReapable,
  PRIVATE_GALLERY_BACKSTOP_OBJECT_AGE_DAYS,
  PRIVATE_GALLERY_DELETION_GRACE_DAYS,
  PRIVATE_GALLERY_LONGEST_ACCESS_SPAN_DAYS,
  PRIVATE_GALLERY_MAX_PREPARATION_DAYS,
  PRIVATE_GALLERY_MAX_SUSPENSION_DAYS,
  PRIVATE_GALLERY_RETENTION_WINDOWS,
  PrivateGalleryRetentionError,
  type PrivateGalleryRetentionInput,
} from "@/lib/private-gallery-retention";

const DAY = 24 * 60 * 60 * 1000;

describe("computePrivateGalleryAccessExpiry", () => {
  it.each([
    // ADR-0014 §7's own worked examples, as golden vectors.
    ["2026-08-31T12:00:00.000Z", "2027-02-28T12:00:00.000Z"],
    ["2026-08-15T09:00:00.000Z", "2027-02-15T09:00:00.000Z"],
    ["2026-12-31T00:00:00.000Z", "2027-06-30T00:00:00.000Z"],
  ])("maps %s to %s", (publishedAt, expected) => {
    expect(
      computePrivateGalleryAccessExpiry(new Date(publishedAt)).toISOString(),
    ).toBe(expected);
  });

  it("keeps 29 February when the target month has one", () => {
    // The clamp exists for months that are too short, not to round every date
    // down: 2028 is a leap year, so this day survives.
    expect(
      computePrivateGalleryAccessExpiry(
        new Date("2027-08-29T06:30:00.000Z"),
      ).toISOString(),
    ).toBe("2028-02-29T06:30:00.000Z");
  });

  it("clamps into a non-leap February", () => {
    expect(
      computePrivateGalleryAccessExpiry(
        new Date("2026-08-29T06:30:00.000Z"),
      ).toISOString(),
    ).toBe("2027-02-28T06:30:00.000Z");
  });

  it("crosses the year boundary", () => {
    expect(
      computePrivateGalleryAccessExpiry(
        new Date("2026-10-05T23:59:59.999Z"),
      ).toISOString(),
    ).toBe("2027-04-05T23:59:59.999Z");
  });

  it("preserves the time of day to the millisecond", () => {
    const published = new Date("2026-03-14T01:59:26.535Z");

    const expiry = computePrivateGalleryAccessExpiry(published);

    expect(expiry.getUTCHours()).toBe(published.getUTCHours());
    expect(expiry.getUTCMinutes()).toBe(published.getUTCMinutes());
    expect(expiry.getUTCSeconds()).toBe(published.getUTCSeconds());
    expect(expiry.getUTCMilliseconds()).toBe(published.getUTCMilliseconds());
  });

  it("is always in the future and never beyond the longest span", () => {
    // Walks every publication day of a leap-year cycle. The upper bound is what
    // the backstop object age is derived from, so a change to the calendar rule
    // that lengthened a span would fail here rather than silently outliving the
    // bucket rule meant to catch its orphans.
    for (let day = 0; day < 366 * 4; day += 1) {
      const published = new Date(Date.UTC(2026, 0, 1) + day * DAY);
      const spanDays =
        (computePrivateGalleryAccessExpiry(published).getTime() -
          published.getTime()) /
        DAY;

      expect(spanDays).toBeGreaterThan(0);
      expect(spanDays).toBeLessThanOrEqual(
        PRIVATE_GALLERY_LONGEST_ACCESS_SPAN_DAYS,
      );
    }
  });

  it("reaches the longest span exactly once a year", () => {
    // 1 August → 1 February is the 184-day case the backstop arithmetic uses.
    const published = new Date("2026-08-01T00:00:00.000Z");
    const spanDays =
      (computePrivateGalleryAccessExpiry(published).getTime() -
        published.getTime()) /
      DAY;

    expect(spanDays).toBe(PRIVATE_GALLERY_LONGEST_ACCESS_SPAN_DAYS);
  });

  it("refuses an unusable publication instant", () => {
    expect(() => computePrivateGalleryAccessExpiry(new Date(NaN))).toThrow(
      PrivateGalleryRetentionError,
    );
  });
});

describe("the backstop object age", () => {
  it("is derived from the windows it is meant to outlive", () => {
    // ADR-0014 §7 derives 275 rather than picking it: preparation + the longest
    // access span + suspension + deletion grace, plus a day of headroom. Pinned
    // to the parts so lowering a window without revisiting the rule fails here.
    expect(PRIVATE_GALLERY_BACKSTOP_OBJECT_AGE_DAYS).toBe(
      PRIVATE_GALLERY_MAX_PREPARATION_DAYS +
        PRIVATE_GALLERY_LONGEST_ACCESS_SPAN_DAYS +
        PRIVATE_GALLERY_MAX_SUSPENSION_DAYS +
        PRIVATE_GALLERY_DELETION_GRACE_DAYS +
        1,
    );
  });
});

describe("assertPrivateGalleryRetentionWindows", () => {
  it("accepts the ADR maxima and anything lower", () => {
    expect(() =>
      assertPrivateGalleryRetentionWindows(PRIVATE_GALLERY_RETENTION_WINDOWS),
    ).not.toThrow();
    expect(() =>
      assertPrivateGalleryRetentionWindows({
        maxPreparationDays: 7,
        maxSuspensionDays: 1,
        deletionGraceDays: 14,
      }),
    ).not.toThrow();
  });

  it.each([
    ["maxPreparationDays", { maxPreparationDays: 31 }],
    ["maxSuspensionDays", { maxSuspensionDays: 45 }],
    ["deletionGraceDays", { deletionGraceDays: 60 }],
  ])("refuses a raised %s", (_name, override) => {
    // "A deployment may lower them, but must not raise them" is only true while
    // something enforces it: a raised window extends how long private objects
    // live, which is the property this section exists to bound.
    expect(() =>
      assertPrivateGalleryRetentionWindows({
        ...PRIVATE_GALLERY_RETENTION_WINDOWS,
        ...override,
      }),
    ).toThrow(PrivateGalleryRetentionError);
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    "refuses %s days",
    (value) => {
      expect(() =>
        assertPrivateGalleryRetentionWindows({
          ...PRIVATE_GALLERY_RETENTION_WINDOWS,
          maxSuspensionDays: value,
        }),
      ).toThrow(PrivateGalleryRetentionError);
    },
  );
});

describe("computePrivateGalleryDeletionDeadline", () => {
  it("counts from the cleanup trigger, not from publication", () => {
    // An administrator delete on day one gets the same grace a natural expiry
    // does, rather than inheriting the rest of the access window.
    const trigger = new Date("2026-09-02T10:00:00.000Z");

    expect(computePrivateGalleryDeletionDeadline(trigger).toISOString()).toBe(
      new Date(
        trigger.getTime() + PRIVATE_GALLERY_DELETION_GRACE_DAYS * DAY,
      ).toISOString(),
    );
  });

  it("honours a deployment's lowered grace", () => {
    const trigger = new Date("2026-09-02T10:00:00.000Z");

    expect(
      computePrivateGalleryDeletionDeadline(trigger, {
        ...PRIVATE_GALLERY_RETENTION_WINDOWS,
        deletionGraceDays: 5,
      }).toISOString(),
    ).toBe(new Date(trigger.getTime() + 5 * DAY).toISOString());
  });
});

describe("evaluatePrivateGalleryRetention", () => {
  const NOW = new Date("2026-09-02T12:00:00.000Z");
  const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
  const ahead = (days: number) => new Date(NOW.getTime() + days * DAY);

  const evaluate = (input: PrivateGalleryRetentionInput, now = NOW) =>
    evaluatePrivateGalleryRetention(input, now);

  it("leaves a draft alone", () => {
    // It holds no objects, so an abandoned one is a plain row delete rather
    // than the object-retention lifecycle.
    expect(evaluate({ state: "draft" })).toEqual({ due: false });
  });

  it.each(["preparing", "ready"] as const)(
    "expires a %s gallery that outlived the preparation window",
    (state) => {
      expect(
        evaluate({ state, preparationStartedAt: ago(30) }),
      ).toMatchObject({ due: true, to: "expiring", reason: "preparation-abandoned" });
    },
  );

  it.each(["preparing", "ready"] as const)(
    "leaves a %s gallery inside the preparation window",
    (state) => {
      expect(
        evaluate({ state, preparationStartedAt: ago(29.5) }),
      ).toEqual({ due: false });
    },
  );

  it("expires a published gallery at its access expiry, not before", () => {
    const input: PrivateGalleryRetentionInput = {
      state: "published",
      accessExpiresAt: NOW,
    };

    // The boundary is inclusive: at the instant itself, access is over.
    expect(evaluate(input)).toMatchObject({
      due: true,
      to: "expiring",
      reason: "access-expired",
    });
    expect(evaluate(input, new Date(NOW.getTime() - 1))).toEqual({
      due: false,
    });
  });

  it("expires a revoked gallery that was never replaced", () => {
    expect(
      evaluate({ state: "access-suspended", accessSuspendedAt: ago(30) }),
    ).toMatchObject({ due: true, to: "expiring", reason: "suspension-abandoned" });
    expect(
      evaluate({ state: "access-suspended", accessSuspendedAt: ago(1) }),
    ).toEqual({ due: false });
  });

  it("starts cleanup as soon as a gallery is expiring", () => {
    // The grace window is a deadline for finishing, not a delay before starting.
    expect(evaluate({ state: "expiring", cleanupTriggeredAt: NOW })).toMatchObject(
      { due: true, to: "deleting", reason: "cleanup-due", overdue: false },
    );
  });

  it("retries a failed deletion on the next run", () => {
    expect(
      evaluate({ state: "deletion-failed", cleanupTriggeredAt: ago(1) }),
    ).toMatchObject({ due: true, to: "deleting", reason: "deletion-retry" });
  });

  it("parks a failed deletion once a human has acknowledged it", () => {
    expect(
      evaluate({
        state: "deletion-failed",
        cleanupTriggeredAt: ago(1),
        deletionFailureAcknowledged: true,
      }),
    ).toEqual({ due: false });
  });

  it("decides nothing for a gallery already being deleted", () => {
    // Whether the objects are actually gone is an object-store read, so the
    // move to `deleted` belongs to the worker and not to this rule.
    expect(evaluate({ state: "deleting", cleanupTriggeredAt: ago(1) })).toEqual({
      due: false,
    });
    expect(evaluate({ state: "deleted" })).toEqual({ due: false });
  });

  it("marks a late run overdue without changing what it decides", () => {
    const decision = evaluate({
      state: "deletion-failed",
      cleanupTriggeredAt: ago(PRIVATE_GALLERY_DELETION_GRACE_DAYS + 1),
    });

    expect(decision).toMatchObject({
      due: true,
      to: "deleting",
      reason: "deletion-retry",
      overdue: true,
    });
  });

  it.each([
    ["preparing", { state: "preparing" }],
    ["ready", { state: "ready" }],
    ["published", { state: "published" }],
    ["access-suspended", { state: "access-suspended" }],
  ] as const)(
    "refuses a %s gallery whose retention timestamp is missing",
    (_name, input) => {
      // A missing timestamp must never read as "no deadline reached": that
      // would let one corrupt row keep private objects alive indefinitely,
      // which is the exact failure the bounded-lifetime rule exists to prevent.
      expect(() => evaluate(input)).toThrow(PrivateGalleryRetentionError);
    },
  );

  it("refuses an unusable clock", () => {
    expect(() =>
      evaluate({ state: "published", accessExpiresAt: ahead(1) }, new Date(NaN)),
    ).toThrow(PrivateGalleryRetentionError);
  });

  it("only ever proposes a transition the state machine allows", () => {
    // The machine is the authority; a decision this module invented that the
    // machine forbids would be a bug here, so it is checked rather than assumed.
    const inputs: PrivateGalleryRetentionInput[] = PRIVATE_GALLERY_STATES.map(
      (state) => ({
        state,
        preparationStartedAt: ago(60),
        accessExpiresAt: ago(60),
        accessSuspendedAt: ago(60),
        cleanupTriggeredAt: ago(60),
      }),
    );

    for (const input of inputs) {
      expect(() => evaluate(input)).not.toThrow();
    }
  });

  it("never proposes a way back to published", () => {
    // The §7 deletion guard: making a gallery available again after deletion is
    // a brand-new publication with a fresh clock, never a revival.
    for (const state of ["expiring", "deleting", "deleted", "deletion-failed"] as const) {
      const decision = evaluate({ state, cleanupTriggeredAt: ago(1) });
      if (decision.due) expect(decision.to).not.toBe("published");
    }
  });
});

describe("isPrivateGalleryDeletionOverdue", () => {
  const NOW = new Date("2026-09-02T12:00:00.000Z");

  it("is false before cleanup has been triggered at all", () => {
    expect(isPrivateGalleryDeletionOverdue(undefined, NOW)).toBe(false);
  });

  it("turns true exactly at the deadline", () => {
    const trigger = new Date(
      NOW.getTime() - PRIVATE_GALLERY_DELETION_GRACE_DAYS * DAY,
    );

    expect(isPrivateGalleryDeletionOverdue(trigger, NOW)).toBe(true);
    expect(
      isPrivateGalleryDeletionOverdue(trigger, new Date(NOW.getTime() - 1)),
    ).toBe(false);
  });
});

describe("isPrivateGallerySessionReapable", () => {
  const NOW = new Date("2026-09-02T12:00:00.000Z");

  it("reaps a session at its own expiry, whatever its gallery is doing", () => {
    // Sessions are reaped in their own expiry-indexed pass, independently of
    // gallery deletion — waiting for the gallery would leave rows behind for
    // every gallery that never expires.
    expect(isPrivateGallerySessionReapable({ expiresAt: NOW }, NOW)).toBe(true);
    expect(
      isPrivateGallerySessionReapable(
        { expiresAt: new Date(NOW.getTime() + 1) },
        NOW,
      ),
    ).toBe(false);
  });

  it("refuses an unusable date rather than reaping", () => {
    expect(() =>
      isPrivateGallerySessionReapable({ expiresAt: new Date(NaN) }, NOW),
    ).toThrow(PrivateGalleryRetentionError);
  });
});
