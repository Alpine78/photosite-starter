import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBuiltInLabels } from "@/lib/deployment-config";
import { PROOF_REMINDER_BATCH, PROOF_REMINDER_CURSOR_ID, runProofReminders, type ReminderRunDependencies } from "@/lib/proof-reminder-access";
import { DAY_MS } from "@/lib/proof-reminder";
import { createSelectionKey, encryptSelectionKey } from "@/lib/proof-selection-key";
import { ProofSelectionStoreError } from "@/lib/proof-selection-sanity";

const secret = Buffer.alloc(32, 7);
const asset = (n: string) => `image-${n.repeat(40)}-1600x1000-webp`;
const now = Date.parse("2026-10-09T06:00:00.000Z"); // first publication 2026-10-01 + 7 days → step 1 due 2026-10-08

/** An in-memory content lake with Sanity's create/ifRevisionID/createOrReplace rules. */
function lake() {
  const documents = new Map<string, Record<string, unknown>>();
  let counter = 0;
  const put = (doc: Record<string, unknown>) => documents.set(doc._id as string, { ...structuredClone(doc), _rev: `r${++counter}` });
  const commit = vi.fn(async (mutations: readonly Record<string, unknown>[]) => {
    const next = new Map([...documents].map(([id, doc]) => [id, structuredClone(doc)]));
    for (const mutation of mutations) {
      if (mutation.create || mutation.createOrReplace) {
        const doc = (mutation.create ?? mutation.createOrReplace) as Record<string, unknown>;
        if (mutation.create && next.has(doc._id as string)) throw new ProofSelectionStoreError("conflict");
        next.set(doc._id as string, { ...doc, _rev: `r${++counter}` });
      } else {
        const patch = mutation.patch as { id: string; ifRevisionID: string; set?: Record<string, unknown> };
        const current = next.get(patch.id);
        if (!current || current._rev !== patch.ifRevisionID) throw new ProofSelectionStoreError("conflict");
        next.set(patch.id, { ...current, ...patch.set, _rev: `r${++counter}` });
      }
    }
    documents.clear(); for (const [id, doc] of next) documents.set(id, doc);
  });
  return { documents, put, commit };
}

function seedGallery(world: ReturnType<typeof lake>, id: string, extra: { terms?: Record<string, unknown>; gallery?: Record<string, unknown>; key?: string } = {}) {
  const { key, hash } = createSelectionKey();
  const handle = id.padEnd(32, "0").replace(/[^a-f0-9]/gu, "a").slice(0, 32);
  world.put({ _id: id, _type: "clientProofGallery", handle, available: true, availabilityMode: "indefinite", referenceHighWater: 1,
    title: [{ _key: "fi", _type: "localizedText", language: "fi", value: `Galleria ${id}` }],
    items: [{ _key: "a", _type: "clientProofItem", mediaType: "image", originalFilename: "a.jpg", reference: "001", image: { _type: "image", asset: { _type: "reference", _ref: asset("1") } } }],
    ...extra.gallery });
  world.put({ _id: `proofTerms.${id}`, _type: "clientProofTerms", galleryId: id, includedCount: 1, extraUnitPriceMinor: 0, currency: "EUR", jobReference: "J",
    firstPublishedAt: "2026-10-01T00:00:00.000Z", reminderDelayDays: 7, customerEmail: `${id}@example.fi`, customerLocale: "fi",
    selectionKeyHash: hash, selectionKeyCiphertext: encryptSelectionKey(extra.key ?? key, id, secret), ...extra.terms });
  return { key, handle };
}

let world: ReturnType<typeof lake>;
let send: ReturnType<typeof vi.fn<ReminderRunDependencies["send"]>>;
let elapsed: number;
function deps(extra: Partial<ReminderRunDependencies> = {}): ReminderRunDependencies {
  return {
    query: async (_groq, params) => [...world.documents.values()]
      .filter((doc) => doc._type === "clientProofTerms" && doc.reminderDelayDays != null && (doc._id as string) > (params.after as string))
      .sort((a, b) => ((a._id as string) < (b._id as string) ? -1 : 1)).slice(0, PROOF_REMINDER_BATCH).map((doc) => ({ _id: doc._id, galleryId: doc.galleryId })),
    read: async (id) => structuredClone(world.documents.get(id) ?? null),
    commit: world.commit, send, replacementAvailable: async () => false, secret,
    locales: ["fi", "en-GB"], defaultLocale: "fi", canonicalBase: new URL("https://photos.example"),
    labels: (locale) => getBuiltInLabels(locale).proofReminder, now: () => now, clock: () => elapsed, ...extra,
  };
}
beforeEach(() => { world = lake(); send = vi.fn(async () => ({ status: "delivered" as const })); elapsed = 0; });

describe("daily proof reminders", () => {
  it("sends the due step once to the customer with the selection and stop links, and records it", async () => {
    const { key, handle } = seedGallery(world, "g1");
    expect(await runProofReminders(deps())).toMatchObject({ sent: 1, examined: 1, completedPass: true });
    const [email, idempotency] = send.mock.calls[0];
    expect(email.to).toBe("g1@example.fi"); expect(idempotency).toBe("proof-reminder/g1/1");
    expect(email.text).toContain(`https://photos.example/client-proof/${handle}#select=${key}`);
    expect(email.text).toContain(`https://photos.example/client-proof/${handle}/reminders#select=${key}`);
    expect(email.subject).toContain("Galleria g1");
    expect(world.documents.get("proofReminder.g1.1")).toMatchObject({ state: "sent", step: 1, dueAt: "2026-10-08T00:00:00.000Z" });
    expect(JSON.stringify(world.documents.get("proofReminder.g1.1"))).not.toContain("@example.fi");
    // The same day again: the step is taken, nothing more is sent.
    expect(await runProofReminders(deps())).toMatchObject({ sent: 0, skipped: 1 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops for good after any confirmed version, and only pauses a closed or replaced gallery", async () => {
    seedGallery(world, "g1"); world.put({ _id: "proofSelection.g1", _type: "clientProofSelection", galleryId: "g1", state: "open", latestVersion: 1, items: [] });
    seedGallery(world, "g2", { gallery: { available: false } });
    seedGallery(world, "g3", { gallery: { replacedBy: { _type: "reference", _ref: "delivery1", _weak: true } } });
    world.put({ _id: "delivery1", _type: "clientDeliveryGallery", handle: "d".repeat(32) });
    expect(await runProofReminders(deps({ replacementAvailable: async () => true }))).toMatchObject({ stopped: 1, paused: 2, sent: 0 });
    expect([...world.documents.keys()].some((id) => id.startsWith("proofReminder."))).toBe(false);
  });

  it("counts reminders it cannot send as configured, without guessing a language", async () => {
    seedGallery(world, "g1", { terms: { customerLocale: undefined } });
    expect(await runProofReminders(deps())).toMatchObject({ misconfigured: 1, sent: 0 });
  });

  it("loses the claim to any terms change after they were read, and sends nothing", async () => {
    seedGallery(world, "g1");
    const commit = world.commit.getMockImplementation()!;
    world.commit.mockImplementationOnce(async (mutations) => {
      world.put({ ...world.documents.get("proofTerms.g1")!, lastConfirmedAt: "x" });
      return commit(mutations);
    });
    expect(await runProofReminders(deps())).toMatchObject({ skipped: 1, sent: 0 });
    expect(world.documents.has("proofReminder.g1.1")).toBe(false);
  });

  it("cancels, visibly, when the customer confirms or stops between the claim and the send", async () => {
    seedGallery(world, "g1");
    const commit = world.commit.getMockImplementation()!;
    world.commit.mockImplementationOnce(async (mutations) => {
      await commit(mutations);
      world.put({ _id: "proofSelection.g1", _type: "clientProofSelection", galleryId: "g1", state: "confirmed", latestVersion: 1, items: [] });
    });
    expect(await runProofReminders(deps())).toMatchObject({ cancelled: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(world.documents.get("proofReminder.g1.1")).toMatchObject({ state: "cancelled", errorClass: "changed" });
  });

  it("never sends after an ambiguous claim, and never reclaims that step later", async () => {
    seedGallery(world, "g1");
    const commit = world.commit.getMockImplementation()!;
    world.commit.mockImplementationOnce(async (mutations) => { await commit(mutations); throw new ProofSelectionStoreError("unknown"); });
    expect(await runProofReminders(deps())).toMatchObject({ ambiguous: 1, sent: 0 });
    expect(await runProofReminders(deps())).toMatchObject({ skipped: 1, sent: 0 });
    expect(send).not.toHaveBeenCalled();
    expect(world.documents.get("proofReminder.g1.1")).toMatchObject({ state: "pending" });
  });

  it("records a key that does not match its hash as failed instead of sending a broken link", async () => {
    seedGallery(world, "g1", { key: createSelectionKey().key });
    expect(await runProofReminders(deps())).toMatchObject({ failed: 1, sent: 0 });
    expect(world.documents.get("proofReminder.g1.1")).toMatchObject({ state: "failed", errorClass: "key-unavailable" });
  });

  it("records a provider failure, never as sent", async () => {
    seedGallery(world, "g1"); send.mockResolvedValue({ status: "failed", errorClass: "provider-quota-exceeded", retryable: false });
    expect(await runProofReminders(deps())).toMatchObject({ failed: 1 });
    expect(world.documents.get("proofReminder.g1.1")).toMatchObject({ state: "failed", errorClass: "provider-quota-exceeded" });
  });

  it("waits for the next step after reminders were switched back on", async () => {
    seedGallery(world, "g1", { terms: { reminderResumeAfter: "2026-10-08T12:00:00.000Z" } });
    expect(await runProofReminders(deps())).toMatchObject({ skipped: 1, sent: 0 });
    expect(await runProofReminders(deps({ now: () => now + 30 * DAY_MS }))).toMatchObject({ sent: 1 });
    expect(world.documents.has("proofReminder.g1.2")).toBe(true);
  });

  it("reaches every gallery across budget-limited runs, beyond one batch, wrapping around", async () => {
    const ids = Array.from({ length: PROOF_REMINDER_BATCH + 10 }, (_, n) => `g${String(n).padStart(3, "0")}`);
    for (const id of ids) seedGallery(world, id);
    // Each gallery costs 1 s of the 15 s start budget, so one run reaches 15 of them.
    const runs: number[] = [];
    for (let run = 0; run < 8; run++) {
      const counts = await runProofReminders(deps({ clock: () => elapsed, send: vi.fn(async () => { elapsed += 1000; return { status: "delivered" as const }; }) }));
      runs.push(counts.sent); elapsed = 0;
    }
    expect(runs.reduce((a, b) => a + b, 0)).toBe(ids.length);
    for (const id of ids) expect(world.documents.get(`proofReminder.${id}.1`), id).toMatchObject({ state: "sent" });
    expect(world.documents.get(PROOF_REMINDER_CURSOR_ID)).toBeDefined();
  });

  it("keeps its place when the budget ends inside a short batch, so later galleries are not starved", async () => {
    const ids = Array.from({ length: 20 }, (_, n) => `g${String(n).padStart(2, "0")}`);
    for (const id of ids) seedGallery(world, id);
    let runs = 0;
    while (ids.some((id) => !world.documents.has(`proofReminder.${id}.1`)) && runs < 20) {
      elapsed = 0; runs++;
      // Every store read costs 500 ms, so each run handles only a few galleries.
      await runProofReminders(deps({ read: async (id) => { elapsed += 500; return structuredClone(world.documents.get(id) ?? null); } }));
    }
    for (const id of ids) expect(world.documents.get(`proofReminder.${id}.1`), id).toMatchObject({ state: "sent" });
    expect(runs).toBeLessThan(20);
  });

  it("finishes a gallery whose slow reads cross the start budget instead of abandoning it", async () => {
    seedGallery(world, "g1");
    const counts = await runProofReminders(deps({ read: async (id) => { elapsed += 4_000; return structuredClone(world.documents.get(id) ?? null); } }));
    expect(counts).toMatchObject({ sent: 1 });
    expect(world.documents.get("proofReminder.g1.1")).toMatchObject({ state: "sent" });
  });
});
