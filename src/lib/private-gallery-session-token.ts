/**
 * The opaque-bearer primitives the customer and administrator session models
 * both stand on: minting a session identifier, deciding whether an incoming one
 * is canonical, hashing it for storage, and reading exactly one named cookie out
 * of a raw `Cookie` header.
 *
 * **Shared code, deliberately no shared state.** ADR-0015 §2 gives the
 * administrator session "the same *shape* as the customer session, deliberately
 * reusing a reviewed design, and none of its state". The shape is this file. The
 * state — identifiers, hashes, rows, cookies, lifetimes — stays entirely inside
 * `private-gallery-session.ts` and `private-gallery-admin-session.ts`, which
 * share no store, no cookie name, and no session row.
 *
 * These are extracted rather than copied because they are the part where a
 * silent divergence would matter and nobody would notice: a second copy that
 * drifted to a shorter identifier, a looser character class, or a skipped
 * canonical-encoding check would still pass every test written against it.
 *
 * Nothing here throws a *classified* error. Each session model owns its own
 * failure vocabulary, so these report with a boolean or a neutral `TypeError`
 * and let the caller raise the error its own route knows how to answer.
 */

import "server-only";

import { createHash, randomBytes } from "node:crypto";

/** 256 bits — ADR-0014 §3's recommendation, above its 128-bit floor. */
export const PRIVATE_GALLERY_SESSION_ID_BYTES = 32;

/** 32 bytes as unpadded base64url is exactly 43 characters. */
const SESSION_ID_CHARS = 43;

const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;

/**
 * A fresh 256-bit CSPRNG session identifier, unpadded base64url. The only point
 * a raw identifier is produced; after it leaves in a `Set-Cookie` the server
 * keeps only {@link hashSessionId}'s digest.
 */
export function generateSessionId(): string {
  return randomBytes(PRIVATE_GALLERY_SESSION_ID_BYTES).toString("base64url");
}

/**
 * Whether a value is exactly what {@link generateSessionId} produces: 43
 * canonical unpadded-base64url characters decoding to 32 bytes.
 *
 * The round trip matters as much as the character class. Base64 has redundant
 * final characters, so several distinct 43-character strings decode to the same
 * 32 bytes; without re-encoding and comparing, a non-canonical spelling of a
 * real identifier would hash differently and — depending on what a store does
 * with it — could turn one session into several rows or slip past a check that
 * assumed one encoding.
 *
 * Callers run this on an incoming cookie *before* hashing or a store lookup, so
 * a malformed cookie costs nothing and is simply "not a session".
 */
export function isCanonicalSessionId(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length !== SESSION_ID_CHARS ||
    !UNPADDED_BASE64URL.test(value)
  ) {
    return false;
  }
  const decoded = Buffer.from(value, "base64url");
  return (
    decoded.length === PRIVATE_GALLERY_SESSION_ID_BYTES &&
    decoded.toString("base64url") === value
  );
}

/**
 * The digest a session store keeps. **Unsalted on purpose:** the identifier is
 * already a uniformly random 256-bit bearer, so this is not a password hash;
 * and "hash the cookie value and match" has to work across instances and
 * deployments, which a per-instance salt could not. The entropy lives in the
 * identifier; the store holds only this.
 *
 * Throws a plain `TypeError` for a non-canonical input. Both callers check with
 * {@link isCanonicalSessionId} first and raise their own classified error, so
 * this is a backstop against a future caller that forgets — never the path a
 * malformed cookie actually takes.
 */
export function hashSessionId(sessionId: string): string {
  if (!isCanonicalSessionId(sessionId)) {
    throw new TypeError(
      "[private-gallery-session-token] refusing to hash a non-canonical session identifier",
    );
  }
  return createHash("sha256").update(sessionId).digest("base64url");
}

/** What a raw `Cookie` header held for one name. */
export type SingleCookieRead =
  | { readonly kind: "none" }
  | { readonly kind: "one"; readonly value: string }
  | { readonly kind: "duplicate" };

/**
 * Reads the one cookie called `name` out of a raw `Cookie` request header.
 *
 * Reports `duplicate` rather than picking a winner when the header carries the
 * name more than once. A name-keyed parser — the framework's own cookie
 * accessor included — has already collapsed such a pair by the time it is asked,
 * and *which* one it kept is not something a security decision should rest on.
 * The caller reads the raw header through this instead, and refuses.
 *
 * Quoted values are unwrapped (RFC 6265 permits `name="value"`), and a segment
 * with no `=` is skipped rather than treated as an empty value.
 */
export function readSingleCookie(
  cookieHeader: string | null | undefined,
  name: string,
): SingleCookieRead {
  if (!cookieHeader) return { kind: "none" };

  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;

    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    values.push(value);
  }

  if (values.length === 0) return { kind: "none" };
  if (values.length > 1) return { kind: "duplicate" };
  return { kind: "one", value: values[0] as string };
}
