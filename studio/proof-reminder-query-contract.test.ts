import { describe, expect, it } from "vitest";
import { evaluate, parse } from "groq-js/1";
import { PROOF_REMINDER_DISCOVERY_QUERY } from "../src/lib/proof-reminder-access";
import { PROOF_REMINDER_SETTINGS_INCOMPLETE_FILTER, PROOF_REMINDERS_NEEDING_ACTION_FILTER } from "./editorial-policy";

const terms = (id: string, extra: Record<string, unknown> = {}) => ({ _id: `proofTerms.${id}`, _type: "clientProofTerms", galleryId: id, reminderDelayDays: 7,
  customerEmail: "c@example.fi", customerLocale: "fi", firstPublishedAt: "2026-10-01T00:00:00.000Z", ...extra });
async function run(source: string, dataset: Record<string, unknown>[], params: Record<string, unknown> = {}, at = "2026-10-23T10:10:00Z") {
  return (await evaluate(parse(source), { dataset, params, timestamp: new Date(at) })).get();
}

describe("actual GROQ reminder queries", () => {
  it("discovers enabled reminders after the cursor in ID order", async () => {
    const dataset = [terms("b"), terms("a"), terms("c", { reminderDelayDays: null }), terms("d"), { _id: "x", _type: "clientProofGallery" }];
    expect(await run(PROOF_REMINDER_DISCOVERY_QUERY, dataset, { after: "" })).toEqual([{ _id: "proofTerms.a", galleryId: "a" }, { _id: "proofTerms.b", galleryId: "b" }, { _id: "proofTerms.d", galleryId: "d" }]);
    expect(await run(PROOF_REMINDER_DISCOVERY_QUERY, dataset, { after: "proofTerms.b" })).toEqual([{ _id: "proofTerms.d", galleryId: "d" }]);
  });

  it("lists failed reminders and ones pending for more than five minutes", async () => {
    const reminder = (id: string, state: string, createdAt: string) => ({ _id: `proofReminder.g1.${id}`, _type: "clientProofReminder", state, createdAt });
    const dataset = [reminder("1", "failed", "2026-10-23T10:09:00Z"), reminder("2", "pending", "2026-10-23T10:00:00Z"), reminder("3", "pending", "2026-10-23T10:08:00Z"),
      reminder("4", "sent", "2026-10-23T09:00:00Z"), reminder("5", "cancelled", "2026-10-23T09:00:00Z")];
    expect(await run(`*[${PROOF_REMINDERS_NEEDING_ACTION_FILTER}] | order(_id asc)._id`, dataset)).toEqual(["proofReminder.g1.1", "proofReminder.g1.2"]);
  });

  it("lists published proof galleries whose enabled reminders lack a language, address or publication time", async () => {
    const gallery = (id: string) => ({ _id: id, _type: "clientProofGallery" });
    const dataset = [gallery("g1"), gallery("g2"), gallery("g3"), gallery("drafts.g4"), gallery("g4"),
      terms("g1"), terms("g2", { customerLocale: undefined }), terms("g3", { reminderDelayDays: null, customerLocale: undefined }), terms("g4", { customerEmail: undefined })];
    expect(await run(`*[${PROOF_REMINDER_SETTINGS_INCOMPLETE_FILTER}] | order(_id asc)._id`, dataset)).toEqual(["g2", "g4"]);
  });
});
