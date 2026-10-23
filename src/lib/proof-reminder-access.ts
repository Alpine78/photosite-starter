/**
 * The daily customer reminder run (ADR-0038 decision 9, its 2026-10-23
 * amendment, action item 5, AB#130), reached only through this facade.
 *
 * Per gallery: the terms are read fresh first and every later read and the
 * claim depend on that revision, so a confirmation, rotation, settings change
 * or stop in between fails the claim. Step n is claimed once (`create` of
 * `proofReminder.<id>.<n>` with a terms guard); after the claim the terms,
 * selection and gallery are read again and the send is cancelled — recorded,
 * not left pending — if anything relevant changed. A message already handed to
 * the provider cannot be withdrawn by a later write; this is a final check,
 * not an ordering across two services. An ambiguous claim never sends, and an
 * old pending record is never reclaimed.
 *
 * Progress: galleries are taken in `_id` order in bounded batches from a
 * private cursor, wrapping around, and a run stops starting new galleries once
 * its time budget is spent (one already begun is finished); the cursor moves
 * only past galleries actually handled, so every gallery is reached on a later day.
 */
import "server-only";
import { clientGalleryText, isClientGalleryHandle } from "@/lib/client-gallery-model";
import type { ContactDeliveryErrorClass, ContactDeliveryOutcome } from "@/lib/contact-delivery";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { parsePublishedProofGallery, proofGalleryAvailable } from "@/lib/proof-gallery-model";
import {
  dueReminderStep, parseReminderTerms, planReminderClaim, proofReminderEmail, proofReminderId, reminderSettingsUnchanged,
  selectionEverConfirmed, PROOF_REMINDER_TYPE, type ReminderTerms,
} from "@/lib/proof-reminder";
import { proofSelectionId, proofTermsDocumentId } from "@/lib/proof-selection";
import { decryptSelectionKey, selectionKeyMatches } from "@/lib/proof-selection-key";
import { commitProofSelection, ProofSelectionStoreError, queryProofRecords, readProofSelectionDocument } from "@/lib/proof-selection-sanity";
import { isReplacementDeliveryAvailable } from "@/lib/client-gallery-access";
import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { getSanityConfig } from "@/lib/sanity-config";
import { buildProofReminderSender } from "@/lib/proof-reminder-delivery";
import { createCorrelationId, logProofReminderEvent } from "@/lib/contact-log";

export const PROOF_REMINDER_CURSOR_ID = "proofReminderCursor.daily";
export const PROOF_REMINDER_BATCH = 50;
/** Exported for the groq-js contract test. */
export const PROOF_REMINDER_DISCOVERY_QUERY = `*[_type == "clientProofTerms" && reminderDelayDays != null && _id > $after] | order(_id asc)[0...${PROOF_REMINDER_BATCH}]{_id, galleryId}`;
/** No new gallery is started after this much of the run; the rest of the function's time finishes the one in flight. */
export const PROOF_REMINDER_START_BUDGET_MS = 15_000;

export type ReminderEmail = Readonly<{ to: string; subject: string; text: string }>;
export type ReminderOutcome = "sent" | "failed" | "cancelled" | "skipped" | "paused" | "stopped" | "misconfigured" | "ambiguous";
export type ReminderRunCounts = Record<ReminderOutcome, number> & { examined: number; completedPass: boolean };

export type ReminderRunDependencies = Readonly<{
  query: (groq: string, params: Record<string, unknown>) => Promise<unknown>;
  read: (id: string) => Promise<unknown>;
  commit: (mutations: readonly Record<string, unknown>[]) => Promise<void>;
  send: (email: ReminderEmail, idempotencyKey: string) => Promise<ContactDeliveryOutcome>;
  replacementAvailable: (handle: string, documentId: string, language: string) => Promise<boolean>;
  secret: Buffer;
  locales: readonly string[];
  defaultLocale: string;
  canonicalBase: URL;
  labels: (locale: string) => BuiltInLabels["proofReminder"];
  now: () => number;
  /** Monotonic milliseconds for the time budget. */
  clock: () => number;
  log?: (outcome: ReminderOutcome, errorClass?: string) => void;
}>;

type Gallery = Readonly<{ handle: string; title?: string; open: boolean; replaced: boolean }>;

export async function runProofReminders(dependencies: ReminderRunDependencies): Promise<ReminderRunCounts> {
  const counts: ReminderRunCounts = { examined: 0, completedPass: false, sent: 0, failed: 0, cancelled: 0, skipped: 0, paused: 0, stopped: 0, misconfigured: 0, ambiguous: 0 };
  const started = dependencies.clock();
  const hasTime = () => dependencies.clock() - started < PROOF_REMINDER_START_BUDGET_MS;
  const iso = () => new Date(dependencies.now()).toISOString();
  const note = (outcome: ReminderOutcome, errorClass?: string) => { counts[outcome]++; dependencies.log?.(outcome, errorClass); };

  async function gallery(id: string, locale: string): Promise<Gallery | undefined> {
    const raw = await dependencies.read(id) as Record<string, unknown> | null;
    if (raw === null || !isClientGalleryHandle(raw.handle)) return undefined;
    const parsed = parsePublishedProofGallery(raw, id, raw.handle);
    let replaced = false;
    if (parsed.replacedBy !== undefined) {
      const delivery = await dependencies.read(parsed.replacedBy) as Record<string, unknown> | null;
      replaced = delivery !== null && delivery._type === "clientDeliveryGallery" && isClientGalleryHandle(delivery.handle) &&
        await dependencies.replacementAvailable(delivery.handle, parsed.replacedBy, locale);
    }
    const title = clientGalleryText(parsed.title, locale, dependencies.defaultLocale);
    return { handle: parsed.handle, ...(title === undefined ? {} : { title }), open: proofGalleryAvailable(parsed, dependencies.now()), replaced };
  }

  async function record(id: string, set: Record<string, unknown>): Promise<boolean> {
    try {
      const current = await dependencies.read(id) as Record<string, unknown> | null;
      if (!current || current._type !== PROOF_REMINDER_TYPE || current.state !== "pending" || typeof current._rev !== "string") return false;
      await dependencies.commit([{ patch: { id, ifRevisionID: current._rev, set: { ...set, attemptedAt: iso() } } }]);
      return true;
    } catch { return false; }
  }

  async function one(galleryId: string): Promise<void> {
    counts.examined++;
    // 1. Terms first: the claim is guarded by exactly this revision.
    const terms = parseReminderTerms(await dependencies.read(proofTermsDocumentId(galleryId)), galleryId, dependencies.locales);
    if (terms.kind === "off") return note("skipped");
    if (terms.kind === "misconfigured") return note("misconfigured");
    const t: ReminderTerms = terms.terms;
    if (selectionEverConfirmed(await dependencies.read(proofSelectionId(galleryId)))) return note("stopped");
    const g = await gallery(galleryId, t.locale);
    if (!g) return note("skipped");
    if (!g.open || g.replaced) return note("paused");
    const due = dueReminderStep(t, dependencies.now());
    if (!due) return note("skipped");
    const reminderId = proofReminderId(galleryId, due.step);
    if (await dependencies.read(reminderId) !== null) return note("skipped");
    // 2. Prepare everything before claiming, so claim-to-send stays short.
    let key: string | undefined;
    try { key = decryptSelectionKey(t.ciphertext, galleryId, dependencies.secret); } catch { key = undefined; }
    const keyUsable = key !== undefined && selectionKeyMatches(key, t.keyHash);
    const email = keyUsable ? proofReminderEmail({ canonicalBase: dependencies.canonicalBase, handle: g.handle, key: key!, locale: t.locale,
      defaultLocale: dependencies.defaultLocale, ...(g.title === undefined ? {} : { title: g.title }), firstPublishedAt: t.firstPublishedAt }, dependencies.labels(t.locale)) : undefined;
    // 3. Claim once. A gallery already begun is finished; the budget only stops new ones.
    try {
      await dependencies.commit(planReminderClaim(galleryId, t, due.step, due.dueAt, iso()));
    } catch (error) {
      if (error instanceof ProofSelectionStoreError && error.kind === "conflict") return note("skipped");
      return note("ambiguous", error instanceof ProofSelectionStoreError ? error.kind : "internal");
    }
    if (!email) {
      // A broken link is never sent; the failure is visible in Studio.
      await record(reminderId, { state: "failed", errorClass: "key-unavailable" });
      return note("failed", "key-unavailable");
    }
    // 4. Final check right before sending.
    const after = parseReminderTerms(await dependencies.read(proofTermsDocumentId(galleryId)), galleryId, dependencies.locales);
    const stillDue = reminderSettingsUnchanged(t, after) && !selectionEverConfirmed(await dependencies.read(proofSelectionId(galleryId)));
    const stillOpen = stillDue ? await gallery(galleryId, t.locale) : undefined;
    if (!stillDue || !stillOpen || !stillOpen.open || stillOpen.replaced) {
      await record(reminderId, { state: "cancelled", errorClass: !stillDue ? "changed" : "paused" });
      return note("cancelled");
    }
    let delivered: ContactDeliveryOutcome;
    try {
      delivered = await dependencies.send({ to: t.customerEmail, subject: email.subject, text: email.text }, `proof-reminder/${galleryId}/${due.step}`);
    } catch {
      delivered = { status: "failed", errorClass: "provider-unavailable", retryable: true };
    }
    if (delivered.status === "delivered") {
      await record(reminderId, { state: "sent" });
      return note("sent");
    }
    const errorClass: ContactDeliveryErrorClass = delivered.errorClass;
    await record(reminderId, { state: "failed", errorClass });
    note("failed", errorClass);
  }

  const cursor = await dependencies.read(PROOF_REMINDER_CURSOR_ID) as Record<string, unknown> | null;
  const start = typeof cursor?.after === "string" && cursor.after.length <= 140 ? cursor.after : "";
  let after = start, wrapped = false;
  while (hasTime()) {
    const rows = await dependencies.query(PROOF_REMINDER_DISCOVERY_QUERY, { after });
    if (!Array.isArray(rows)) throw new ProofSelectionStoreError("unavailable");
    let consumed = true;
    for (const row of rows) {
      if (!hasTime()) { consumed = false; break; }
      const id = (row as Record<string, unknown>)._id, galleryId = (row as Record<string, unknown>).galleryId;
      if (typeof id !== "string" || typeof galleryId !== "string" || id !== proofTermsDocumentId(galleryId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/u.test(galleryId)) continue;
      // Wrapped around to where this run began: every gallery has had its turn.
      if (wrapped && id > start) { counts.completedPass = true; break; }
      try { await one(galleryId); } catch { note("skipped", "unreadable"); }
      after = id;
    }
    if (counts.completedPass || !consumed) break;
    if (rows.length < PROOF_REMINDER_BATCH) {
      if (wrapped || start === "") { counts.completedPass = true; after = ""; break; }
      wrapped = true; after = "";
    }
  }
  try {
    await dependencies.commit([{ createOrReplace: { _id: PROOF_REMINDER_CURSOR_ID, _type: "clientProofReminderCursor", after, updatedAt: iso() } }]);
  } catch { /* the next run starts from the previous cursor */ }
  return counts;
}

/**
 * The run with this deployment's store, mail and site settings: the selection
 * credential, the key secret, and the owner mailbox as Reply-To so the
 * customer's answer reaches the photographer.
 */
export async function runConfiguredProofReminders(settings: Readonly<{ token: string; secret: Buffer; environment: Readonly<Record<string, string | undefined>> }>): Promise<ReminderRunCounts> {
  const deployment = getDeploymentConfig(), options = { config: getSanityConfig(), token: settings.token };
  const send = buildProofReminderSender(settings.environment);
  return runProofReminders({
    query: (groq, params) => queryProofRecords(groq, params, options),
    read: (id) => readProofSelectionDocument(id, options),
    commit: (mutations) => commitProofSelection(mutations, options),
    send, replacementAvailable: isReplacementDeliveryAvailable, secret: settings.secret,
    locales: deployment.localeRoutes.locales.map((route) => route.locale), defaultLocale: deployment.locale,
    canonicalBase: deployment.canonicalBaseUrl, labels: (locale) => getBuiltInLabels(locale).proofReminder,
    now: Date.now, clock: () => performance.now(),
    log: (outcome, errorClass) => logProofReminderEvent({ correlationId: createCorrelationId(), outcome, ...(errorClass ? { errorClass } : {}) }),
  });
}
