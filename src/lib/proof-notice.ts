/**
 * The photographer's notice for a confirmed proof selection (ADR-0038 decision 6,
 * action item 4, AB#130).
 *
 * After a confirmation commits, one email goes to the site owner's mailbox with
 * everything needed to act on it, built only from the immutable version, so a
 * later gallery or terms edit cannot change it. The notice record then becomes
 * `sent` or `failed` under its revision. A notice the process never updated stays
 * `pending`, and Studio lists it after a few minutes. Every send for one version
 * uses the same provider idempotency key and the same text (the confirmation
 * time, never the send time), so a duplicate attempt within the provider's 24
 * hours is not delivered twice. A failed or lost email never undoes the
 * confirmation, and nothing is resent automatically (owner answer 2).
 */
import "server-only";
import { formatUtcDateTime } from "@/lib/date-format";
import type { BuiltInLabels } from "@/lib/deployment-config";
import type { ContactDeliveryErrorClass, ContactDeliveryOutcome } from "@/lib/contact-delivery";
import { PROOF_GALLERY_MAX_ITEMS } from "@/lib/proof-gallery-model";
import { isProofReference } from "@/lib/proof-references";
import { parseConfirmedVersion, PROOF_NOTICE_TYPE, proofNoticeId, proofVersionId } from "@/lib/proof-selection";
import { PROOF_CURRENCIES, PROOF_JOB_REFERENCE_MAX } from "@/lib/proof-terms";

export class ProofNoticeDataError extends Error {
  constructor() { super("Malformed proof notice record"); this.name = "ProofNoticeDataError"; }
}
function invalid(): never { throw new ProofNoticeDataError(); }
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
}
function plain(value: unknown, max: number): string {
  return typeof value === "string" && value.length >= 1 && value.length <= max && !/[\u0000-\u001f\u007f]/u.test(value) ? value : invalid();
}

export type NoticeContent = Readonly<{
  galleryId: string; version: number; confirmedAt: string; jobReference: string;
  includedCount: number; selectedCount: number; extraCount: number;
  extraUnitPriceMinor: number; extraTotalMinor: number; currency: string;
  items: readonly Readonly<{ reference: string; originalFilename: string }>[];
}>;

/** What the email may say, validated from the immutable version; nothing partial. */
export function noticeContent(value: unknown, galleryId: string, version: number): NoticeContent {
  try {
    const confirmed = parseConfirmedVersion(value, galleryId, version);
    const row = record(value), terms = record(row.terms);
    if (!Array.isArray(row.items) || row.items.length > PROOF_GALLERY_MAX_ITEMS) return invalid();
    const seen = new Set<string>();
    const items = row.items.map((entry) => {
      const item = record(entry);
      if (!isProofReference(item.reference) || seen.has(item.reference)) return invalid();
      seen.add(item.reference);
      return { reference: item.reference, originalFilename: plain(item.originalFilename, 255) };
    }).sort((left, right) => Number(left.reference) - Number(right.reference));
    return {
      galleryId, version, confirmedAt: confirmed.confirmedAt, jobReference: plain(terms.jobReference, PROOF_JOB_REFERENCE_MAX),
      includedCount: confirmed.includedCount, selectedCount: confirmed.selectedCount, extraCount: confirmed.extraCount,
      extraUnitPriceMinor: confirmed.extraUnitPriceMinor, extraTotalMinor: confirmed.extraTotalMinor, currency: confirmed.currency, items,
    };
  } catch {
    return invalid();
  }
}

function money(minor: number, currency: string): string {
  const digits = PROOF_CURRENCIES[currency] ?? 2;
  const whole = Math.trunc(minor / 10 ** digits), fraction = String(minor % 10 ** digits).padStart(digits, "0");
  return digits === 0 ? String(whole) : `${whole}.${fraction}`;
}
const fill = (text: string, values: Record<string, string | number>) => text.replace(/\{(\w+)\}/gu, (match, name: string) => name in values ? String(values[name]) : match);

/** Deterministic per version and locale: the same input always gives the same subject and text. */
export function proofNoticeEmail(content: NoticeContent, labels: BuiltInLabels["proofNotice"], locale: string): { subject: string; text: string } {
  const values = {
    gallery: content.galleryId, job: content.jobReference, version: content.version, date: formatUtcDateTime(content.confirmedAt, locale),
    included: content.includedCount, selected: content.selectedCount, extra: content.extraCount,
    price: money(content.extraUnitPriceMinor, content.currency), total: money(content.extraTotalMinor, content.currency), currency: content.currency,
  };
  return {
    subject: fill(labels.subject, values),
    text: [
      labels.intro, "", fill(labels.gallery, values), fill(labels.job, values), fill(labels.version, values), fill(labels.confirmedAt, values),
      fill(labels.counts, values), fill(labels.price, values), "", labels.proofs,
      ...content.items.map((item) => `${item.reference} — ${item.originalFilename}`), "", labels.studio,
    ].join("\n"),
  };
}

export const proofNoticeIdempotencyKey = (galleryId: string, version: number) => `proof-notice/${galleryId}/v${version}`;

export type ProofNoticeSender = (email: { subject: string; text: string }, idempotencyKey: string) => Promise<ContactDeliveryOutcome>;
export type ProofNoticeOutcome =
  | "sent" | "failed" | "not-pending"
  /** The send happened or may have; the notice could not be updated and stays pending. */
  | "unrecorded";

/**
 * Sends the notice for one committed version and records the result. Returns a
 * closed class for the log; never throws, so it cannot change the customer's
 * answer.
 */
export async function deliverProofNotice(galleryId: string, version: number, dependencies: Readonly<{
  read: (id: string) => Promise<unknown>;
  commit: (mutations: readonly Record<string, unknown>[]) => Promise<void>;
  send: ProofNoticeSender;
  labels: BuiltInLabels["proofNotice"]; locale: string; now: () => string;
}>): Promise<Readonly<{ outcome: ProofNoticeOutcome; errorClass?: ContactDeliveryErrorClass | "malformed-record" | "store-unavailable" }>> {
  const noticeId = proofNoticeId(galleryId, version);
  let raw: unknown;
  try { raw = await dependencies.read(noticeId); } catch { return { outcome: "unrecorded", errorClass: "store-unavailable" }; }
  const notice = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
  if (!notice || notice._id !== noticeId || notice._type !== PROOF_NOTICE_TYPE || notice.galleryId !== galleryId || notice.version !== version ||
    typeof notice._rev !== "string") return { outcome: "unrecorded", errorClass: "malformed-record" };
  if (notice.state !== "pending") return { outcome: "not-pending" };
  const revision = notice._rev;
  const record_ = async (set: Record<string, unknown>) => {
    try {
      await dependencies.commit([{ patch: { id: noticeId, ifRevisionID: revision, set: { ...set, attemptedAt: dependencies.now() } } }]);
      return true;
    } catch {
      return false;
    }
  };
  let email: { subject: string; text: string };
  try {
    email = proofNoticeEmail(noticeContent(await dependencies.read(proofVersionId(galleryId, version)), galleryId, version), dependencies.labels, dependencies.locale);
  } catch {
    // Nothing partial is ever sent; the record says why.
    return await record_({ state: "failed", errorClass: "malformed-record" })
      ? { outcome: "failed", errorClass: "malformed-record" } : { outcome: "unrecorded", errorClass: "malformed-record" };
  }
  let delivered: ContactDeliveryOutcome;
  try {
    delivered = await dependencies.send(email, proofNoticeIdempotencyKey(galleryId, version));
  } catch {
    delivered = { status: "failed", errorClass: "provider-unavailable", retryable: true };
  }
  if (delivered.status === "delivered") {
    return await record_({ state: "sent" }) ? { outcome: "sent" } : { outcome: "unrecorded" };
  }
  return await record_({ state: "failed", errorClass: delivered.errorClass })
    ? { outcome: "failed", errorClass: delivered.errorClass } : { outcome: "unrecorded", errorClass: delivered.errorClass };
}
