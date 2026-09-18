/** Browser-free eligibility policy. IO performs the receipt and tally in one transaction. */

import { isPollIdentity, isPollCloseDate } from "./poll";
import type { ContactRejectionReason } from "./contact-request";

export interface PollOptionSnapshot {
  readonly optionId: string;
}

/** The minimum a caller must know about a poll to decide whether a vote may be attempted. */
export interface PollSnapshot {
  readonly pollId: string;
  /** ISO instant. A poll is closed once `now() >= closeDate` (ADR-0017's read-time gate shape, one level down). */
  readonly closeDate: string;
  readonly options: readonly PollOptionSnapshot[];
}

export type PollVoteRejectionReason =
  /** `pollId`/`optionId` failed the shared public-identity grammar — not a lookup failure, a shape failure. */
  | "malformed-request"
  /** No poll snapshot was supplied — the caller could not find this pollId at all. */
  | "unknown-poll"
  /** The poll exists but does not offer this optionId. */
  | "unknown-option"
  /** `now() >= poll.closeDate`. */
  | "closed";

export type PollVoteRequestDecision =
  | { readonly outcome: "eligible"; readonly pollId: string; readonly optionId: string }
  | { readonly outcome: "reject"; readonly reason: PollVoteRejectionReason };

/**
 * Whether a vote attempt may proceed to the atomic receipt-and-increment step.
 * `poll` is `undefined` exactly when the caller's own lookup found no poll —
 * this function never performs that lookup itself, so a caller cannot get the
 * "unknown poll" answer without actually having tried.
 */
export function decidePollVoteRequest(
  request: { readonly pollId: unknown; readonly optionId: unknown },
  poll: PollSnapshot | undefined,
  now: Date,
): PollVoteRequestDecision {
  const { pollId, optionId } = request;
  if (typeof pollId !== "string" || typeof optionId !== "string" || !isPollIdentity(pollId) || !isPollIdentity(optionId)) {
    return { outcome: "reject", reason: "malformed-request" };
  }
  if (poll === undefined || poll.pollId !== pollId) {
    return { outcome: "reject", reason: "unknown-poll" };
  }
  if (!isPollCloseDate(poll.closeDate) || !Number.isFinite(now.getTime())) {
    throw new TypeError("Invalid poll close date or current instant");
  }
  if (now.getTime() >= Date.parse(poll.closeDate)) {
    return { outcome: "reject", reason: "closed" };
  }
  if (!poll.options.some((option) => option.optionId === optionId)) {
    return { outcome: "reject", reason: "unknown-option" };
  }
  return { outcome: "eligible", pollId, optionId };
}

export type PollVoteReceiptOutcome = "recorded" | "already-voted";

/**
 * Every value a poll-vote operational event's `errorClass` may take
 * (`contact-log.ts#PollVoteEvent`): the request-level rejections above, plus
 * `store-unavailable` for a Sanity transport failure the caller may retry and
 * `internal` for anything else — the same two-tier "specific class in the
 * log, generic answer to the browser" shape `classifyEnquiryFailure` already
 * uses.
 */
export type PollVoteErrorClass = PollVoteRejectionReason | ContactRejectionReason | "store-unavailable" | "internal";

