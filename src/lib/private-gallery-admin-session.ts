/**
 * The operator's server-side session (ADR-0015 §2) — its lifecycle, its
 * `__Host-` cookie contract, and the two checks every administrator request
 * re-derives — over a store *seam*.
 *
 * ADR-0015 §2 asks for "the same *shape* as the customer session, deliberately
 * reusing a reviewed design, and **none of its state**". The shape is shared as
 * code (`private-gallery-session-token.ts`). The state is not shared at all:
 * a different cookie name, a different store table, a different lifetime, a
 * different failure vocabulary, and no field in common. Neither session can be
 * presented as the other, and no customer credential grants anything here.
 *
 * ## Three ways this is stricter than the customer session
 *
 * - **`__Host-`.** The customer cookie could not use the prefix, because it
 *   needs a per-gallery `Path`. This one has no such need, so it takes the
 *   stronger option: `__Host-` is refused by the browser unless the cookie is
 *   `Secure`, has `Path=/`, and carries **no `Domain`** — which is what makes it
 *   unsettable by a sibling subdomain, the exact attack a bare cookie name
 *   leaves open.
 * - **`SameSite=Strict`**, not `Lax`. An administrator route is never arrived at
 *   by following a link from somewhere else, so nothing legitimate is lost, and
 *   a cross-site navigation carries no session at all.
 * - **A short absolute lifetime with no sliding renewal.** Hours rather than the
 *   customer session's days, and using the session never extends it.
 *
 * ## What `Path=/` costs, and why it is still right
 *
 * `__Host-` forces `Path=/`, so this cookie travels on **every** request to the
 * site, public pages included — more requests carrying a bearer than the
 * administrator namespace strictly needs. That is the deliberate trade ADR-0015
 * §2 makes: the cookie is `HttpOnly` (no script can read it), `Secure` (no
 * cleartext hop), and `SameSite=Strict` (no cross-site request sends it), and no
 * public route reads it or varies on it. In exchange, a subdomain — including
 * one a clone's operator does not control — cannot set it at all.
 *
 * `import "server-only"` plus the `eslint.config.mjs` import boundary keep
 * `src/app` and `src/components` from reaching this directly.
 *
 * Not here: the login route and the credential it verifies (ADR-0015 §4), the
 * persisted login rate limit (§3), and the Postgres
 * `PrivateGalleryAdminSessionStore` adapter with the *atomic* evict-oldest this
 * module's `create` contract describes but only a real transaction can
 * guarantee.
 *
 * Deliberately **not exported through `private-gallery-access.ts` yet.** That
 * facade exists to own an ordering a route must not reassemble, and the
 * administrator ordering is still incomplete — though for a different reason
 * than when this module landed. §3's persisted login rate limit now exists
 * (`private-gallery-admin-login.ts`); what is still missing is §4's credential,
 * and with it the `currentCredentialGeneration` every authorized request must be
 * compared against. A facade entry point offered now would have nothing to pass.
 * It joins the facade with §4.
 */

import "server-only";

import {
  generateSessionId,
  hashSessionId,
  isCanonicalSessionId,
  readSingleCookie,
} from "@/lib/private-gallery-session-token";
import type { PrivateGalleryAdminSession } from "@/lib/private-gallery";

/**
 * The administrator session cookie. `__Host-` is a browser-enforced prefix, not
 * decoration: a cookie carrying it is rejected outright unless it is `Secure`,
 * `Path=/`, and `Domain`-less.
 */
export const PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME =
  "__Host-pg_admin_session";

/**
 * The default administrator session lifetime: two hours.
 *
 * ADR-0015 §2 says "short … well below the customer session's seven days" and
 * leaves the number to implementation. Two hours covers an actual sitting of
 * administrative work — preparing a gallery, publishing it, checking the
 * notification went out — while keeping the window in which an unattended
 * browser is an authenticated one down to something an operator would notice.
 * There is no sliding renewal, so this is the whole session, not an idle
 * timeout.
 */
export const PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * The ceiling a deployment may configure. **A deployment may lower the TTL and
 * never raise it** — the same direction-of-travel rule ADR-0014 §8e's windows
 * follow, for the same reason: a longer window is only ever worth more to
 * whoever stole the cookie.
 */
export const MAX_PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * How recently the operator must have proved the credential for an irreversible
 * operation — deleting a gallery, revoking access (ADR-0015 §2).
 *
 * Five minutes is long enough to confirm a destructive action without a second
 * login, and short enough that a session left open on an unlocked laptop is
 * past it. This module owns the rule; the login route that *moves*
 * `reauthenticatedAt` forward is a later slice.
 */
export const PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS = 5 * 60 * 1000;

/**
 * Concurrent administrator sessions kept for one credential generation.
 *
 * One operator, a handful of devices. The cap exists for the same reason the
 * customer one does — repeated login must not grow the table without bound —
 * not to enforce a device policy.
 */
export const PRIVATE_GALLERY_ADMIN_ACTIVE_SESSION_CAP_DEFAULT = 5;
/** A configured cap above this is a mistake, not a policy. */
export const MAX_PRIVATE_GALLERY_ADMIN_ACTIVE_SESSION_CAP = 100;

/** Bounds the opaque credential digest a caller may supply or a row may hold. */
const MAX_CREDENTIAL_GENERATION_LENGTH = 128;
const CREDENTIAL_GENERATION = /^[A-Za-z0-9_-]+$/;

export type PrivateGalleryAdminSessionErrorReason =
  | "invalid-parameter"
  | "invalid-session"
  | "expired-session"
  | "stale-credential"
  | "reauthentication-required";

export class PrivateGalleryAdminSessionError extends Error {
  readonly reason: PrivateGalleryAdminSessionErrorReason;

  constructor(
    reason: PrivateGalleryAdminSessionErrorReason,
    message: string,
  ) {
    // Never interpolate a session id, its hash, or a credential digest.
    super(`[private-gallery-admin-session] ${message}`);
    this.name = "PrivateGalleryAdminSessionError";
    this.reason = reason;
  }
}

function fail(
  reason: PrivateGalleryAdminSessionErrorReason,
  message: string,
): never {
  throw new PrivateGalleryAdminSessionError(reason, message);
}

function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

/**
 * The reason is the caller's to choose, because the same malformed value means
 * two different things depending on where it came from: a bad *argument* is the
 * calling code's defect (`invalid-parameter`), while a bad value in a *stored
 * row* is a corrupt or tampered session (`invalid-session`). The classified
 * reason is what reaches the operational log, so collapsing the two would point
 * an operator at a call site when the actual problem is in the store.
 */
function assertCredentialGeneration(
  value: unknown,
  label: string,
  reason: PrivateGalleryAdminSessionErrorReason,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CREDENTIAL_GENERATION_LENGTH ||
    !CREDENTIAL_GENERATION.test(value)
  ) {
    fail(reason, `${label} is not a bounded opaque token`);
  }
}

// ---------------------------------------------------------------------------
// Session identifier
// ---------------------------------------------------------------------------

/** A fresh 256-bit CSPRNG administrator session identifier. */
export function generatePrivateGalleryAdminSessionId(): string {
  return generateSessionId();
}

/**
 * Asserts a value is a canonical session identifier, before it is hashed or
 * used for a store lookup, so a malformed cookie costs nothing.
 */
export function assertPrivateGalleryAdminSessionIdShape(
  value: unknown,
): asserts value is string {
  if (!isCanonicalSessionId(value)) {
    fail(
      "invalid-session",
      "the session identifier is not a canonical 256-bit token",
    );
  }
}

/** The digest the store keeps; the raw identifier is never persisted. */
export function hashPrivateGalleryAdminSessionId(sessionId: string): string {
  assertPrivateGalleryAdminSessionIdShape(sessionId);
  return hashSessionId(sessionId);
}

// ---------------------------------------------------------------------------
// Cookie
// ---------------------------------------------------------------------------

/**
 * A descriptor that maps directly onto Next's `ResponseCookie`
 * (`NextResponse.cookies.set(name, value, options)`). The framework owns the
 * wire format; this module does not serialize a `Set-Cookie` header, so the two
 * cannot drift.
 *
 * Every field is fixed rather than a parameter. `path` is `/` and there is no
 * `domain`, because `__Host-` requires exactly that — making the descriptor
 * unable to express a cookie the browser would reject, instead of trusting a
 * caller to pass the right values.
 */
export type PrivateGalleryAdminSessionCookie = {
  readonly name: typeof PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME;
  readonly value: string;
  readonly options: {
    /** Seconds. `0` clears the cookie. */
    readonly maxAge: number;
    readonly path: "/";
    readonly secure: true;
    readonly httpOnly: true;
    readonly sameSite: "strict";
  };
};

function cookie(
  value: string,
  maxAge: number,
): PrivateGalleryAdminSessionCookie {
  return {
    name: PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME,
    value,
    options: {
      maxAge,
      path: "/",
      secure: true,
      httpOnly: true,
      sameSite: "strict",
    },
  };
}

/** The `Set-Cookie` descriptor for logout, or for a session found unusable. */
export function buildPrivateGalleryAdminSessionClearCookie(): PrivateGalleryAdminSessionCookie {
  return cookie("", 0);
}

/**
 * The single administrator session cookie value from a raw `Cookie` header, or
 * `undefined` if there is none. **Refuses a request carrying more than one.**
 *
 * `__Host-` already makes the classic cookie-tossing setup hard — a sibling
 * subdomain cannot set a `__Host-` cookie at all — so this is defence in depth
 * rather than the primary control. It costs one pass over a header and removes
 * the question of which duplicate a name-keyed parser would have kept.
 */
export function extractPrivateGalleryAdminSessionCookie(
  cookieHeader: string | null | undefined,
): string | undefined {
  const read = readSingleCookie(
    cookieHeader,
    PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME,
  );
  if (read.kind === "duplicate") {
    fail(
      "invalid-session",
      "more than one administrator session cookie was presented",
    );
  }
  return read.kind === "one" ? read.value : undefined;
}

// ---------------------------------------------------------------------------
// Lifetime
// ---------------------------------------------------------------------------

/**
 * The session lifetime in **whole seconds** — the one value the cookie
 * `Max-Age` and the stored `expiresAt` are both derived from, so they cannot
 * disagree.
 *
 * Unlike the customer session there is no access window to bound this against:
 * an operator's session is limited only by the configured TTL and this module's
 * ceiling.
 */
export function computePrivateGalleryAdminSessionLifetimeSeconds(params: {
  readonly ttlMs?: number;
}): number {
  const { ttlMs = PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS } = params;

  if (!Number.isFinite(ttlMs) || ttlMs < 1000) {
    fail("invalid-parameter", "ttlMs must be a finite value of at least 1000");
  }
  return Math.floor(
    Math.min(ttlMs, MAX_PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS) / 1000,
  );
}

// ---------------------------------------------------------------------------
// Store seam
// ---------------------------------------------------------------------------

/**
 * The administrator session operations the login route and per-request
 * authorization need. The Postgres adapter (a later slice) implements this; a
 * fake in-memory one exercises the lifecycle in tests.
 *
 * Deliberately a **separate** store contract from
 * `PrivateGallerySessionStore`, over its own rows: ADR-0015 §2's "shares no
 * session with the customer path" is a property of the data, and one table
 * holding both kinds would make it a property of a `WHERE` clause instead.
 *
 * **One obligation the adapter inherits**, written here because it is invisible
 * until someone looks at the table: `create`'s cap is scoped to a single
 * `credentialGeneration`, so rotating the administrator secret does not evict
 * the sessions minted against the old one — they are a different group, and
 * unlike a customer session they have no parent gallery whose deletion would
 * cascade them away. They are harmless, since every one of them now fails
 * {@link assertPrivateGalleryAdminSessionIsCurrent}, but they accumulate for as
 * long as the deployment lives. The adapter must delete rows whose `expiresAt`
 * has passed, regardless of generation; because an administrator session lasts
 * hours rather than months, expiry-based cleanup alone fully resolves this and
 * no generation-aware sweep is needed.
 */
export type PrivateGalleryAdminSessionStore = {
  /**
   * Inserts `session` and keeps the row bound for its `credentialGeneration` at
   * or below `activeSessionCap`: if the insert would exceed it, delete the
   * oldest rows for that generation — ordered by `(createdAt, sessionIdHash)`
   * so ties are deterministic — until the post-insert count is
   * `<= activeSessionCap`, counting **every** row for the generation and not
   * only unexpired ones. All of it in one transaction; this contract states the
   * invariant, and the adapter slice owns the concurrency test.
   */
  create(
    session: PrivateGalleryAdminSession,
    activeSessionCap: number,
  ): Promise<void>;
  /** The session whose id hashes to `sessionIdHash`, or `undefined`. */
  findByHash(
    sessionIdHash: string,
  ): Promise<PrivateGalleryAdminSession | undefined>;
  /** Removes one session by its id hash (logout, explicit invalidation). */
  deleteByHash(sessionIdHash: string): Promise<void>;
};

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export type CreatePrivateGalleryAdminSessionParams = {
  /**
   * A digest **derived from** the credential just proved — never the credential
   * or its stored hash (see `PrivateGalleryAdminSession.credentialGeneration`).
   * ADR-0015 §4's own slice mints it.
   */
  readonly credentialGeneration: string;
  readonly now: Date;
  readonly activeSessionCap?: number;
  readonly ttlMs?: number;
};

export type CreatedPrivateGalleryAdminSession = {
  readonly session: PrivateGalleryAdminSession;
  /** Contains the raw identifier in `cookie.value`; do not read it elsewhere. */
  readonly cookie: PrivateGalleryAdminSessionCookie;
};

/**
 * Mints an administrator session for a credential the caller has **already
 * verified**. This module does not check a secret — ADR-0015 §4's slice owns
 * that, and keeping the two apart is what lets the identity mechanism be
 * replaced (a passkey, say) without touching the session at all.
 *
 * `reauthenticatedAt` starts equal to `createdAt`: proving the credential is
 * what a session is minted from, so the operator is authenticated as of now.
 */
export async function createPrivateGalleryAdminSession(
  store: PrivateGalleryAdminSessionStore,
  params: CreatePrivateGalleryAdminSessionParams,
): Promise<CreatedPrivateGalleryAdminSession> {
  const {
    credentialGeneration,
    now,
    activeSessionCap = PRIVATE_GALLERY_ADMIN_ACTIVE_SESSION_CAP_DEFAULT,
    ttlMs,
  } = params;

  assertCredentialGeneration(
    credentialGeneration,
    "credentialGeneration",
    "invalid-parameter",
  );
  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  if (
    !Number.isInteger(activeSessionCap) ||
    activeSessionCap < 1 ||
    activeSessionCap > MAX_PRIVATE_GALLERY_ADMIN_ACTIVE_SESSION_CAP
  ) {
    fail(
      "invalid-parameter",
      `activeSessionCap must be an integer in 1..${MAX_PRIVATE_GALLERY_ADMIN_ACTIVE_SESSION_CAP}`,
    );
  }

  const lifetimeSeconds = computePrivateGalleryAdminSessionLifetimeSeconds(
    ttlMs === undefined ? {} : { ttlMs },
  );

  const sessionId = generatePrivateGalleryAdminSessionId();
  const session: PrivateGalleryAdminSession = {
    sessionIdHash: hashPrivateGalleryAdminSessionId(sessionId),
    credentialGeneration,
    createdAt: new Date(now.getTime()),
    expiresAt: new Date(now.getTime() + lifetimeSeconds * 1000),
    reauthenticatedAt: new Date(now.getTime()),
  };

  await store.create(session, activeSessionCap);

  return { session, cookie: cookie(sessionId, lifetimeSeconds) };
}

/**
 * Loads the session a cookie names and checks the invariants that need only the
 * row and the clock: a canonical identifier (no store hit if not), a row that
 * exists, finite dates, `createdAt < expiresAt`, a lifetime no longer than this
 * module's ceiling, a `reauthenticatedAt` inside the session's own span, and
 * `now` strictly before `expiresAt`.
 *
 * A row whose stored lifetime exceeds the ceiling is refused rather than
 * truncated: it can only come from a deployment that once configured a longer
 * TTL, or from a tampered row, and honouring it would let either outlive the
 * rule.
 */
export async function readPrivateGalleryAdminSession(
  store: PrivateGalleryAdminSessionStore,
  cookieValue: string | undefined,
  now: Date,
): Promise<PrivateGalleryAdminSession> {
  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  if (cookieValue === undefined) {
    fail("invalid-session", "no administrator session cookie");
  }
  assertPrivateGalleryAdminSessionIdShape(cookieValue);

  const session = await store.findByHash(
    hashPrivateGalleryAdminSessionId(cookieValue),
  );
  if (session === undefined) {
    fail("invalid-session", "no administrator session for this cookie");
  }

  if (
    !isFiniteDate(session.createdAt) ||
    !isFiniteDate(session.expiresAt) ||
    !isFiniteDate(session.reauthenticatedAt)
  ) {
    fail("invalid-session", "the session row has invalid dates");
  }
  assertCredentialGeneration(
    session.credentialGeneration,
    "the session row's credentialGeneration",
    "invalid-session",
  );
  if (session.createdAt.getTime() >= session.expiresAt.getTime()) {
    fail("invalid-session", "the session row is not ordered in time");
  }
  if (
    session.expiresAt.getTime() - session.createdAt.getTime() >
    MAX_PRIVATE_GALLERY_ADMIN_SESSION_TTL_MS
  ) {
    fail("invalid-session", "the session row outlives the maximum lifetime");
  }
  // A re-authentication cannot predate the session or outlast it; either would
  // be a row that grants a longer destructive-operation window than any real
  // login could have produced.
  if (
    session.reauthenticatedAt.getTime() < session.createdAt.getTime() ||
    session.reauthenticatedAt.getTime() > session.expiresAt.getTime()
  ) {
    fail("invalid-session", "the session row's re-authentication is out of range");
  }
  if (now.getTime() >= session.expiresAt.getTime()) {
    fail("expired-session", "the administrator session has expired");
  }

  return session;
}

/**
 * The check that needs the deployment's **current** credential: a session minted
 * against a superseded secret is refused.
 *
 * This is ADR-0015 §2's central revocation, and it is automatic — rotating
 * `PRIVATE_GALLERY_ADMIN_SECRET_HASH` and redeploying ends every live session
 * without anyone remembering to clear a table. `currentCredentialGeneration` is
 * supplied by the caller rather than read here, so this module never touches the
 * secret and §4's mechanism stays replaceable.
 */
export function assertPrivateGalleryAdminSessionIsCurrent(
  session: PrivateGalleryAdminSession,
  currentCredentialGeneration: string,
): void {
  assertCredentialGeneration(
    currentCredentialGeneration,
    "currentCredentialGeneration",
    "invalid-parameter",
  );
  if (session.credentialGeneration !== currentCredentialGeneration) {
    fail(
      "stale-credential",
      "the session was minted against a superseded administrator credential",
    );
  }
}

/**
 * The full per-request administrator authorization: load the row, then check it
 * against the current credential. Every administrator route and **every
 * administrator mutation** runs this — ADR-0015 §2 leaves no "the page loaded,
 * so the mutation is authorized" gap, exactly as ADR-0014 §5 Stage 1 does not
 * for customers.
 *
 * Every failure is a classified `PrivateGalleryAdminSessionError`; the route
 * collapses them to one generic refusal and keeps the class only in the
 * operational log.
 */
export async function authorizePrivateGalleryAdminRequest(
  store: PrivateGalleryAdminSessionStore,
  cookieValue: string | undefined,
  currentCredentialGeneration: string,
  now: Date,
): Promise<PrivateGalleryAdminSession> {
  const session = await readPrivateGalleryAdminSession(store, cookieValue, now);
  assertPrivateGalleryAdminSessionIsCurrent(
    session,
    currentCredentialGeneration,
  );
  return session;
}

/**
 * The extra gate an **irreversible** operation passes — deleting a gallery,
 * revoking or replacing access (ADR-0015 §2).
 *
 * Run *after* {@link authorizePrivateGalleryAdminRequest}, never instead of it:
 * this asks only "was the credential proved recently", and says nothing about
 * whether the session is valid, unexpired, or current.
 */
export function assertPrivateGalleryAdminReauthenticated(
  session: PrivateGalleryAdminSession,
  now: Date,
  windowMs: number = PRIVATE_GALLERY_ADMIN_REAUTHENTICATION_WINDOW_MS,
): void {
  if (!isFiniteDate(now) || !isFiniteDate(session.reauthenticatedAt)) {
    fail("invalid-parameter", "now and reauthenticatedAt must be valid dates");
  }
  if (!Number.isFinite(windowMs) || windowMs < 1000) {
    fail("invalid-parameter", "windowMs must be a finite value of at least 1000");
  }
  const elapsed = now.getTime() - session.reauthenticatedAt.getTime();
  // A negative elapsed time means the row claims a re-authentication in the
  // future. Refused rather than treated as "very recent", which is the reading
  // that would turn a clock skew or a bad row into an open destructive window.
  if (elapsed < 0 || elapsed > windowMs) {
    fail(
      "reauthentication-required",
      "this operation needs the administrator credential proved again",
    );
  }
}
