/** Server-side poll identities. Receipts hash the poll+token pair, keeping raw cookies out of a public dataset and IDs below Sanity's 128-character limit. */

import { createHash, randomBytes } from "node:crypto";
import { isPollIdentity } from "./poll";

/** 256 bits, matching the private-gallery session id's own margin above ADR-0014 §3's 128-bit floor. */
export const POLL_VISITOR_TOKEN_BYTES = 32;

/** 32 bytes as unpadded base64url is exactly 43 characters. */
const VISITOR_TOKEN_CHARS = 43;

const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;

/** A fresh CSPRNG token; only canonical tokens are accepted back through the cookie. */
export function generatePollVisitorToken(): string {
  return randomBytes(POLL_VISITOR_TOKEN_BYTES).toString("base64url");
}

/**
 * Whether `value` is exactly what {@link generatePollVisitorToken} produces:
 * 43 canonical unpadded-base64url characters decoding to 32 bytes. The round
 * trip matters as much as the character class — several 43-character strings
 * decode to the same 32 bytes, and without re-encoding and comparing, a
 * non-canonical spelling would build a *different* receipt id for the same
 * underlying bytes, silently defeating dedup for that one visitor.
 */
export function isCanonicalPollVisitorToken(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== VISITOR_TOKEN_CHARS || !UNPADDED_BASE64URL.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return decoded.length === POLL_VISITOR_TOKEN_BYTES && decoded.toString("base64url") === value;
}

/**
 * The one, Studio-invisible document a poll's live counts live in
 * (ADR-0018 §2). Throws for a malformed `pollId` — this function is the
 * boundary between "an authored poll identity" and "a document address", and
 * a malformed identity must not silently produce *some* address.
 */
export function pollTallyDocumentId(pollId: string): string {
  if (!isPollIdentity(pollId)) {
    throw new TypeError(`pollTallyDocumentId: not a valid pollId: ${JSON.stringify(pollId)}`);
  }
  return `pollTally-${pollId}`;
}

/**
 * The one, Studio-invisible document that makes one `(pollId, visitorToken)`
 * pair a fact a plain `create`'s 409-on-conflict can enforce atomically (ADR-0018 §4). Both
 * inputs are validated — a malformed token here would otherwise let a caller
 * synthesize a document id that collides with, or is indistinguishable from,
 * a real one.
 */
export function pollVoteReceiptDocumentId(pollId: string, visitorToken: string): string {
  if (!isPollIdentity(pollId)) {
    throw new TypeError(`pollVoteReceiptDocumentId: not a valid pollId: ${JSON.stringify(pollId)}`);
  }
  if (!isCanonicalPollVisitorToken(visitorToken)) {
    throw new TypeError(`pollVoteReceiptDocumentId: not a canonical visitor token: ${JSON.stringify(visitorToken)}`);
  }
  return `pollVote-${createHash("sha256").update(JSON.stringify([pollId, visitorToken])).digest("hex")}`;
}

/** A separate browser token for every poll; no token can link votes across polls. */
export function pollVoterCookieName(pollId: string): string {
  if (!isPollIdentity(pollId)) throw new TypeError("Invalid poll identity");
  return `poll_voter_${createHash("sha256").update(pollId).digest("hex").slice(0, 32)}`;
}
