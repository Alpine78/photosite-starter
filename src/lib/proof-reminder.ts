/**
 * Customer reminder planner (ADR-0038 decision 9 and its 2026-10-23 amendment,
 * action item 5, AB#130). Pure: it parses the private records the daily run
 * read, decides which step is due, and builds the claim and the message.
 *
 * Reminder n is due at first publication + delay + (n − 1) × 30 days. A run
 * considers only the latest due step, never one due at or before
 * `reminderResumeAfter` (set when reminders are switched back on or the delay
 * changes). A confirmed version ever — even after a reopen — stops reminders
 * for good; a paused, expired or replaced gallery only pauses them.
 */
import "server-only";
import { formatUtcDateTime } from "@/lib/date-format";
import type { BuiltInLabels } from "@/lib/deployment-config";
import { isProofCustomerEmail, isProofLocaleTag, PROOF_MAX_REMINDER_DAYS } from "@/lib/proof-terms";
import { proofTermsDocumentId } from "@/lib/proof-selection";

export const PROOF_REMINDER_TYPE = "clientProofReminder";
export const DAY_MS = 86_400_000;
export const REMINDER_STEP_MS = 30 * DAY_MS;
/** Bounds the step suffix of the private ID. */
export const PROOF_MAX_REMINDER_STEP = 9_999;

export const proofReminderId = (galleryId: string, step: number) => `proofReminder.${galleryId}.${step}`;

function canonicalInstant(value: unknown): number | undefined {
  if (typeof value !== "string" || value.length > 30) return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value ? time : undefined;
}

export type ReminderTerms = Readonly<{
  revision: string; keyHash: string; ciphertext: unknown; firstPublishedAt: number; delayDays: number;
  customerEmail: string; locale: string; resumeAfter?: number;
}>;
export type ReminderTermsRead =
  | Readonly<{ kind: "on"; terms: ReminderTerms }>
  | Readonly<{ kind: "off" }>
  /** Reminders are on but cannot be sent as configured; Studio lists such galleries. Nothing is guessed. */
  | Readonly<{ kind: "misconfigured" }>;

export function parseReminderTerms(value: unknown, galleryId: string, locales: readonly string[]): ReminderTermsRead {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { kind: "misconfigured" };
  const row = value as Record<string, unknown>;
  if (row._id !== proofTermsDocumentId(galleryId) || row._type !== "clientProofTerms" || row.galleryId !== galleryId ||
    typeof row._rev !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(row._rev)) return { kind: "misconfigured" };
  if (row.reminderDelayDays == null) return { kind: "off" };
  const firstPublishedAt = canonicalInstant(row.firstPublishedAt);
  const resumeAfter = row.reminderResumeAfter == null ? undefined : canonicalInstant(row.reminderResumeAfter);
  const delayDays = row.reminderDelayDays;
  if (firstPublishedAt === undefined || (row.reminderResumeAfter != null && resumeAfter === undefined) ||
    !Number.isSafeInteger(delayDays) || (delayDays as number) < 1 || (delayDays as number) > PROOF_MAX_REMINDER_DAYS ||
    !isProofCustomerEmail(row.customerEmail) || !isProofLocaleTag(row.customerLocale) || !locales.includes(row.customerLocale) ||
    typeof row.selectionKeyHash !== "string" || !/^[a-f0-9]{64}$/u.test(row.selectionKeyHash)) return { kind: "misconfigured" };
  return { kind: "on", terms: {
    revision: row._rev, keyHash: row.selectionKeyHash, ciphertext: row.selectionKeyCiphertext, firstPublishedAt, delayDays: delayDays as number,
    customerEmail: row.customerEmail, locale: row.customerLocale, ...(resumeAfter === undefined ? {} : { resumeAfter }),
  } };
}

/** The latest due step, or `undefined` when none is due or the resume cutoff holds it back. */
export function dueReminderStep(terms: Pick<ReminderTerms, "firstPublishedAt" | "delayDays" | "resumeAfter">, now: number): Readonly<{ step: number; dueAt: number }> | undefined {
  const first = terms.firstPublishedAt + terms.delayDays * DAY_MS;
  if (now < first) return undefined;
  const step = Math.floor((now - first) / REMINDER_STEP_MS) + 1;
  const dueAt = first + (step - 1) * REMINDER_STEP_MS;
  if (step > PROOF_MAX_REMINDER_STEP || (terms.resumeAfter !== undefined && dueAt <= terms.resumeAfter)) return undefined;
  return { step, dueAt };
}

/** A confirmed version, ever: the only selection state that stops reminders for good. */
export function selectionEverConfirmed(selection: unknown): boolean {
  if (selection === null || selection === undefined) return false;
  if (typeof selection !== "object" || Array.isArray(selection)) return true; // unreadable: never remind on a guess
  const row = selection as Record<string, unknown>;
  return row.state !== "open" || !Number.isSafeInteger(row.latestVersion) || (row.latestVersion as number) !== 0;
}

/**
 * Claims step n once: `create` fails if any run already holds it, and the terms
 * patch fails if a confirmation, rotation, settings change, stop or
 * publication touched the terms after they were read.
 */
export function planReminderClaim(galleryId: string, terms: ReminderTerms, step: number, dueAt: number, now: string): readonly Record<string, unknown>[] {
  return [
    { create: { _id: proofReminderId(galleryId, step), _type: PROOF_REMINDER_TYPE, galleryId, step, dueAt: new Date(dueAt).toISOString(), state: "pending", createdAt: now } },
    { patch: { id: proofTermsDocumentId(galleryId), ifRevisionID: terms.revision, set: { lastReminderClaimAt: now } } },
  ];
}

/** The fields whose change after the claim cancels the send. */
export function reminderSettingsUnchanged(before: ReminderTerms, after: ReminderTermsRead): boolean {
  return after.kind === "on" && after.terms.keyHash === before.keyHash && after.terms.customerEmail === before.customerEmail &&
    after.terms.locale === before.locale && after.terms.delayDays === before.delayDays && after.terms.resumeAfter === before.resumeAfter;
}

const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/gu, (match, name: string) => name in values ? String(values[name]) : match);

/** The customer's message in their language; links carry the locale before the fragment key. */
export function proofReminderEmail(input: Readonly<{
  canonicalBase: URL; handle: string; key: string; locale: string; defaultLocale: string; title?: string; firstPublishedAt: number;
}>, labels: BuiltInLabels["proofReminder"]): { subject: string; text: string } {
  const query = input.locale === input.defaultLocale ? "" : `?${new URLSearchParams({ locale: input.locale })}`;
  const page = new URL(`/client-proof/${input.handle}${query}`, input.canonicalBase).toString();
  const stop = new URL(`/client-proof/${input.handle}/reminders${query}`, input.canonicalBase).toString();
  const values = { title: input.title ?? labels.untitled, published: formatUtcDateTime(new Date(input.firstPublishedAt).toISOString(), input.locale) };
  return {
    subject: fill(labels.subject, values),
    text: [
      fill(labels.greeting, values), "", labels.notConfirmed, "", labels.select, `${page}#select=${input.key}`, "",
      labels.possession, "", labels.stop, `${stop}#select=${input.key}`, labels.reply,
    ].join("\n"),
  };
}
