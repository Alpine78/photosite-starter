/**
 * The project's authenticated keyset-pagination cursor codec.
 *
 * Extracted from `gallery-pagination.ts` (AB#67) when a second bounded listing —
 * the category branch listing (AB#140, ADR-0013) — needed the same opaque,
 * HMAC-signed "continue after this boundary key" token. The mechanism is generic:
 * a signed blob carrying a scope digest, a visibility digest, and the boundary
 * key pair `(afterKey, afterId)`. Only the *type names* used to be gallery-shaped.
 *
 * A cursor is `<base64url(payload)>.<base64url(HMAC-SHA256(payload))>`. The
 * signature covers the whole encoded payload, so neither boundary field can be
 * edited, nor recombined with another cursor's scope digest, without
 * invalidating it. `afterKey`/`afterId` travel in plaintext inside the payload
 * because a caller building a bounded store query needs the real boundary
 * values, not an opaque hash of them; the scope and visibility digests stay
 * one-way because nothing outside this module ever needs their raw inputs back.
 *
 * `afterKey` is `string | number` so a caller whose primary sort key is a
 * number (a gallery's manual `order`) and one whose primary sort key is a
 * string (a listing's verbatim `publishedAt`, which the store orders and
 * tie-break-compares as a string) share one wire format. The JSON field name
 * stays `afterOrder` for wire compatibility with cursors AB#67 already issued.
 *
 * This module deliberately carries no `server-only` marker: like
 * `gallery-pagination.ts`, it is imported by browser-free contract tests. The
 * deployment wrappers that resolve the signing key from the environment
 * (`gallery-cursor.ts`, `content-listing-cursor.ts`) are the ones that carry it.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const MAX_KEYSET_CURSOR_LENGTH = 2048;
export const MAX_KEYSET_SCOPE_FIELD_LENGTH = 256;
export const MAX_KEYSET_ID_LENGTH = 256;

/** Wire format version. Bumping it retires every issued cursor at once. */
const CURSOR_VERSION = 2;
const BASE64URL_SEGMENT = /^[A-Za-z0-9_-]+$/;
const SHA_256_BASE64URL_LENGTH = 43;

/**
 * What a cursor is bound to. Two cursors with different scopes can never be
 * spent against each other: every field here feeds a digest the signature
 * covers.
 */
export type KeysetCursorScope = {
  /** Stable project source identity, not a provider document id. */
  readonly sourceId: string;
  /** Canonical filter key; the caller filters candidates before this. */
  readonly normalizedFilter: string;
  /** Stable ordering rule and rule version, for example `manual-v1`. */
  readonly ordering: string;
  /**
   * Bumped when a change can move a candidate across an issued boundary key —
   * a reorder, a hide/show, a section reassignment, or (for a listing keyed on
   * an authored date) an edit to that date anywhere in scope. An append or a
   * presentation-only edit deliberately keeps the same version. Bumping it is
   * what keeps an in-flight keyset walk coherent instead of silently skipping
   * or repeating an item.
   */
  readonly visibilityVersion: string;
  readonly pageSize: number;
};

export type KeysetCursorErrorCode =
  | "malformed"
  | "tampered"
  | "wrong-scope"
  | "stale";

export class KeysetCursorError extends Error {
  readonly code: KeysetCursorErrorCode;

  constructor(code: KeysetCursorErrorCode) {
    super(`Keyset cursor is ${code}`);
    this.name = "KeysetCursorError";
    this.code = code;
  }
}

/** The boundary a decoded cursor names: "continue strictly after this pair". */
export type DecodedKeysetCursor = {
  readonly afterKey: string | number;
  readonly afterId: string;
};

/**
 * Replaceable adapter-owned codec. A caller authenticates and bounds an
 * untrusted token before acting on the boundary key it returns; the boundary is
 * still validated again against the ordering rule before it reaches a query.
 */
export type KeysetCursorCodec = {
  readonly encode: (
    scope: KeysetCursorScope,
    afterKey: string | number,
    afterId: string,
  ) => string;
  readonly decode: (
    cursor: unknown,
    scope: KeysetCursorScope,
  ) => DecodedKeysetCursor;
};

type CursorPayload = {
  readonly version: typeof CURSOR_VERSION;
  readonly queryScope: string;
  readonly visibilityScope: string;
  /** Wire name kept from AB#67; now `string | number`. */
  readonly afterOrder: string | number;
  /** Wire name kept from AB#67. */
  readonly afterPlacementId: string;
};

const cursorPayloadKeys = [
  "version",
  "queryScope",
  "visibilityScope",
  "afterOrder",
  "afterPlacementId",
] as const satisfies readonly (keyof CursorPayload)[];

export function assertBoundedString(
  value: unknown,
  field: string,
  maxLength = MAX_KEYSET_SCOPE_FIELD_LENGTH,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength
  ) {
    throw new TypeError(`${field} must be a non-empty bounded string`);
  }
}

export function assertKeysetSigningKey(signingKey: string): void {
  if (
    typeof signingKey !== "string" ||
    signingKey.length < 32 ||
    signingKey.length > 256 ||
    !/^[\x21-\x7e]+$/.test(signingKey)
  ) {
    throw new Error("Keyset cursor signing key is not configured securely");
  }
}

/** Whether a decoded `afterKey` is one of the two shapes the wire allows. */
function isValidAfterKey(value: unknown): value is string | number {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0;
  }
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_KEYSET_SCOPE_FIELD_LENGTH
  );
}

function cursorSignature(payload: string, signingKey: string): Buffer {
  return createHmac("sha256", signingKey)
    .update("gallery-cursor-token-v1")
    .update("\0")
    .update(payload)
    .digest();
}

function scopeDigest(
  label: string,
  values: readonly (string | number)[],
  signingKey: string,
): string {
  return createHmac("sha256", signingKey)
    .update(label)
    .update("\0")
    .update(JSON.stringify(values))
    .digest("base64url");
}

function matchesDigest(encodedDigest: string, expectedDigest: string): boolean {
  const supplied = Buffer.from(encodedDigest, "base64url");
  const expected = Buffer.from(expectedDigest, "base64url");
  return (
    supplied.length === expected.length && timingSafeEqual(supplied, expected)
  );
}

function queryScopeDigest(
  scope: KeysetCursorScope,
  signingKey: string,
): string {
  return scopeDigest(
    "gallery-query-scope-v1",
    [scope.sourceId, scope.normalizedFilter, scope.ordering, scope.pageSize],
    signingKey,
  );
}

function visibilityScopeDigest(
  scope: KeysetCursorScope,
  signingKey: string,
): string {
  return scopeDigest(
    "gallery-visibility-scope-v1",
    [scope.sourceId, scope.visibilityVersion],
    signingKey,
  );
}

/**
 * `{version, queryScope, visibilityScope, afterOrder, afterPlacementId}` as one
 * HMAC-signed blob. The digest labels and `cursorSignature`'s domain string
 * keep their AB#67 `gallery-` prefixes on purpose: a wire-format change would
 * retire cursors already issued and indexed, and this extraction is not one.
 */
function encodeHmacCursor(
  scope: KeysetCursorScope,
  afterKey: string | number,
  afterId: string,
  signingKey: string,
): string {
  const cursorPayload: CursorPayload = {
    version: CURSOR_VERSION,
    queryScope: queryScopeDigest(scope, signingKey),
    visibilityScope: visibilityScopeDigest(scope, signingKey),
    afterOrder: afterKey,
    afterPlacementId: afterId,
  };
  const encodedPayload = Buffer.from(JSON.stringify(cursorPayload)).toString(
    "base64url",
  );
  const signature = cursorSignature(encodedPayload, signingKey).toString(
    "base64url",
  );

  return `${encodedPayload}.${signature}`;
}

function parseHmacCursor(
  cursor: unknown,
  scope: KeysetCursorScope,
  signingKey: string,
): DecodedKeysetCursor {
  if (
    typeof cursor !== "string" ||
    cursor.length === 0 ||
    cursor.length > MAX_KEYSET_CURSOR_LENGTH
  ) {
    throw new KeysetCursorError("malformed");
  }

  const parts = cursor.split(".");
  if (parts.length !== 2) {
    throw new KeysetCursorError("malformed");
  }

  const [encodedPayload, encodedSignature] = parts;
  if (
    !BASE64URL_SEGMENT.test(encodedPayload) ||
    !BASE64URL_SEGMENT.test(encodedSignature) ||
    encodedSignature.length !== SHA_256_BASE64URL_LENGTH
  ) {
    throw new KeysetCursorError("malformed");
  }

  const suppliedSignature = Buffer.from(encodedSignature, "base64url");
  const expectedSignature = cursorSignature(encodedPayload, signingKey);
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    throw new KeysetCursorError("tampered");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    throw new KeysetCursorError("malformed");
  }

  if (!isCursorPayload(payload)) {
    throw new KeysetCursorError("malformed");
  }
  if (!matchesDigest(payload.queryScope, queryScopeDigest(scope, signingKey))) {
    throw new KeysetCursorError("wrong-scope");
  }
  if (
    !matchesDigest(
      payload.visibilityScope,
      visibilityScopeDigest(scope, signingKey),
    )
  ) {
    throw new KeysetCursorError("stale");
  }

  return {
    afterKey: payload.afterOrder,
    afterId: payload.afterPlacementId,
  };
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const payload = value as Record<string, unknown>;
  const keys = Object.keys(payload);
  return (
    keys.length === cursorPayloadKeys.length &&
    cursorPayloadKeys.every((key) => Object.hasOwn(payload, key)) &&
    payload.version === CURSOR_VERSION &&
    typeof payload.queryScope === "string" &&
    BASE64URL_SEGMENT.test(payload.queryScope) &&
    payload.queryScope.length === SHA_256_BASE64URL_LENGTH &&
    typeof payload.visibilityScope === "string" &&
    BASE64URL_SEGMENT.test(payload.visibilityScope) &&
    payload.visibilityScope.length === SHA_256_BASE64URL_LENGTH &&
    isValidAfterKey(payload.afterOrder) &&
    typeof payload.afterPlacementId === "string" &&
    payload.afterPlacementId.length > 0 &&
    payload.afterPlacementId.length <= MAX_KEYSET_ID_LENGTH
  );
}

/**
 * Reference authenticated codec. The signing key is supplied by a deployment
 * wrapper; this module does not read the environment.
 */
export function createHmacKeysetCursorCodec(
  signingKey: string,
): KeysetCursorCodec {
  assertKeysetSigningKey(signingKey);

  return {
    encode: (scope, afterKey, afterId) =>
      encodeHmacCursor(scope, afterKey, afterId, signingKey),
    decode: (cursor, scope) => parseHmacCursor(cursor, scope, signingKey),
  };
}

/**
 * The `SITE_*` settings are validated at build time; a cursor signing key
 * deliberately is not. It is a request-time credential (a Vercel *Sensitive*
 * value that reaches `next build` as the literal `[SENSITIVE]`), nothing at
 * build time issues a cursor, and it must be one stable value per environment —
 * a per-boot key would 404 a cursor the moment another serverless instance
 * handled the next request. Rotating it retires every issued and indexed
 * continuation URL at once, which is a deliberate, documented act.
 *
 * `gallery-cursor.ts` and `content-listing-cursor.ts` both resolve the same
 * `GALLERY_CURSOR_SIGNING_KEY` through this loader (owner decision, AB#140:
 * one shared secret, not a second one). They validate the environment the same
 * way `loadDeploymentConfig` does, so a test can pass one in directly.
 */
export const KEYSET_CURSOR_SIGNING_KEY_SETTING = "GALLERY_CURSOR_SIGNING_KEY";

export type KeysetCursorEnvironment = Record<string, string | undefined>;

export class KeysetCursorConfigurationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "KeysetCursorConfigurationError";
  }
}

/**
 * The raw signing key for this environment, or a `KeysetCursorConfigurationError`
 * naming what is wrong. Callers turn it into a codec with
 * `createHmac*CursorCodec`; keeping key resolution and codec construction
 * separate is what lets each cursor family report an invalid key in its own
 * words while sharing the environment contract.
 */
export function loadKeysetCursorSigningKey(
  environment: KeysetCursorEnvironment,
): string {
  const setting = KEYSET_CURSOR_SIGNING_KEY_SETTING;

  // Refused rather than ignored: Next.js compiles a `NEXT_PUBLIC_` value into
  // the browser bundle, and a signing key published to every visitor lets
  // anyone mint cursors this deployment would accept.
  const publicName = `NEXT_PUBLIC_${setting}`;
  if (environment[publicName] !== undefined) {
    throw new KeysetCursorConfigurationError(
      `Invalid ${publicName}: a NEXT_PUBLIC_ prefixed value is compiled into the browser bundle, so the cursor signing key must never be set under that name. Remove it and set ${setting} instead.`,
    );
  }

  const signingKey = environment[setting];
  if (signingKey === undefined || signingKey.length === 0) {
    throw new KeysetCursorConfigurationError(
      `Missing ${setting}: a gallery or a category branch larger than one page issues a continuation cursor, which this deployment signs with its own key. Set one stable secret value per environment — rotating it retires every continuation URL already issued and indexed.`,
    );
  }

  return signingKey;
}
