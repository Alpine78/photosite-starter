/**
 * The server-side session for a private client gallery (ADR-0014 §3, §5
 * Stage 1) — the lifecycle and the cookie contract, over a store *seam*.
 *
 * The exchange endpoint (a later slice) turns a valid capability into a
 * session: it mints a CSPRNG identifier, stores **only that identifier's hash**,
 * and sets a cookie carrying the raw identifier and nothing else. Every later
 * private request re-authorizes on the cookie — there is no "the page loaded,
 * so it stays loaded" gap.
 *
 * `import "server-only"` plus the `eslint.config.mjs` import boundary keep
 * `src/app` and `src/components` from reaching this directly.
 *
 * Not here: the bootstrap/exchange routes, the rate limiters, the Postgres
 * `PrivateGallerySessionStore` adapter (with the *atomic* evict-oldest this
 * module's `create` contract describes but only a real transaction can
 * guarantee), and the retention worker that reaps expired rows (§7).
 */

import "server-only";

import { createHash, randomBytes } from "node:crypto";

import {
  isPrivateGalleryCustomerVisible,
  type PrivateGallery,
  type PrivateGallerySession,
} from "@/lib/private-gallery";

/** The session cookie name. `__Secure-` requires `Secure`; unlike `__Host-` it
 * allows the per-gallery `Path` the ADR's 2026-09-01 amendment fixes. */
export const PRIVATE_GALLERY_SESSION_COOKIE_NAME = "__Secure-pg_session";

/** ADR-0014 §3: `sessionTTL` is at most 7 days; a deployment may lower it. */
export const MAX_PRIVATE_GALLERY_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** ADR-0014 §3: per gallery, per capability generation. */
export const PRIVATE_GALLERY_ACTIVE_SESSION_CAP_DEFAULT = 50;
/** A configured cap above this is a mistake, not a policy. */
export const MAX_PRIVATE_GALLERY_ACTIVE_SESSION_CAP = 10_000;

/** 256 bits — ADR-0014 §3's recommendation, above its 128-bit floor. */
export const PRIVATE_GALLERY_SESSION_ID_BYTES = 32;
/** 32 bytes as unpadded base64url is exactly 43 characters. */
const SESSION_ID_CHARS = 43;

const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;
/** One lowercase path segment. */
const ROUTE_PREFIX = /^[a-z][a-z0-9-]*$/;
/** A gallery handle is itself unpadded base64url (ADR-0014 §3). */
const GALLERY_HANDLE = UNPADDED_BASE64URL;

export type PrivateGallerySessionErrorReason =
  | "invalid-parameter"
  | "invalid-session"
  | "expired-session"
  | "access-expired"
  | "gallery-unavailable"
  | "stale-generation"
  | "access-window-closed";

export class PrivateGallerySessionError extends Error {
  readonly reason: PrivateGallerySessionErrorReason;

  constructor(reason: PrivateGallerySessionErrorReason, message: string) {
    // Never interpolate a session id or its hash into a message.
    super(`[private-gallery-session] ${message}`);
    this.name = "PrivateGallerySessionError";
    this.reason = reason;
  }
}

function fail(
  reason: PrivateGallerySessionErrorReason,
  message: string,
): never {
  throw new PrivateGallerySessionError(reason, message);
}

function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

// ---------------------------------------------------------------------------
// Session identifier
// ---------------------------------------------------------------------------

/**
 * A fresh 256-bit CSPRNG session identifier, unpadded base64url. This is the
 * only point the raw value exists server-side after it leaves in a `Set-Cookie`.
 */
export function generatePrivateGallerySessionId(): string {
  return randomBytes(PRIVATE_GALLERY_SESSION_ID_BYTES).toString("base64url");
}

/**
 * Asserts a value is exactly what {@link generatePrivateGallerySessionId}
 * produces: 43 canonical unpadded-base64url characters decoding to 32 bytes.
 * Run on an incoming cookie value *before* hashing or a store lookup, so a
 * malformed cookie costs nothing and is simply "not a session".
 */
export function assertPrivateGallerySessionIdShape(value: unknown): void {
  if (
    typeof value !== "string" ||
    value.length !== SESSION_ID_CHARS ||
    !UNPADDED_BASE64URL.test(value)
  ) {
    fail("invalid-session", "the session identifier is malformed");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.length !== PRIVATE_GALLERY_SESSION_ID_BYTES ||
    decoded.toString("base64url") !== value
  ) {
    fail("invalid-session", "the session identifier is not canonically encoded");
  }
}

/**
 * The digest the store keeps. **Unsalted on purpose:** the identifier is
 * already a uniformly random 256-bit bearer, so this is not a password hash;
 * and "hash the cookie value and match" has to work across instances and
 * deployments, which a per-instance salt could not. The entropy lives in the
 * identifier; the store holds only this.
 */
export function hashPrivateGallerySessionId(sessionId: string): string {
  assertPrivateGallerySessionIdShape(sessionId);
  return createHash("sha256").update(sessionId).digest("base64url");
}

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

/**
 * A descriptor that maps directly onto Next's `ResponseCookie`
 * (`NextResponse.cookies.set(name, value, options)`). The framework owns the
 * wire format; this module does not serialize a `Set-Cookie` header, so the two
 * cannot drift. There is deliberately no `domain` — the cookie is host-only.
 */
export type PrivateGallerySessionCookie = {
  readonly name: typeof PRIVATE_GALLERY_SESSION_COOKIE_NAME;
  readonly value: string;
  readonly options: {
    /** Seconds. `0` clears the cookie. */
    readonly maxAge: number;
    readonly path: string;
    readonly secure: true;
    readonly httpOnly: true;
    readonly sameSite: "lax";
  };
};

/**
 * The per-gallery cookie path, `/<routePrefix>/<galleryHandle>` (ADR-0014 §3
 * amendment 2026-09-01). Built from validated parts, never a free-form string,
 * so nothing can inject a cookie attribute or widen the scope.
 */
export function buildPrivateGallerySessionCookiePath(parts: {
  readonly routePrefix: string;
  readonly galleryHandle: string;
}): string {
  const { routePrefix, galleryHandle } = parts;
  if (
    typeof routePrefix !== "string" ||
    routePrefix.length > 32 ||
    !ROUTE_PREFIX.test(routePrefix)
  ) {
    fail("invalid-parameter", "routePrefix is not one lowercase path segment");
  }
  if (
    typeof galleryHandle !== "string" ||
    galleryHandle.length === 0 ||
    galleryHandle.length > 128 ||
    !GALLERY_HANDLE.test(galleryHandle)
  ) {
    fail("invalid-parameter", "galleryHandle is not a base64url token");
  }
  return `/${routePrefix}/${galleryHandle}`;
}

function cookie(
  value: string,
  path: string,
  maxAge: number,
): PrivateGallerySessionCookie {
  return {
    name: PRIVATE_GALLERY_SESSION_COOKIE_NAME,
    value,
    options: {
      maxAge,
      path,
      secure: true,
      httpOnly: true,
      sameSite: "lax",
    },
  };
}

/** The `Set-Cookie` descriptor for a stale/expired session or an explicit logout. */
export function buildPrivateGallerySessionClearCookie(parts: {
  readonly routePrefix: string;
  readonly galleryHandle: string;
}): PrivateGallerySessionCookie {
  return cookie("", buildPrivateGallerySessionCookiePath(parts), 0);
}

/**
 * The single session-cookie value from a raw `Cookie` request header, or
 * `undefined` if there is none. **Refuses a request that carries more than one**
 * `__Secure-pg_session` pair (ADR-0014 §3 amendment 2026-09-01) — a host-only
 * cookie plus a cookie-tossed `Domain` sibling, say — rather than resolving to
 * whichever one a name-keyed parser kept. The route must read the raw header
 * (`request.headers.get("cookie")`) through this before calling
 * {@link readPrivateGallerySession}; the framework's own cookie accessor has
 * already collapsed the duplicate by the time it is asked by name.
 */
export function extractPrivateGallerySessionCookie(
  cookieHeader: string | null | undefined,
): string | undefined {
  if (!cookieHeader) return undefined;
  const values: string[] = [];
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== PRIVATE_GALLERY_SESSION_COOKIE_NAME) {
      continue;
    }
    let value = part.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    values.push(value);
  }
  if (values.length > 1) {
    fail("invalid-session", "more than one session cookie was presented");
  }
  return values[0];
}

// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------

/**
 * The usable session lifetime, in **whole seconds** — one value the cookie
 * `Max-Age` and the stored `expiresAt` are both derived from, so they cannot
 * disagree. `Math.min(ttlMs, 7 days, accessExpiresAt − now)`, floored to
 * seconds. A result below one second means the access window has effectively
 * closed; the caller refuses.
 */
export function computePrivateGallerySessionLifetimeSeconds(params: {
  readonly now: Date;
  readonly accessExpiresAt: Date;
  readonly ttlMs?: number;
}): number {
  const { now, accessExpiresAt, ttlMs = MAX_PRIVATE_GALLERY_SESSION_TTL_MS } =
    params;

  if (!isFiniteDate(now) || !isFiniteDate(accessExpiresAt)) {
    fail("invalid-parameter", "now and accessExpiresAt must be valid dates");
  }
  if (!Number.isFinite(ttlMs) || ttlMs < 1000) {
    fail("invalid-parameter", "ttlMs must be a finite value of at least 1000");
  }

  const boundedTtlMs = Math.min(ttlMs, MAX_PRIVATE_GALLERY_SESSION_TTL_MS);
  const remainingMs = accessExpiresAt.getTime() - now.getTime();
  return Math.floor(Math.min(boundedTtlMs, remainingMs) / 1000);
}

// ---------------------------------------------------------------------------
// Store seam
// ---------------------------------------------------------------------------

/**
 * The session operations the exchange endpoint and per-request authorization
 * need. The Postgres adapter (a later slice) implements this; a fake in-memory
 * one exercises the lifecycle in tests.
 */
export type PrivateGallerySessionStore = {
  /**
   * Inserts `session` and keeps the **row bound** for its
   * `(galleryId, capabilityGeneration)` at or below `activeSessionCap`: if the
   * insert would exceed it, delete the oldest rows for that pair — ordered by
   * `(createdAt, sessionIdHash)` so ties are deterministic — until the
   * post-insert count is `<= activeSessionCap`, even if pre-existing data was
   * already over. Counts **every** row for the pair, not only unexpired ones,
   * because ADR-0014 §3's guarantee is that repeated exchange never grows the
   * table. All of this in **one transaction** — the adapter slice's job, with
   * its own concurrency test; this contract only states the invariant.
   */
  create(
    session: PrivateGallerySession,
    activeSessionCap: number,
  ): Promise<void>;
  /** The session whose id hashes to `sessionIdHash`, or `undefined`. */
  findByHash(sessionIdHash: string): Promise<PrivateGallerySession | undefined>;
  /** Removes one session by its id hash (logout, explicit invalidation). */
  deleteByHash(sessionIdHash: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type CreatePrivateGallerySessionParams = {
  readonly galleryId: string;
  readonly galleryHandle: string;
  readonly routePrefix: string;
  readonly capabilityGeneration: number;
  readonly accessExpiresAt: Date;
  readonly now: Date;
  readonly activeSessionCap?: number;
  readonly ttlMs?: number;
};

export type CreatedPrivateGallerySession = {
  readonly session: PrivateGallerySession;
  /** Contains the raw identifier in `cookie.value`; do not read it elsewhere. */
  readonly cookie: PrivateGallerySessionCookie;
};

/**
 * Mints a session from an already-verified capability + gallery context. The
 * raw identifier exists only inside the returned cookie descriptor; the record
 * carries only its hash.
 */
export async function createPrivateGallerySession(
  store: PrivateGallerySessionStore,
  params: CreatePrivateGallerySessionParams,
): Promise<CreatedPrivateGallerySession> {
  const {
    galleryId,
    galleryHandle,
    routePrefix,
    capabilityGeneration,
    accessExpiresAt,
    now,
    activeSessionCap = PRIVATE_GALLERY_ACTIVE_SESSION_CAP_DEFAULT,
    ttlMs,
  } = params;

  if (typeof galleryId !== "string" || galleryId.length === 0) {
    fail("invalid-parameter", "galleryId must be a non-empty string");
  }
  if (
    !Number.isSafeInteger(capabilityGeneration) ||
    capabilityGeneration < 0
  ) {
    fail(
      "invalid-parameter",
      "capabilityGeneration must be a non-negative safe integer",
    );
  }
  if (
    !Number.isInteger(activeSessionCap) ||
    activeSessionCap < 1 ||
    activeSessionCap > MAX_PRIVATE_GALLERY_ACTIVE_SESSION_CAP
  ) {
    fail(
      "invalid-parameter",
      `activeSessionCap must be an integer in 1..${MAX_PRIVATE_GALLERY_ACTIVE_SESSION_CAP}`,
    );
  }

  const path = buildPrivateGallerySessionCookiePath({
    routePrefix,
    galleryHandle,
  });
  const lifetimeSeconds = computePrivateGallerySessionLifetimeSeconds({
    now,
    accessExpiresAt,
    ...(ttlMs === undefined ? {} : { ttlMs }),
  });
  if (lifetimeSeconds < 1) {
    fail(
      "access-window-closed",
      "the access window leaves no usable session lifetime",
    );
  }

  const sessionId = generatePrivateGallerySessionId();
  const session: PrivateGallerySession = {
    sessionIdHash: hashPrivateGallerySessionId(sessionId),
    galleryId,
    capabilityGeneration,
    createdAt: new Date(now.getTime()),
    expiresAt: new Date(now.getTime() + lifetimeSeconds * 1000),
  };

  await store.create(session, activeSessionCap);

  return { session, cookie: cookie(sessionId, path, lifetimeSeconds) };
}

/**
 * Loads the session a cookie value names and checks the invariants that need
 * only the row and the clock: a well-formed identifier (no store hit if not),
 * a row that exists, finite dates, `createdAt < expiresAt`, a lifetime no
 * longer than the ADR maximum, and `now` strictly before `expiresAt`.
 *
 * `cookieValue` is the output of {@link extractPrivateGallerySessionCookie} —
 * the duplicate-cookie refusal happens there, before this is reached.
 */
export async function readPrivateGallerySession(
  store: PrivateGallerySessionStore,
  cookieValue: string | undefined,
  now: Date,
): Promise<PrivateGallerySession> {
  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  if (cookieValue === undefined) {
    fail("invalid-session", "no session cookie");
  }
  assertPrivateGallerySessionIdShape(cookieValue);

  const session = await store.findByHash(
    hashPrivateGallerySessionId(cookieValue),
  );
  if (session === undefined) {
    fail("invalid-session", "no session for this cookie");
  }

  if (!isFiniteDate(session.createdAt) || !isFiniteDate(session.expiresAt)) {
    fail("invalid-session", "the session row has invalid dates");
  }
  if (session.createdAt.getTime() >= session.expiresAt.getTime()) {
    fail("invalid-session", "the session row is not ordered in time");
  }
  if (
    session.expiresAt.getTime() - session.createdAt.getTime() >
    MAX_PRIVATE_GALLERY_SESSION_TTL_MS
  ) {
    fail("invalid-session", "the session row outlives the maximum lifetime");
  }
  if (now.getTime() >= session.expiresAt.getTime()) {
    fail("expired-session", "the session has expired");
  }

  return session;
}

/**
 * The cross-check that needs the **current** gallery: the caller MUST pass a
 * `PrivateGallery` it read fresh and uncached from the private store in the
 * same request — this function trusts it as current and does not read it.
 *
 * ADR-0014 §5 Stage 1: the gallery is `published`, its access window is open,
 * and the session's generation matches the gallery's. `accessExpiresAt` missing
 * or unparseable fails closed (§3).
 */
export function assertPrivateGallerySessionAuthorizesGallery(
  session: PrivateGallerySession,
  gallery: PrivateGallery,
  now: Date,
): void {
  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  if (session.galleryId !== gallery.galleryId) {
    fail("invalid-session", "the session belongs to another gallery");
  }
  if (!isPrivateGalleryCustomerVisible(gallery.state)) {
    fail("gallery-unavailable", "the gallery is not currently published");
  }
  if (!isFiniteDate(gallery.accessExpiresAt)) {
    fail("gallery-unavailable", "the gallery has no usable access expiry");
  }
  if (now.getTime() >= gallery.accessExpiresAt.getTime()) {
    fail("access-expired", "the gallery's access window has closed");
  }
  if (session.expiresAt.getTime() > gallery.accessExpiresAt.getTime()) {
    fail("invalid-session", "the session outlives the gallery's access window");
  }
  if (session.capabilityGeneration !== gallery.capabilityGeneration) {
    fail("stale-generation", "the session's capability generation is stale");
  }
}

/**
 * The full §5 Stage 1 session authorization: {@link readPrivateGallerySession}
 * then {@link assertPrivateGallerySessionAuthorizesGallery}. `gallery` must be
 * a fresh, uncached private-store read from the same request (see that
 * function). Every failure is a classified `PrivateGallerySessionError`; the
 * route collapses them to one generic "re-open the link" response and keeps the
 * class only in the operational log.
 */
export async function authorizePrivateGallerySessionRequest(
  store: PrivateGallerySessionStore,
  gallery: PrivateGallery,
  cookieValue: string | undefined,
  now: Date,
): Promise<PrivateGallerySession> {
  const session = await readPrivateGallerySession(store, cookieValue, now);
  assertPrivateGallerySessionAuthorizesGallery(session, gallery, now);
  return session;
}
