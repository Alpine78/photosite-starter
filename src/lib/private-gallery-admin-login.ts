/**
 * The administrator login's request boundary and its two rate-limiting layers
 * (ADR-0015 §3) — everything that must happen *before* a credential is ever
 * verified.
 *
 * This module verifies nothing. §4's slice owns the secret and its `scrypt`
 * comparison; what lives here is the ordering that keeps that comparison from
 * being a free service: the cheap header checks, then the in-process per-IP
 * layer, then the **persisted** counter, and only then the expensive step.
 *
 * ## Why the persisted counter is not about guessing
 *
 * ADR-0015 §4 requires a *generated* 256-bit secret, so brute force is not a
 * threat this limit meaningfully addresses — no rate on a human timescale makes
 * a difference to a search space that size. What it actually bounds is **server
 * cost**: verification is `scrypt` at roughly 74 ms of CPU per attempt on the
 * pinned Node major (ADR-0015 §4's own measurement), so an unbounded login
 * endpoint is a cheap way to burn a Function's CPU from anywhere on the
 * internet. Thirty attempts per fifteen minutes caps that path at a couple of
 * seconds of CPU per window.
 *
 * The second thing it bounds is the case the rule is meant to prevent but
 * cannot enforce: an operator who ignores §4 and configures a memorable
 * passphrase. The limit is what stands between that mistake and an offline-speed
 * online attack.
 *
 * ## Why the counter is global
 *
 * The exchange's counter is owned by a gallery row, because a handle is
 * caller-supplied and `INSERT … ON CONFLICT` on an arbitrary one would be an
 * unbounded storage primitive (ADR-0014 §3). Administrator login has no such
 * row and no account to key on — there is one operator, no user table, and
 * nobody to enumerate (ADR-0015 Context) — so the counter is a **single row for
 * the whole deployment**. That makes the storage bound trivially true rather
 * than something the adapter has to work for, and it matches what the limit is
 * actually protecting: one shared CPU budget, not one identity's allowance.
 *
 * **The accepted cost is availability.** A global counter means sustained
 * attempts from anywhere can exhaust the window and deny the operator a login
 * until it rolls over. ADR-0015 does not discuss this. It is accepted here
 * because the alternatives are worse — a per-IP persisted counter reintroduces
 * the unbounded key space the exchange deliberately avoided, and is bypassed by
 * rotating addresses anyway — and because the window is fifteen minutes rather
 * than an escalating lockout, so the failure mode is a wait, not an outage. A
 * deployment that needs more than that should put platform access control in
 * front of the administrator namespace; `docs/deployment.md` says so.
 *
 * Note what the layering does **not** buy here: layer 1 caps one client at 20
 * attempts per 10 minutes, so two clients are enough to spend the deployment's
 * 30. The cheap layer keeps a single noisy client from doing it alone; it is not
 * a defence against someone who wants to.
 *
 * The numbers stay conservative on purpose. A limit high enough to make griefing
 * impractical would also be the limit protecting an operator who ignored §4 and
 * configured a memorable passphrase — and of the two failure modes, "the
 * operator waits a quarter of an hour" is a nuisance while "a weak secret is
 * attacked at thousands of guesses a day" reaches every private gallery.
 *
 * ## One indistinguishable refusal
 *
 * A throttled attempt and a wrong credential must be answered identically —
 * same status, same body, **no `Retry-After`** — for the reason ADR-0015 §3
 * gives: there is no account to enumerate, but a caller who can tell "throttled"
 * from "wrong" learns when to resume and how close the limit is. The refusal
 * reason here exists for the operational log and never for the response, exactly
 * as `private-gallery-access.ts` treats the exchange's.
 *
 * `import "server-only"` plus the `eslint.config.mjs` import boundary keep
 * `src/app` and `src/components` from reaching this directly.
 */

import "server-only";

import {
  checkContactRequestHeaders,
  type ContactRejectionReason,
} from "@/lib/contact-request";
import {
  createContactRateLimiter,
  type ContactRateLimiter,
} from "@/lib/contact-rate-limit";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/** Layer 1, per IP, in process. Best effort — never the real defence. */
export const PRIVATE_GALLERY_ADMIN_LOGIN_IP_MAX_ATTEMPTS = 20;
export const PRIVATE_GALLERY_ADMIN_LOGIN_IP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Layer 2, the whole deployment, persisted. Thirty attempts per fifteen minutes
 * — far more than an operator pasting a secret from a password manager will ever
 * need, and a hard ceiling of roughly two seconds of `scrypt` CPU per window.
 */
export const PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS = 30;
export const PRIVATE_GALLERY_ADMIN_LOGIN_WINDOW_MS = 15 * 60 * 1000;

export type PrivateGalleryAdminLoginErrorReason =
  | "invalid-parameter"
  | "malformed-record";

export class PrivateGalleryAdminLoginError extends Error {
  readonly reason: PrivateGalleryAdminLoginErrorReason;

  constructor(reason: PrivateGalleryAdminLoginErrorReason, message: string) {
    // Never interpolate a submitted secret, a client key, or a counter value.
    super(`[private-gallery-admin-login] ${message}`);
    this.name = "PrivateGalleryAdminLoginError";
    this.reason = reason;
  }
}

function fail(
  reason: PrivateGalleryAdminLoginErrorReason,
  message: string,
): never {
  throw new PrivateGalleryAdminLoginError(reason, message);
}

function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

// ---------------------------------------------------------------------------
// Request boundary — reused, not reinvented
// ---------------------------------------------------------------------------

/**
 * ADR-0015 §3: the login endpoint reuses the request boundary the contact and
 * enquiry endpoints already establish and this repository has reviewed twice —
 * `application/json` only and same-origin, checked before anything stateful.
 *
 * A wrapper rather than a second implementation, and a wrapper rather than a
 * bare re-export: it is the place this module's contract states that the
 * administrator path shares that boundary, and the place a test can hold it to
 * that. `readContactSubmission`'s bounded body and closed field whitelist are
 * reused the same way by §4's slice, which owns what the login body contains.
 *
 * ADR-0015 §3's "POST only" is not checked here and does not need to be: an App
 * Router Route Handler dispatches by exported method name, so a `GET` never
 * reaches a file that exports only `POST`. Checking it again would be a second
 * rule that could disagree with the routing.
 *
 * Returns the rejection reason, or `undefined` when the request may proceed to
 * the throttle.
 */
export function checkPrivateGalleryAdminLoginRequestHeaders(
  request: Request,
): ContactRejectionReason | undefined {
  return checkContactRequestHeaders(request);
}

// ---------------------------------------------------------------------------
// Layer 1 — per-IP, in-process, best effort
// ---------------------------------------------------------------------------

/**
 * Its own limiter instance, so an administrator login never spends the contact,
 * enquiry, or gallery-exchange allowance — the rule every other endpoint here
 * already follows. It makes no cross-instance promise, and a client that forges
 * its forwarded address only splits its own bucket
 * (`contact-rate-limit.ts`).
 */
export function createPrivateGalleryAdminLoginIpLimiter(): ContactRateLimiter {
  return createContactRateLimiter({
    maxAttempts: PRIVATE_GALLERY_ADMIN_LOGIN_IP_MAX_ATTEMPTS,
    windowMs: PRIVATE_GALLERY_ADMIN_LOGIN_IP_WINDOW_MS,
  });
}

// ---------------------------------------------------------------------------
// Layer 2 — deployment-wide, persistent, fixed-window
// ---------------------------------------------------------------------------

export type PrivateGalleryAdminLoginRateCounter = {
  readonly windowStartedAt: Date;
  readonly attempts: number;
};

export type PrivateGalleryAdminLoginRateConfig = {
  readonly maxAttempts: number;
  readonly windowMs: number;
};

export const PRIVATE_GALLERY_ADMIN_LOGIN_RATE_CONFIG: PrivateGalleryAdminLoginRateConfig =
  Object.freeze({
    maxAttempts: PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS,
    windowMs: PRIVATE_GALLERY_ADMIN_LOGIN_WINDOW_MS,
  });

export type PrivateGalleryAdminLoginRateDecision = {
  readonly allowed: boolean;
  /** True exactly on the attempt that crosses the limit, so the caller logs once. */
  readonly firstRefusalInWindow: boolean;
  readonly next: PrivateGalleryAdminLoginRateCounter;
};

/**
 * The reference semantics for the persistent counter: what the store's own
 * atomic statement must compute. Pure, so the policy is testable without a
 * store — and so the adapter has something exact to match rather than a prose
 * description. Deliberately the same shape as
 * `evaluatePrivateGalleryExchangeRate`, which has already been reviewed.
 *
 * A corrupt counter row (an unparseable window start, a negative or
 * non-integer attempt count) **throws** rather than resetting: silently starting
 * a fresh window would let a corrupted row fail open, and this is the one
 * counter whose failing open makes an expensive operation free.
 *
 * The stored count **saturates** at `maxAttempts + 1`, so a sustained attack
 * does not increment forever; the transition *into* the saturated value is what
 * marks the first refusal.
 */
export function evaluatePrivateGalleryAdminLoginRate(
  counter: PrivateGalleryAdminLoginRateCounter | undefined,
  now: Date,
  config: PrivateGalleryAdminLoginRateConfig = PRIVATE_GALLERY_ADMIN_LOGIN_RATE_CONFIG,
): PrivateGalleryAdminLoginRateDecision {
  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  if (
    !Number.isSafeInteger(config.maxAttempts) ||
    config.maxAttempts < 1 ||
    !Number.isFinite(config.windowMs) ||
    config.windowMs <= 0
  ) {
    fail("invalid-parameter", "the rate configuration is not usable");
  }

  const fresh: PrivateGalleryAdminLoginRateDecision = {
    allowed: true,
    firstRefusalInWindow: false,
    next: { windowStartedAt: new Date(now.getTime()), attempts: 1 },
  };

  if (counter === undefined) return fresh;

  if (
    !isFiniteDate(counter.windowStartedAt) ||
    !Number.isSafeInteger(counter.attempts) ||
    counter.attempts < 0
  ) {
    fail("malformed-record", "the stored login counter is unusable");
  }

  if (now.getTime() - counter.windowStartedAt.getTime() >= config.windowMs) {
    return fresh;
  }

  const allowed = counter.attempts < config.maxAttempts;
  const saturated = config.maxAttempts + 1;
  return {
    allowed,
    firstRefusalInWindow: !allowed && counter.attempts === config.maxAttempts,
    next: {
      windowStartedAt: counter.windowStartedAt,
      attempts: Math.min(counter.attempts + 1, saturated),
    },
  };
}

// ---------------------------------------------------------------------------
// Store seam
// ---------------------------------------------------------------------------

export type PrivateGalleryAdminLoginStore = {
  /**
   * Consumes the deployment's single login counter, **atomically**, with exactly
   * the semantics of {@link evaluatePrivateGalleryAdminLoginRate}: one
   * `INSERT … ON CONFLICT DO UPDATE` returning the decision, not a read followed
   * by a write. A read-decide-write would let two concurrent attempts each see
   * the same count and both proceed, which is precisely the CPU amplification
   * the counter exists to prevent.
   *
   * There is one row, for the whole deployment. Nothing a caller sends
   * influences the key, so this cannot be used to grow the table.
   *
   * A successful login does **not** reset it, because a successful attempt costs
   * exactly the same `scrypt` CPU as a failed one — and this counter bounds cost.
   * Resetting on success would hand unlimited verification cost to anyone who
   * holds the secret, which is the one caller a rate limit on a single-operator
   * deployment cannot otherwise distinguish from the operator. It is not a
   * lockout counter, so there is nothing for a success to forgive.
   */
  consumeLoginAttempt(
    now: Date,
    config: PrivateGalleryAdminLoginRateConfig,
  ): Promise<PrivateGalleryAdminLoginRateDecision>;
};

// ---------------------------------------------------------------------------
// Composition
// ---------------------------------------------------------------------------

/** Why an attempt was refused. **Operational log only — never a response.** */
export type PrivateGalleryAdminLoginRefusal =
  | "ip-rate-limited"
  | "deployment-rate-limited";

export type PrivateGalleryAdminLoginAttempt =
  | { readonly outcome: "proceed" }
  | {
      readonly outcome: "refused";
      readonly refusal: PrivateGalleryAdminLoginRefusal;
      /** True once per window, so a sustained attack does not flood the log. */
      readonly firstRefusalInWindow: boolean;
    };

/**
 * Spends an attempt against both layers, in the only order that is safe: the
 * cheap in-process bucket first, then the persisted counter, and the caller
 * verifies the credential **only** on `proceed`.
 *
 * Every attempt is counted, including one the in-process layer refuses — but
 * note the ordering consequence: a request stopped by layer 1 never reaches
 * layer 2, so a single noisy client cannot exhaust the deployment-wide window on
 * its own. That is the point of having a cheap layer at all.
 *
 * `clientKey` is the caller's already-derived client identifier (the same one
 * `/api/contact` uses); this module neither parses headers for it nor logs it.
 */
export async function consumePrivateGalleryAdminLoginAttempt(params: {
  readonly ipLimiter: ContactRateLimiter;
  readonly store: PrivateGalleryAdminLoginStore;
  readonly clientKey: string;
  readonly now: Date;
  readonly config?: PrivateGalleryAdminLoginRateConfig;
}): Promise<PrivateGalleryAdminLoginAttempt> {
  const {
    ipLimiter,
    store,
    clientKey,
    now,
    config = PRIVATE_GALLERY_ADMIN_LOGIN_RATE_CONFIG,
  } = params;

  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  if (typeof clientKey !== "string" || clientKey.length === 0) {
    fail("invalid-parameter", "clientKey must be a non-empty string");
  }

  const ip = ipLimiter.tryConsume(clientKey, now.getTime());
  if (!ip.allowed) {
    return {
      outcome: "refused",
      refusal: "ip-rate-limited",
      // The in-process limiter reports its own first-refusal edge; carry it
      // rather than logging every refused request in the window, which for a
      // client that keeps trying is unbounded.
      firstRefusalInWindow: ip.firstRefusalInWindow,
    };
  }

  const decision = await store.consumeLoginAttempt(now, config);
  if (!decision.allowed) {
    return {
      outcome: "refused",
      refusal: "deployment-rate-limited",
      firstRefusalInWindow: decision.firstRefusalInWindow,
    };
  }

  return { outcome: "proceed" };
}
