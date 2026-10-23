import { describe, expect, it } from "vitest";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { proofGalleryHandleFromPath } from "@/lib/proof-gallery-path";
import {
  DAY_MS, dueReminderStep, parseReminderTerms, planReminderClaim, proofReminderEmail, reminderSettingsUnchanged, REMINDER_STEP_MS, selectionEverConfirmed,
} from "@/lib/proof-reminder";

const locales = ["fi", "en-GB"];
const first = Date.parse("2026-10-01T00:00:00.000Z");
const terms = (extra: Record<string, unknown> = {}) => ({ _id: "proofTerms.g1", _type: "clientProofTerms", _rev: "t1", galleryId: "g1",
  firstPublishedAt: "2026-10-01T00:00:00.000Z", reminderDelayDays: 7, customerEmail: "c@example.fi", customerLocale: "fi",
  selectionKeyHash: "a".repeat(64), selectionKeyCiphertext: { v: 1 }, ...extra });

describe("reminder terms", () => {
  it("reads enabled reminders and tells off from misconfigured, guessing nothing", () => {
    expect(parseReminderTerms(terms(), "g1", locales)).toMatchObject({ kind: "on", terms: { delayDays: 7, locale: "fi", firstPublishedAt: first } });
    expect(parseReminderTerms(terms({ reminderDelayDays: null }), "g1", locales)).toEqual({ kind: "off" });
    for (const patch of [{ customerLocale: undefined }, { customerLocale: "sv" }, { customerEmail: "x" }, { firstPublishedAt: "2026-10-01" },
      { reminderResumeAfter: "soon" }, { reminderDelayDays: 0 }, { selectionKeyHash: "x" }, { galleryId: "g2" }]) {
      expect(parseReminderTerms(terms(patch), "g1", locales), JSON.stringify(patch)).toEqual({ kind: "misconfigured" });
    }
  });
});

describe("the due step", () => {
  const t = { firstPublishedAt: first, delayDays: 7 };
  it("follows first publication + delay + (n − 1) × 30 days, exactly at each boundary", () => {
    const one = first + 7 * DAY_MS;
    expect(dueReminderStep(t, one - 1)).toBeUndefined();
    expect(dueReminderStep(t, one)).toEqual({ step: 1, dueAt: one });
    expect(dueReminderStep(t, one + REMINDER_STEP_MS - 1)).toEqual({ step: 1, dueAt: one });
    expect(dueReminderStep(t, one + REMINDER_STEP_MS)).toEqual({ step: 2, dueAt: one + REMINDER_STEP_MS });
  });

  it("considers only the latest of several missed steps", () => {
    expect(dueReminderStep(t, first + 7 * DAY_MS + 3 * REMINDER_STEP_MS + DAY_MS)?.step).toBe(4);
  });

  it("holds back a step due at or before the resume cutoff, so the next step is the first after it", () => {
    const one = first + 7 * DAY_MS, two = one + REMINDER_STEP_MS;
    expect(dueReminderStep({ ...t, resumeAfter: one }, one + DAY_MS)).toBeUndefined();
    expect(dueReminderStep({ ...t, resumeAfter: one - 1 }, one + DAY_MS)?.step).toBe(1);
    expect(dueReminderStep({ ...t, resumeAfter: one + DAY_MS }, two)).toEqual({ step: 2, dueAt: two });
  });
});

describe("stopping for good", () => {
  it("stops on any confirmed version, even after a reopen, and never reminds on an unreadable selection", () => {
    expect(selectionEverConfirmed(null)).toBe(false);
    expect(selectionEverConfirmed({ state: "open", latestVersion: 0 })).toBe(false);
    expect(selectionEverConfirmed({ state: "confirmed", latestVersion: 1 })).toBe(true);
    expect(selectionEverConfirmed({ state: "open", latestVersion: 1 })).toBe(true);
    expect(selectionEverConfirmed("garbage")).toBe(true);
  });
});

describe("the claim and the final check", () => {
  const read = parseReminderTerms(terms(), "g1", locales);
  if (read.kind !== "on") throw new Error("fixture");
  it("creates the step once and guards the terms revision read", () => {
    expect(planReminderClaim("g1", read.terms, 2, first, "2026-11-08T06:00:00.000Z")).toEqual([
      { create: { _id: "proofReminder.g1.2", _type: "clientProofReminder", galleryId: "g1", step: 2, dueAt: "2026-10-01T00:00:00.000Z", state: "pending", createdAt: "2026-11-08T06:00:00.000Z" } },
      { patch: { id: "proofTerms.g1", ifRevisionID: "t1", set: { lastReminderClaimAt: "2026-11-08T06:00:00.000Z" } } },
    ]);
  });

  it("cancels when the address, language, key, delay or resume point changed, or reminders were stopped", () => {
    expect(reminderSettingsUnchanged(read.terms, parseReminderTerms(terms({ _rev: "t2", lastReminderClaimAt: "x" }), "g1", locales))).toBe(true);
    for (const patch of [{ customerEmail: "d@example.fi" }, { customerLocale: "en-GB" }, { selectionKeyHash: "b".repeat(64) }, { reminderDelayDays: 9 },
      { reminderResumeAfter: "2026-11-01T00:00:00.000Z" }, { reminderDelayDays: null }]) {
      expect(reminderSettingsUnchanged(read.terms, parseReminderTerms(terms(patch), "g1", locales)), JSON.stringify(patch)).toBe(false);
    }
  });
});

describe("the message", () => {
  const key = "K".repeat(42) + "A";
  it("is in the customer's language, with the locale before the fragment key and a stop link", () => {
    const email = proofReminderEmail({ canonicalBase: new URL("https://photos.example"), handle: "c".repeat(32), key, locale: "en-GB", defaultLocale: "fi", title: "Wedding", firstPublishedAt: first }, getBuiltInLabels("en-GB").proofReminder);
    expect(email.subject).toContain("Wedding");
    expect(email.text).toContain(`https://photos.example/client-proof/${"c".repeat(32)}?locale=en-GB#select=${key}`);
    expect(email.text).toContain(`https://photos.example/client-proof/${"c".repeat(32)}/reminders?locale=en-GB#select=${key}`);
    const finnish = proofReminderEmail({ canonicalBase: new URL("https://photos.example"), handle: "c".repeat(32), key, locale: "fi", defaultLocale: "fi", firstPublishedAt: first }, getBuiltInLabels("fi").proofReminder);
    expect(finnish.text).toContain(`/client-proof/${"c".repeat(32)}#select=${key}`);
    expect(finnish.subject).toContain("vedoksesi");
    // The emailed stop link lands on the served stop page, not a 404.
    const stopLink = email.text.split("\n").find((line) => line.includes("/reminders"))!;
    expect(proofGalleryHandleFromPath(new URL(stopLink).pathname)).toBe("c".repeat(32));
  });
});
