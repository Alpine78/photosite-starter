import { describe, expect, it } from "vitest";
import {
  parseReminderSettings, readReminderSettingsForm, reminderSettingsForm, reminderSettingsPatch, saveReminderSettings, type ReminderSettings,
} from "./proof-reminder-settings";

const locales = ["fi", "en-GB"], now = "2026-10-23T12:00:00.000Z";
const terms = (extra: Record<string, unknown> = {}) => ({ _id: "proofTerms.g1", _type: "clientProofTerms", _rev: "t1", galleryId: "g1",
  includedCount: 10, extraUnitPriceMinor: 1500, currency: "EUR", selectionKeyHash: "a".repeat(64),
  reminderDelayDays: 7, customerEmail: "asiakas@example.fi", customerLocale: "fi", ...extra });
const on: ReminderSettings = { on: true, delayDays: 7, customerEmail: "asiakas@example.fi", locale: "fi" };

describe("reading the reminder settings", () => {
  it("reads only reminder fields from exactly this gallery's terms", () => {
    expect(parseReminderSettings(terms(), "g1", locales)).toEqual({ termsId: "proofTerms.g1", revision: "t1", settings: on });
    expect(parseReminderSettings(terms({ reminderDelayDays: null, customerEmail: undefined }), "g1", locales)).toEqual({ termsId: "proofTerms.g1", revision: "t1", settings: { on: false } });
    expect(JSON.stringify(parseReminderSettings(terms(), "g1", locales))).not.toMatch(/1500|a{64}/u);
  });

  it("asks for a language rather than guessing one for an older record", () => {
    expect(parseReminderSettings(terms({ customerLocale: undefined }), "g1", locales)?.settings).toEqual({ ...on, locale: "" });
    expect(parseReminderSettings(terms({ customerLocale: "sv" }), "g1", locales)?.settings).toEqual({ ...on, locale: "" });
  });

  it.each([
    ["another gallery's terms", terms({ galleryId: "g2" })], ["another ID", terms({ _id: "proofTerms.g2" })], ["another type", terms({ _type: "x" })],
    ["a malformed delay", terms({ reminderDelayDays: 0 })], ["a malformed address", terms({ customerEmail: "x" })], ["no revision", terms({ _rev: undefined })], ["nothing", null],
  ])("refuses %s", (_name, value) => {
    expect(parseReminderSettings(value, "g1", locales)).toBeUndefined();
  });
});

describe("the settings form", () => {
  it("validates like the publication dialog, including a configured language", () => {
    expect(readReminderSettingsForm({ on: true, delayDays: " 14 ", customerEmail: " b@example.fi ", locale: "en-GB" }, locales)).toEqual({ settings: { on: true, delayDays: 14, customerEmail: "b@example.fi", locale: "en-GB" } });
    expect(readReminderSettingsForm({ on: true, delayDays: "0", customerEmail: "x", locale: "sv" }, locales)).toEqual({ invalid: ["delayDays", "customerEmail", "locale"] });
    expect(readReminderSettingsForm({ on: false, delayDays: "x", customerEmail: "", locale: "" }, locales)).toEqual({ settings: { on: false } });
    expect(reminderSettingsForm({ on: false }, "fi")).toEqual({ on: false, delayDays: "7", customerEmail: "", locale: "fi" });
  });
});

describe("the patch for each transition", () => {
  it("does nothing for an unchanged form or off to off", () => {
    expect(reminderSettingsPatch(on, on, now)).toBeUndefined();
    expect(reminderSettingsPatch({ on: false }, { on: false }, now)).toBeUndefined();
  });

  it("switching off removes the address and language and records the administrator's stop", () => {
    expect(reminderSettingsPatch(on, { on: false }, now)).toEqual({
      set: { reminderDelayDays: null, reminderStoppedAt: now, reminderStoppedBy: "administrator" }, unset: ["customerEmail", "customerLocale"] });
  });

  it("switching on resumes from the next step and clears the stop marker", () => {
    expect(reminderSettingsPatch({ on: false }, on, now)).toEqual({
      set: { reminderDelayDays: 7, customerEmail: "asiakas@example.fi", customerLocale: "fi", reminderResumeAfter: now }, unset: ["reminderStoppedAt", "reminderStoppedBy"] });
  });

  it("a new delay also resumes from the next step; a new address or language does not", () => {
    expect(reminderSettingsPatch(on, { ...on, delayDays: 3 }, now)?.set).toMatchObject({ reminderDelayDays: 3, reminderResumeAfter: now });
    expect(reminderSettingsPatch(on, { ...on, locale: "en-GB" }, now)).toEqual({ set: { reminderDelayDays: 7, customerEmail: "asiakas@example.fi", customerLocale: "en-GB" }, unset: [] });
  });
});

describe("saving", () => {
  const loaded = { termsId: "proofTerms.g1", revision: "t1", settings: on };

  it("commits once against the loaded revision and reports each outcome", async () => {
    const calls: unknown[][] = [];
    expect(await saveReminderSettings(loaded, { on: false }, now, async (...args) => { calls.push(args); })).toBe("saved");
    expect(calls).toEqual([["proofTerms.g1", "t1", expect.objectContaining({ unset: ["customerEmail", "customerLocale"] })]]);
    expect(await saveReminderSettings(loaded, on, now, async () => { throw new Error("never"); })).toBe("unchanged");
    expect(await saveReminderSettings(loaded, { on: false }, now, async () => { throw Object.assign(new Error("x"), { statusCode: 409 }); })).toBe("conflict");
    expect(await saveReminderSettings(loaded, { on: false }, now, async () => { throw new TypeError("network"); })).toBe("uncertain");
  });
});
