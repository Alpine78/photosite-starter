/**
 * The private client-gallery capability exchange: its two rate-limiting layers,
 * its gallery/capability lookup, and — the load-bearing step — the verification
 * that the capability a browser submitted is the one this gallery's stored
 * envelope holds (ADR-0014 §3).
 *
 * **Internal.** `eslint.config.mjs` bans `src/app` and `src/components` from
 * importing this; a route reaches the exchange only through
 * `private-gallery-access.ts`, the one facade that owns the whole ordering. That
 * is deliberate: the comparison in
 * {@link resolveVerifiedPrivateGalleryCapability} is the only thing standing
 * between "knows a gallery handle" and "holds a session", and a route must not
 * be able to compose the pieces while omitting it.
 *
 * Not here: the bootstrap document, the fragment script, the `POST` endpoint and
 * its same-origin / fetch-metadata checks, the session creation (slice 4's
 * `createPrivateGallerySession`, composed by the facade), and the Postgres
 * adapter for the store seam below.
 */

import "server-only";

import { timingSafeEqual } from "node:crypto";

import {
  createContactRateLimiter,
  type ContactRateLimiter,
} from "@/lib/contact-rate-limit";
import {
  assertCapabilitySecret,
  capabilityEnvelopeKeyId,
  openCapability,
} from "@/lib/private-gallery-capability";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import {
  isPrivateGalleryCustomerVisible,
  type PrivateGallery,
  type PrivateGalleryCapability,
} from "@/lib/private-gallery";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------

/**
 * ADR-0014 §3 fixes that the exchange has two rate-limiting layers and that the
 * second is persistent; its §8e ceiling table names no number for either, so
 * these are **this slice's implementation defaults**, not ADR-fixed values.
 * They are deliberately plain constants with no configuration seam: a
 * deployment-tunable limit would need its own validated lower-only setting, and
 * nothing has asked for one yet.
 */
export const PRIVATE_GALLERY_EXCHANGE_IP_MAX_ATTEMPTS = 30;
export const PRIVATE_GALLERY_EXCHANGE_IP_WINDOW_MS = 10 * 60 * 1000;

/**
 * Per gallery, per **fixed** window — not a rolling hour. A fixed window can
 * admit up to twice the allowance across a boundary (20 late in one window, 20
 * early in the next); that is accepted, because this layer bounds re-exchange
 * churn and automated guessing, while the 256-bit capability is what actually
 * makes guessing hopeless. A family sharing one link re-exchanges a few times a
 * week at most (a session lasts up to 7 days), so 20 per hour is generous for
 * real use.
 */
export const PRIVATE_GALLERY_EXCHANGE_HANDLE_MAX_ATTEMPTS = 20;
export const PRIVATE_GALLERY_EXCHANGE_HANDLE_WINDOW_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export type PrivateGalleryExchangeErrorReason =
  /** A caller passed something structurally unusable (a bug, not a visitor). */
  | "invalid-parameter"
  /** The handle is not the shape a real gallery handle has. */
  | "invalid-handle"
  /** This gallery's persistent exchange window is exhausted. */
  | "rate-limited"
  /** No gallery answers to this handle. */
  | "not-found"
  /** The gallery exists but is not currently serving customers. */
  | "not-available"
  /** The six-month access window has closed. */
  | "access-expired"
  /** A published gallery's current generation has no capability row. */
  | "no-capability"
  /** Stored data contradicts itself — a data-integrity defect. */
  | "malformed-record"
  /** The submitted capability is malformed, or is not this gallery's. */
  | "capability-mismatch";

export class PrivateGalleryExchangeError extends Error {
  readonly reason: PrivateGalleryExchangeErrorReason;
  /** Set only for `rate-limited`, so a caller logs one refusal per window. */
  readonly firstRefusalInWindow: boolean;

  constructor(
    reason: PrivateGalleryExchangeErrorReason,
    message: string,
    firstRefusalInWindow = false,
  ) {
    // Never interpolate a handle, an envelope, or a capability into a message.
    super(`[private-gallery-exchange] ${message}`);
    this.name = "PrivateGalleryExchangeError";
    this.reason = reason;
    this.firstRefusalInWindow = firstRefusalInWindow;
  }
}

function fail(
  reason: PrivateGalleryExchangeErrorReason,
  message: string,
  firstRefusalInWindow = false,
): never {
  throw new PrivateGalleryExchangeError(reason, message, firstRefusalInWindow);
}

function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

// ---------------------------------------------------------------------------
// Handle shape
// ---------------------------------------------------------------------------

const UNPADDED_BASE64URL = /^[A-Za-z0-9_-]+$/;
/** The same bounds `canonicalCapabilityAad` applies, so a handle that would
 * fail the capability's associated data can never reach a store lookup or a
 * rate-limit key. A test pins the two rules together. */
const HANDLE_MIN_BYTES = 16;
const HANDLE_MAX_BYTES = 64;

export function assertPrivateGalleryHandleShape(handle: unknown): void {
  if (
    typeof handle !== "string" ||
    handle.length === 0 ||
    handle.length > 128 ||
    !UNPADDED_BASE64URL.test(handle)
  ) {
    fail("invalid-handle", "the gallery handle is not unpadded base64url");
  }
  const decoded = Buffer.from(handle, "base64url");
  if (
    decoded.toString("base64url") !== handle ||
    decoded.length < HANDLE_MIN_BYTES ||
    decoded.length > HANDLE_MAX_BYTES
  ) {
    fail(
      "invalid-handle",
      `the gallery handle must decode canonically to ${HANDLE_MIN_BYTES}–${HANDLE_MAX_BYTES} bytes`,
    );
  }
}

// ---------------------------------------------------------------------------
// Layer 1 — per-IP, in-process, best effort
// ---------------------------------------------------------------------------

/**
 * ADR-0014 §3's first layer: "fast, cheap, **not the real defence**". It makes
 * no cross-instance promise, and a client that forges its forwarded address
 * only splits its own bucket (`contact-rate-limit.ts`). Its own instance, so an
 * exchange never spends the contact or enquiry allowance — the same rule
 * `/api/contact` and `/api/enquiry` already follow.
 */
export function createPrivateGalleryExchangeIpLimiter(): ContactRateLimiter {
  return createContactRateLimiter({
    maxAttempts: PRIVATE_GALLERY_EXCHANGE_IP_MAX_ATTEMPTS,
    windowMs: PRIVATE_GALLERY_EXCHANGE_IP_WINDOW_MS,
  });
}

// ---------------------------------------------------------------------------
// Layer 2 — per-gallery, persistent, fixed-window
// ---------------------------------------------------------------------------

export type PrivateGalleryExchangeRateCounter = {
  readonly windowStartedAt: Date;
  readonly attempts: number;
};

export type PrivateGalleryExchangeRateConfig = {
  readonly maxAttempts: number;
  readonly windowMs: number;
};

export const PRIVATE_GALLERY_EXCHANGE_RATE_CONFIG: PrivateGalleryExchangeRateConfig =
  Object.freeze({
    maxAttempts: PRIVATE_GALLERY_EXCHANGE_HANDLE_MAX_ATTEMPTS,
    windowMs: PRIVATE_GALLERY_EXCHANGE_HANDLE_WINDOW_MS,
  });

export type PrivateGalleryExchangeRateDecision = {
  readonly allowed: boolean;
  /** True exactly on the attempt that crosses the limit, so the caller logs once. */
  readonly firstRefusalInWindow: boolean;
  readonly next: PrivateGalleryExchangeRateCounter;
};

/**
 * The reference semantics for the persistent counter: what the store's own
 * atomic statement must compute. Pure, so the policy is testable without a
 * store — and so the adapter has something exact to match rather than a prose
 * description.
 *
 * A counter row that is corrupt (an unparseable window start, a negative or
 * non-integer attempt count) **throws** rather than resetting: silently
 * starting a fresh window would let a corrupted row fail open. The adapter's
 * schema is expected to make that unrepresentable (`NOT NULL`, `CHECK (attempts
 * >= 0)`); this guard is what keeps the in-memory path honest and documents the
 * requirement.
 *
 * The stored count **saturates** at `maxAttempts + 1`. Incrementing forever
 * would be write amplification with no reader, and eventually an overflow; the
 * transition *into* the saturated value is what marks the first refusal.
 */
export function evaluatePrivateGalleryExchangeRate(
  counter: PrivateGalleryExchangeRateCounter | undefined,
  now: Date,
  config: PrivateGalleryExchangeRateConfig,
): PrivateGalleryExchangeRateDecision {
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

  const fresh: PrivateGalleryExchangeRateDecision = {
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
    fail("malformed-record", "the stored exchange counter is unusable");
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

export type PrivateGalleryExchangeLookup =
  | {
      readonly outcome: "ok";
      readonly gallery: PrivateGallery;
      /** Absent when the gallery's current generation has no capability row. */
      readonly capability: PrivateGalleryCapability | undefined;
    }
  | { readonly outcome: "unknown-handle" }
  | {
      readonly outcome: "rate-limited";
      readonly firstRefusalInWindow: boolean;
    };

export type PrivateGalleryExchangeStore = {
  /**
   * Resolves a handle **and** consumes that gallery's persistent exchange
   * counter, as **one atomic operation**.
   *
   * The two are one call on purpose. A counter keyed by a caller-supplied
   * handle would be an unbounded storage primitive: handles are cheap to
   * invent, so an `INSERT … ON CONFLICT` on an arbitrary handle lets anyone
   * grow the table without limit. The counter is therefore owned by the gallery
   * row (foreign-keyed to it), and **an unknown handle must create nothing** —
   * it returns `unknown-handle` having written no row and consumed no window.
   *
   * When the gallery exists, the counter is consumed with exactly the semantics
   * of {@link evaluatePrivateGalleryExchangeRate} — an `INSERT … ON CONFLICT DO
   * UPDATE` (or equivalent single transaction) that resets a lapsed window and
   * increments in the same statement. Concurrency and isolation are the
   * adapter's to prove, with its own test; this contract states the invariant.
   *
   * On success it returns the gallery together with the capability row for the
   * gallery's *current* generation, read in the same transaction so a
   * concurrent replace cannot pair a new generation with an old envelope.
   */
  consumeExchangeAttempt(
    handle: string,
    now: Date,
    config: PrivateGalleryExchangeRateConfig,
  ): Promise<PrivateGalleryExchangeLookup>;
};

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/** Constant-time comparison of two already-validated capability secrets. */
function secretsMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export type ResolvedPrivateGalleryCapability = {
  readonly gallery: PrivateGallery;
  readonly capability: PrivateGalleryCapability;
  /** The gallery's validated, still-open access expiry — narrowed once here so
   * the caller does not re-derive (or forget) the fail-closed check. */
  readonly accessExpiresAt: Date;
};

/**
 * The whole server-side half of an exchange, short of minting a session:
 * consume the persistent window, resolve the gallery, check every invariant
 * fail-closed, and **verify the submitted capability against the stored
 * envelope in constant time**.
 *
 * Every rejection is a classified throw. The caller — `private-gallery-access.ts`
 * — collapses all of them to one indistinguishable failure, because a response
 * that differed by class would tell a prober whether a handle exists (ADR-0014
 * §3: the bootstrap "never reveals whether the handle exists").
 *
 * The **requested** handle, never a store-returned value, is what goes into the
 * capability's associated data; a gallery row whose own `galleryHandle`
 * disagrees is refused as a defect rather than silently accepted as an alias.
 */
export async function resolveVerifiedPrivateGalleryCapability(
  deps: {
    readonly store: PrivateGalleryExchangeStore;
    readonly keyring: PrivateGalleryCapabilityKeyring;
    readonly rateConfig?: PrivateGalleryExchangeRateConfig;
  },
  params: {
    readonly handle: string;
    readonly submittedSecret: string;
    readonly now: Date;
  },
): Promise<ResolvedPrivateGalleryCapability> {
  const { store, keyring, rateConfig = PRIVATE_GALLERY_EXCHANGE_RATE_CONFIG } =
    deps;
  const { handle, submittedSecret, now } = params;

  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  assertPrivateGalleryHandleShape(handle);

  // A malformed submitted secret and a well-formed wrong one are one class: the
  // difference has no operational value and keeping them apart would only give
  // a log reader a finer oracle than the response has.
  try {
    assertCapabilitySecret(submittedSecret);
  } catch {
    fail("capability-mismatch", "the submitted capability is not usable");
  }

  const lookup = await store.consumeExchangeAttempt(handle, now, rateConfig);
  if (lookup.outcome === "unknown-handle") {
    fail("not-found", "no gallery answers to this handle");
  }
  if (lookup.outcome === "rate-limited") {
    fail(
      "rate-limited",
      "this gallery's exchange window is exhausted",
      lookup.firstRefusalInWindow,
    );
  }

  const { gallery, capability } = lookup;

  if (
    typeof gallery.galleryId !== "string" ||
    gallery.galleryId.length === 0 ||
    !Number.isSafeInteger(gallery.capabilityGeneration) ||
    gallery.capabilityGeneration < 0 ||
    gallery.galleryHandle !== handle
  ) {
    fail("malformed-record", "the stored gallery row is inconsistent");
  }

  // A revoke moves the gallery to `access-suspended`, so this is where an
  // ordinary revoked link stops — before any capability lookup.
  if (!isPrivateGalleryCustomerVisible(gallery.state)) {
    fail("not-available", "the gallery is not currently published");
  }

  const accessExpiresAt = gallery.accessExpiresAt;
  if (!isFiniteDate(accessExpiresAt)) {
    fail("malformed-record", "a published gallery has no usable access expiry");
  }
  if (now.getTime() >= accessExpiresAt.getTime()) {
    fail("access-expired", "the gallery's access window has closed");
  }

  if (capability === undefined) {
    // Not the normal revoked state — that one is `access-suspended` above. A
    // *published* generation with no capability is an incomplete publication or
    // replacement, i.e. a data-integrity defect worth an operational event.
    fail("no-capability", "the current generation has no capability record");
  }

  if (
    capability.galleryId !== gallery.galleryId ||
    capability.capabilityGeneration !== gallery.capabilityGeneration
  ) {
    fail("malformed-record", "the capability row belongs to another generation");
  }

  let envelopeKeyId: string;
  try {
    envelopeKeyId = capabilityEnvelopeKeyId(capability.envelope);
  } catch {
    fail("malformed-record", "the stored capability envelope is unreadable");
  }
  if (envelopeKeyId !== capability.keyId) {
    fail("malformed-record", "the capability row and envelope disagree on keyId");
  }

  let storedSecret: string;
  try {
    storedSecret = openCapability(
      keyring,
      {
        galleryId: gallery.galleryId,
        handle,
        generation: gallery.capabilityGeneration,
      },
      capability.envelope,
    );
  } catch {
    // A stored envelope that will not open under this deployment's keyring is a
    // defect (a retired key, a corrupt row) — never a statement about the
    // visitor's own credential.
    fail("malformed-record", "the stored capability envelope could not be opened");
  }

  if (!secretsMatch(storedSecret, submittedSecret)) {
    fail("capability-mismatch", "the submitted capability does not match");
  }

  return { gallery, capability, accessExpiresAt };
}
