/**
 * The one private-gallery entry point a route may import.
 *
 * Everything the exchange actually depends on — the capability crypto, the
 * session model, the store seams, the two rate-limiting layers — lives behind
 * `eslint.config.mjs`'s import ban. This facade owns the complete ordering, so
 * a route cannot compose the pieces itself and accidentally omit the
 * load-bearing one (the constant-time comparison of the submitted capability
 * against the stored envelope). The same reason `@/lib/gallery` is the only way
 * a route reaches a signed cursor.
 *
 * It **never throws**: every outcome, success or failure, is a returned value,
 * so an unhandled error cannot become a response that differs by failure class.
 *
 * ## One indistinguishable failure
 *
 * ADR-0014 §3 requires the bootstrap to show a generic "this link is not valid"
 * state and **never reveal whether the handle exists**. Generic wording is not
 * enough on its own: a different status code, a `Retry-After` header, a
 * different body shape, or different cache headers for "unknown handle" versus
 * "throttled known handle" is an existence oracle regardless of the words. So
 * this facade returns one failure shape for every rejection, and the route must
 * answer all of them identically — same status, same body, no `Retry-After`.
 * Timing cannot be made perfectly uniform, which is why the 128-bit handle
 * remains the primary enumeration protection, exactly as the ADR says.
 *
 * `failure.reason` and `failure.logWorthy` exist for the **operational log**,
 * never for the response.
 */

import "server-only";

import {
  PrivateGalleryExchangeError,
  createPrivateGalleryExchangeIpLimiter,
  resolveVerifiedPrivateGalleryCapability,
  type PrivateGalleryExchangeErrorReason,
  type PrivateGalleryExchangeRateConfig,
  type PrivateGalleryExchangeStore,
} from "@/lib/private-gallery-exchange";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import {
  createPrivateGallerySession,
  PrivateGallerySessionError,
  type PrivateGallerySessionStore,
} from "@/lib/private-gallery-session";

import type { ContactRateLimiter } from "@/lib/contact-rate-limit";
import type { PrivateGallerySessionCookie } from "@/lib/private-gallery-session";
import type { PrivateGallerySession } from "@/lib/private-gallery";

export type { PrivateGallerySessionCookie } from "@/lib/private-gallery-session";
export type { PrivateGallerySession } from "@/lib/private-gallery";
export { createPrivateGalleryExchangeIpLimiter };
export { deriveClientKey } from "@/lib/contact-rate-limit";

/** For the operational log only. Never shaped into a response. */
export type PrivateGalleryExchangeFailure = {
  readonly reason: PrivateGalleryExchangeErrorReason | "session-refused" | "unexpected";
  /**
   * Whether this is a defect worth an operational event. An expected credential
   * failure is not: a prober sending well-formed handles could otherwise flood
   * the log at no cost. Only a data-integrity or configuration defect, and the
   * first refusal of a rate window, are logged — with the class and a
   * correlation id, never the handle or the capability.
   */
  readonly logWorthy: boolean;
};

export type PrivateGalleryExchangeOutcome =
  | {
      readonly ok: true;
      readonly cookie: PrivateGallerySessionCookie;
      readonly session: PrivateGallerySession;
    }
  | { readonly ok: false; readonly failure: PrivateGalleryExchangeFailure };

export type PrivateGalleryExchangeDeps = {
  readonly exchangeStore: PrivateGalleryExchangeStore;
  readonly sessionStore: PrivateGallerySessionStore;
  readonly keyring: PrivateGalleryCapabilityKeyring;
  /** `getDeploymentConfig().privateGallery.routePrefix` — the cookie's path scope. */
  readonly routePrefix: string;
  /** Shared per-process; created once by the route module, not per request. */
  readonly ipLimiter: ContactRateLimiter;
  readonly rateConfig?: PrivateGalleryExchangeRateConfig;
  readonly activeSessionCap?: number;
  readonly sessionTtlMs?: number;
};

export type PrivateGalleryExchangeRequest = {
  readonly handle: string;
  readonly submittedSecret: string;
  /** `deriveClientKey(request)` — a salted, unreversible per-instance key. */
  readonly clientKey: string;
  readonly now: Date;
};

/**
 * Which failures are a defect rather than an ordinary refusal. A revoked or
 * expired link, an unknown handle, and a wrong capability are all *expected* —
 * they are what this endpoint exists to refuse.
 */
const LOG_WORTHY: ReadonlySet<string> = new Set([
  "malformed-record",
  "no-capability",
  "invalid-parameter",
  "session-refused",
  "unexpected",
]);

/**
 * Exchanges a capability for a session, in ADR-0014 §3's order: the cheap
 * per-IP layer, then the persistent per-gallery window and the verified
 * capability lookup (one atomic store operation), then the session.
 *
 * On success the caller sets `cookie` with `NextResponse.cookies.set(cookie.name,
 * cookie.value, cookie.options)` — `cookie.value` is the only place the raw
 * session identifier exists.
 *
 * **Race note.** A revoke or replace can land between the verified lookup and
 * the session insert, leaving a session bound to the previous generation. That
 * is not a disclosure path: every later request re-reads the gallery and
 * `assertPrivateGallerySessionAuthorizesGallery` refuses a stale generation, so
 * such a session cannot authorize even once. The residual is a misleading
 * success and a row the retention worker later reaps. A conditional insert
 * against the current state/generation/expiry would close it outright and is
 * the store adapter's option to take.
 */
export async function exchangePrivateGalleryCapability(
  deps: PrivateGalleryExchangeDeps,
  request: PrivateGalleryExchangeRequest,
): Promise<PrivateGalleryExchangeOutcome> {
  const { handle, submittedSecret, clientKey, now } = request;

  try {
    const ip = deps.ipLimiter.tryConsume(clientKey, now.getTime());
    if (!ip.allowed) {
      return {
        ok: false,
        failure: { reason: "rate-limited", logWorthy: ip.firstRefusalInWindow },
      };
    }

    const resolved = await resolveVerifiedPrivateGalleryCapability(
      {
        store: deps.exchangeStore,
        keyring: deps.keyring,
        ...(deps.rateConfig === undefined ? {} : { rateConfig: deps.rateConfig }),
      },
      { handle, submittedSecret, now },
    );

    const { session, cookie } = await createPrivateGallerySession(
      deps.sessionStore,
      {
        galleryId: resolved.gallery.galleryId,
        galleryHandle: resolved.gallery.galleryHandle,
        routePrefix: deps.routePrefix,
        capabilityGeneration: resolved.gallery.capabilityGeneration,
        accessExpiresAt: resolved.accessExpiresAt,
        now,
        ...(deps.activeSessionCap === undefined
          ? {}
          : { activeSessionCap: deps.activeSessionCap }),
        ...(deps.sessionTtlMs === undefined
          ? {}
          : { ttlMs: deps.sessionTtlMs }),
      },
    );

    return { ok: true, cookie, session };
  } catch (error) {
    if (error instanceof PrivateGalleryExchangeError) {
      return {
        ok: false,
        failure: {
          reason: error.reason,
          logWorthy:
            error.reason === "rate-limited"
              ? error.firstRefusalInWindow
              : LOG_WORTHY.has(error.reason),
        },
      };
    }
    if (error instanceof PrivateGallerySessionError) {
      // The access window closing between the expiry check and the session
      // mint, or a parameter this facade built wrongly.
      return { ok: false, failure: { reason: "session-refused", logWorthy: true } };
    }
    return { ok: false, failure: { reason: "unexpected", logWorthy: true } };
  }
}
