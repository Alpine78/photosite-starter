/**
 * ADR-0014 §5 Stage 2: whether one signed object-store URL may be minted, for
 * what key, and for how long — and §8e's two ceilings that bound it.
 *
 * Pure, over the same seams the rest of this boundary uses. The *signer* is a
 * later slice: it needs the object store's credentials, its endpoint, and a
 * live bucket to verify against. What is decided here is everything that comes
 * before a signature, which is where the security actually lives — a signer
 * handed the wrong key or an unbounded expiry is correct and useless.
 *
 * ## The caller never names an object
 *
 * {@link PrivateGalleryMintRequest} has no object-key field, deliberately. A
 * caller supplies a *server-owned* identifier — a `placementId` this deployment
 * minted, or nothing at all for the gallery's one ZIP — and the key comes back
 * from the store row. That is what stops the signed-URL endpoint from being an
 * IDOR probe or a signing oracle: there is no shape of request that names a key
 * to sign, so no validation can be forgotten. §5 states the rule; the type is
 * what enforces it.
 *
 * ## Stage 1 is assumed, and re-checked anyway
 *
 * The caller has already run `authorizePrivateGalleryView` — a valid session
 * for a currently-published gallery at the matching generation. This re-checks
 * the gallery state and the generation regardless, because minting is the step
 * that hands out bytes and the two checks are microseconds apart in cost but a
 * revoke apart in meaning. A gallery that left `published` between the page
 * render and the mint must not produce a URL.
 *
 * ## What a leaked URL costs
 *
 * A minted URL authorizes one object until its own expiry, and neither a revoke
 * nor a generation bump can recall it — the browser talks to the object store
 * directly, which is the whole point of not proxying 20 GB through a Function.
 * The bound is therefore the TTL itself, which is why it is capped twice: at
 * the ADR-fixed maximum for its kind, and at `accessExpiresAt`, so no URL can
 * outlive the access window that justified it.
 */

import {
  isPrivateGalleryCustomerVisible,
  type PrivateGallery,
  type PrivateGalleryPlacement,
  type PrivateGallerySession,
  type PrivateGalleryZipVersion,
} from "@/lib/private-gallery";
import {
  PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_DAYS,
  PRIVATE_GALLERY_DEFAULT_ACCESS_BUDGET_BYTE_MULTIPLIER,
} from "@/lib/private-gallery-limits";

const SECOND_MS = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Time-to-live
// ---------------------------------------------------------------------------

/**
 * A preview URL's default lifetime. ADR-0014 §5 fixes the *class* — "single-digit
 * minutes" — rather than a number, so this is the default and
 * {@link PRIVATE_GALLERY_MAX_PREVIEW_URL_TTL_SECONDS} is the ceiling that makes
 * "single-digit" mean something a test can check.
 *
 * Long enough that a slow connection finishes one thumbnail, short enough that a
 * URL copied out of a page's markup is worthless by the time it is pasted.
 */
export const PRIVATE_GALLERY_DEFAULT_PREVIEW_URL_TTL_SECONDS = 5 * 60;

/** "Single-digit minutes", as a number: nine. */
export const PRIVATE_GALLERY_MAX_PREVIEW_URL_TTL_SECONDS = 9 * 60;

/**
 * The ZIP's ceiling — ADR-fixed at six hours, sized to the download rather than
 * to the page. A 20 GB ceiling over a domestic uplink is hours, and a URL that
 * expired mid-download would strand a customer with no way to resume; the
 * download control re-authorizes and re-mints instead.
 */
export const PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS = 6 * 60 * 60;

/** Which asset class a mint is for. The TTL ceiling follows from it. */
export type PrivateGalleryMintKind = "preview" | "zip";

export const PRIVATE_GALLERY_MAX_URL_TTL_SECONDS: Readonly<
  Record<PrivateGalleryMintKind, number>
> = Object.freeze({
  preview: PRIVATE_GALLERY_MAX_PREVIEW_URL_TTL_SECONDS,
  zip: PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS,
});

export type PrivateGalleryDeliveryErrorReason =
  | "invalid-parameter"
  | "gallery-unavailable"
  | "stale-generation"
  | "wrong-gallery"
  | "unknown-asset"
  | "no-zip"
  | "malformed-record"
  | "access-window-closed"
  | "budget-exhausted";

export class PrivateGalleryDeliveryError extends Error {
  readonly reason: PrivateGalleryDeliveryErrorReason;

  constructor(reason: PrivateGalleryDeliveryErrorReason, message: string) {
    // Never interpolate an object key, a placement id, or a session value.
    super(`[private-gallery-delivery] ${message}`);
    this.name = "PrivateGalleryDeliveryError";
    this.reason = reason;
  }
}

function fail(
  reason: PrivateGalleryDeliveryErrorReason,
  message: string,
): never {
  throw new PrivateGalleryDeliveryError(reason, message);
}

function isFiniteDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isNominalByteCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

/**
 * `min(configuredTTL, accessExpiresAt − now)`, in whole seconds (§5 Stage 2).
 *
 * The second cap is the load-bearing one: without it a URL minted on the last
 * afternoon of the access window would keep working after the gallery had
 * closed, and the six-month promise would be six months plus a TTL. Flooring
 * rather than rounding, so the value can only ever be shorter than both bounds.
 *
 * A result below one second means the window has effectively closed; the caller
 * refuses rather than minting a URL that is already dead.
 */
export function computePrivateGallerySignedUrlTtlSeconds(params: {
  readonly kind: PrivateGalleryMintKind;
  readonly now: Date;
  readonly accessExpiresAt: Date;
  readonly configuredTtlSeconds?: number;
}): number {
  const { kind, now, accessExpiresAt } = params;
  const maximum = PRIVATE_GALLERY_MAX_URL_TTL_SECONDS[kind];
  const configured =
    params.configuredTtlSeconds ??
    (kind === "preview"
      ? PRIVATE_GALLERY_DEFAULT_PREVIEW_URL_TTL_SECONDS
      : PRIVATE_GALLERY_MAX_ZIP_URL_TTL_SECONDS);

  if (!isFiniteDate(now) || !isFiniteDate(accessExpiresAt)) {
    fail("invalid-parameter", "now and accessExpiresAt must be valid dates");
  }
  if (!Number.isFinite(configured) || configured < 1) {
    fail("invalid-parameter", "the configured TTL must be at least one second");
  }
  if (configured > maximum) {
    // A deployment may shorten a TTL and never lengthen one, the same rule the
    // retention windows follow: a longer TTL widens what a leaked URL is worth.
    fail(
      "invalid-parameter",
      `a ${kind} TTL of ${configured}s is above the ADR-0014 §5 maximum of ${maximum}s; a deployment may shorten a signed-URL lifetime but never lengthen one`,
    );
  }

  const remainingMs = accessExpiresAt.getTime() - now.getTime();
  return Math.floor(Math.min(configured * SECOND_MS, remainingMs) / SECOND_MS);
}

// ---------------------------------------------------------------------------
// The per-gallery access budget (§8e)
// ---------------------------------------------------------------------------

/**
 * The persisted counter, keyed by gallery **and capability generation**. A
 * visitor who clears the cookie and re-exchanges gets a new session but the
 * same counter, because the budget is not the session's. A generation bump
 * starts a new one, which is intended: a replaced link is a fresh grant.
 */
export type PrivateGalleryAccessBudgetCounter = {
  readonly windowStartedAt: Date;
  readonly chargedBytes: number;
};

export type PrivateGalleryAccessBudgetConfig = {
  /** Derivatives plus the ZIP — the gallery's own total nominal size. */
  readonly totalGalleryBytes: number;
  readonly multiplier: number;
  readonly windowMs: number;
};

export const PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_MS =
  PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_DAYS * DAY_MS;

export type PrivateGalleryAccessBudgetDecision = {
  readonly allowed: boolean;
  /** True on the attempt that crosses the ceiling, so a caller logs once. */
  readonly firstRefusalInWindow: boolean;
  readonly next: PrivateGalleryAccessBudgetCounter;
};

/**
 * The reference semantics the store's own atomic statement must compute — the
 * same contract shape `evaluatePrivateGalleryExchangeRate` gives the exchange
 * counter, and for the same reason: the policy is testable without a store, and
 * the adapter has something exact to match.
 *
 * **A fixed window, decided rather than defaulted into** (ADR-0014 §8e,
 * amendment 2026-09-02). One counter row cannot express a rolling window: that
 * would need the timestamp and size of every mint, which for a 1 000-file
 * gallery is a thousand rows per full browse, summed on every image load. The
 * fixed form opens on the first charge and resets when it lapses, so **up to
 * twice the allowance can be spent across a boundary** — the ceiling late in one
 * window, the ceiling again early in the next.
 *
 * That is accepted because the budget counts *authorizations, not delivered
 * bytes*: a URL replayed inside its TTL costs nothing and `Range` requests are
 * invisible, so precision was never available in the dimension that matters.
 * Doubling a ceiling already set at ten times the gallery's own size still
 * refuses a scrape, and the per-session mint rate, the short TTLs, and
 * generation revocation all bind first. The documented upgrade path, if the
 * burst shape ever matters, is a two-counter sliding approximation (worst case
 * ~1.1×) — one extra column, not a schema change.
 *
 * A corrupt row **throws** rather than resetting: silently starting a fresh
 * window would let a damaged counter fail open, which is the one direction a
 * budget must never fail.
 */
export function evaluatePrivateGalleryAccessBudget(
  counter: PrivateGalleryAccessBudgetCounter | undefined,
  chargeBytes: number,
  now: Date,
  config: PrivateGalleryAccessBudgetConfig,
): PrivateGalleryAccessBudgetDecision {
  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }
  if (!isNominalByteCount(chargeBytes)) {
    fail("invalid-parameter", "the charged size must be a positive integer");
  }
  if (
    !isNominalByteCount(config.totalGalleryBytes) ||
    !Number.isFinite(config.multiplier) ||
    config.multiplier < 1 ||
    !Number.isFinite(config.windowMs) ||
    config.windowMs <= 0
  ) {
    fail("invalid-parameter", "the access-budget configuration is not usable");
  }

  const ceiling = config.totalGalleryBytes * config.multiplier;

  if (counter === undefined) {
    const allowed = chargeBytes <= ceiling;
    return {
      allowed,
      firstRefusalInWindow: !allowed,
      next: {
        windowStartedAt: new Date(now.getTime()),
        chargedBytes: allowed ? chargeBytes : 0,
      },
    };
  }

  if (
    !isFiniteDate(counter.windowStartedAt) ||
    !Number.isSafeInteger(counter.chargedBytes) ||
    counter.chargedBytes < 0
  ) {
    fail("malformed-record", "the access-budget counter row is unusable");
  }

  const lapsed =
    now.getTime() - counter.windowStartedAt.getTime() >= config.windowMs;
  const base = lapsed ? 0 : counter.chargedBytes;
  const wouldBe = base + chargeBytes;
  const allowed = wouldBe <= ceiling;

  return {
    allowed,
    firstRefusalInWindow: !allowed && base <= ceiling,
    next: {
      windowStartedAt: lapsed
        ? new Date(now.getTime())
        : new Date(counter.windowStartedAt.getTime()),
      // A refused mint is not charged: the bytes were never authorized, and
      // charging them would let a refused request push the window further out.
      chargedBytes: allowed ? wouldBe : base,
    },
  };
}

// ---------------------------------------------------------------------------
// The mint decision
// ---------------------------------------------------------------------------

/**
 * What a caller may ask for. **There is no object-key field**, and there never
 * may be: a preview names a placement this deployment minted, and the ZIP names
 * nothing at all because a gallery has exactly one active one.
 */
export type PrivateGalleryMintRequest =
  | { readonly kind: "preview"; readonly placementId: string }
  | { readonly kind: "zip" };

/**
 * The rows the caller resolved for this request, in the same transaction that
 * read the gallery. A `placement` is required for a preview and ignored for a
 * ZIP; `zipVersion` is the row `gallery.activeZipObjectKey` points at.
 */
export type PrivateGalleryMintSubject = {
  readonly placement?: PrivateGalleryPlacement;
  readonly zipVersion?: PrivateGalleryZipVersion;
};

export type PrivateGalleryMintAuthorization = {
  readonly kind: PrivateGalleryMintKind;
  /** The store-owned key to sign. Never echoed to the browser as itself. */
  readonly objectKey: string;
  readonly ttlSeconds: number;
  readonly expiresAt: Date;
  /** Charged to the budget at the object's full nominal size. */
  readonly chargedBytes: number;
  readonly nextBudget: PrivateGalleryAccessBudgetCounter;
};

/**
 * Stage 2's whole decision, short of producing a signature.
 *
 * Order matters and is deliberate: the free checks that can refuse outright run
 * before the budget is consulted, so a request that was never going to be
 * authorized cannot spend a gallery's allowance. That is the same reason the
 * exchange endpoint puts its header guard ahead of its throttle.
 *
 * Every rejection is a classified throw; the route collapses them into one
 * generic refusal, exactly as the exchange does, because a response that varied
 * by class would tell a holder of one gallery's link which placement ids exist
 * in another.
 */
/**
 * Everything Stage 2 decides **except** the budget: the free checks, the object
 * key, what it costs, and how long a URL for it may live.
 *
 * Split out because the budget is a *persisted* counter whose evaluation the
 * store performs atomically — the same shape `consumeExchangeAttempt` already
 * has. A caller that read the counter, decided here, and wrote it back would
 * race a concurrent mint. This keeps the ordering the security depends on
 * (every free check before anything stateful) available to a caller that lets
 * the store own the increment.
 */
export function planPrivateGalleryMint(params: {
  readonly gallery: PrivateGallery;
  readonly session: PrivateGallerySession;
  readonly request: PrivateGalleryMintRequest;
  readonly subject: PrivateGalleryMintSubject;
  readonly now: Date;
  readonly configuredTtlSeconds?: number;
}): {
  readonly objectKey: string;
  readonly chargedBytes: number;
  readonly ttlSeconds: number;
} {
  const { gallery, session, request, subject, now } = params;

  if (!isFiniteDate(now)) {
    fail("invalid-parameter", "now must be a valid date");
  }

  // Re-checked rather than inherited from Stage 1: minting is the step that
  // hands out bytes, and a gallery can leave `published` between a page render
  // and a click on the download control.
  if (!isPrivateGalleryCustomerVisible(gallery.state)) {
    fail("gallery-unavailable", "the gallery is not currently published");
  }
  if (session.galleryId !== gallery.galleryId) {
    fail("wrong-gallery", "the session belongs to another gallery");
  }
  if (session.capabilityGeneration !== gallery.capabilityGeneration) {
    fail("stale-generation", "the session's capability generation is stale");
  }
  if (!isFiniteDate(gallery.accessExpiresAt)) {
    fail("malformed-record", "a published gallery has no usable access expiry");
  }
  if (now.getTime() >= gallery.accessExpiresAt.getTime()) {
    fail("access-window-closed", "the gallery's access window has closed");
  }

  const { objectKey, chargedBytes } = resolveSubject(gallery, request, subject);

  const ttlSeconds = computePrivateGallerySignedUrlTtlSeconds({
    kind: request.kind,
    now,
    accessExpiresAt: gallery.accessExpiresAt,
    ...(params.configuredTtlSeconds === undefined
      ? {}
      : { configuredTtlSeconds: params.configuredTtlSeconds }),
  });
  if (ttlSeconds < 1) {
    fail(
      "access-window-closed",
      "the access window leaves no usable URL lifetime",
    );
  }

  return { objectKey, chargedBytes, ttlSeconds };
}

export function authorizePrivateGalleryMint(params: {
  readonly gallery: PrivateGallery;
  readonly session: PrivateGallerySession;
  readonly request: PrivateGalleryMintRequest;
  readonly subject: PrivateGalleryMintSubject;
  readonly budget: PrivateGalleryAccessBudgetCounter | undefined;
  readonly now: Date;
  readonly configuredTtlSeconds?: number;
  /**
   * The gallery's own total nominal bytes, and optionally a deployment's
   * tightened multiplier or window. Required, because a budget with no idea how
   * big the gallery is could only be unbounded.
   */
  readonly budgetConfig: {
    readonly totalGalleryBytes: number;
    readonly multiplier?: number;
    readonly windowMs?: number;
  };
}): PrivateGalleryMintAuthorization {
  const { budget, now, request } = params;

  const { objectKey, chargedBytes, ttlSeconds } = planPrivateGalleryMint(params);

  const decision = evaluatePrivateGalleryAccessBudget(budget, chargedBytes, now, {
    totalGalleryBytes: params.budgetConfig.totalGalleryBytes,
    multiplier:
      params.budgetConfig.multiplier ??
      PRIVATE_GALLERY_DEFAULT_ACCESS_BUDGET_BYTE_MULTIPLIER,
    windowMs:
      params.budgetConfig.windowMs ?? PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_MS,
  });
  if (!decision.allowed) {
    fail("budget-exhausted", "the gallery's access budget is exhausted");
  }

  return {
    kind: request.kind,
    objectKey,
    ttlSeconds,
    expiresAt: new Date(now.getTime() + ttlSeconds * SECOND_MS),
    chargedBytes,
    nextBudget: decision.next,
  };
}

/**
 * The key to sign and what it costs, from rows the caller resolved.
 *
 * The gallery-ownership check is the IDOR guard: a placement row is trusted for
 * its key only once it has said it belongs to *this* gallery, so a resolver bug
 * that returned a neighbouring gallery's row is refused here rather than signed.
 */
function resolveSubject(
  gallery: PrivateGallery,
  request: PrivateGalleryMintRequest,
  subject: PrivateGalleryMintSubject,
): { objectKey: string; chargedBytes: number } {
  if (request.kind === "zip") {
    const activeKey = gallery.activeZipObjectKey;
    const version = subject.zipVersion;
    if (activeKey === undefined || version === undefined) {
      // A delivery gallery before its ZIP is verified, or a proof gallery,
      // which has none at all.
      fail("no-zip", "this gallery has no active ZIP object");
    }
    if (version.galleryId !== gallery.galleryId) {
      fail("wrong-gallery", "the ZIP version belongs to another gallery");
    }
    // Minted against the pointer, never against whichever version happened to
    // be handed in: §8c makes the pointer the only answer to "which is current".
    if (version.objectKey !== activeKey) {
      fail("malformed-record", "the ZIP version is not the active one");
    }
    if (!isNominalByteCount(version.nominalBytes)) {
      fail("malformed-record", "the ZIP version has no usable size");
    }
    return { objectKey: activeKey, chargedBytes: version.nominalBytes };
  }

  const placement = subject.placement;
  if (placement === undefined) {
    fail("unknown-asset", "no placement answers to that identifier");
  }
  if (placement.galleryId !== gallery.galleryId) {
    fail("wrong-gallery", "the placement belongs to another gallery");
  }
  if (placement.placementId !== request.placementId) {
    fail("malformed-record", "the resolved placement is not the one requested");
  }
  if (
    typeof placement.objectKey !== "string" ||
    placement.objectKey.length === 0
  ) {
    fail("malformed-record", "the placement has no usable object key");
  }
  if (!isNominalByteCount(placement.nominalBytes)) {
    fail("malformed-record", "the placement has no usable size");
  }
  return {
    objectKey: placement.objectKey,
    chargedBytes: placement.nominalBytes,
  };
}
