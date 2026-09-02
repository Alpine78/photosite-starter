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
  assertPrivateGalleryHandleShape,
  createPrivateGalleryExchangeIpLimiter,
  resolveVerifiedPrivateGalleryCapability,
  type PrivateGalleryExchangeErrorReason,
  type PrivateGalleryExchangeRateConfig,
  type PrivateGalleryExchangeStore,
} from "@/lib/private-gallery-exchange";
import type { PrivateGalleryCapabilityKeyring } from "@/lib/private-gallery-config";
import {
  assertPrivateGallerySessionAuthorizesGallery,
  createPrivateGallerySession,
  extractPrivateGallerySessionCookie,
  PrivateGallerySessionError,
  readPrivateGallerySession,
  type PrivateGallerySessionErrorReason,
  type PrivateGallerySessionStore,
} from "@/lib/private-gallery-session";

import type { ContactRateLimiter } from "@/lib/contact-rate-limit";
import {
  consumePrivateGalleryAdminLoginAttempt,
  PrivateGalleryAdminLoginError,
  type PrivateGalleryAdminLoginRateConfig,
  type PrivateGalleryAdminLoginStore,
} from "@/lib/private-gallery-admin-login";
import {
  loadPrivateGalleryAdminCredential,
  PrivateGalleryAdminCredentialError,
  verifyPrivateGalleryAdminSecret,
} from "@/lib/private-gallery-admin-credential";
import {
  assertPrivateGalleryAdminReauthenticated,
  authorizePrivateGalleryAdminRequest,
  buildPrivateGalleryAdminSessionClearCookie,
  createPrivateGalleryAdminSession,
  extractPrivateGalleryAdminSessionCookie,
  PrivateGalleryAdminSessionError,
  type PrivateGalleryAdminSessionCookie,
  type PrivateGalleryAdminSessionStore,
} from "@/lib/private-gallery-admin-session";
import type { PrivateGalleryAdminSession } from "@/lib/private-gallery";
import { getPrivateGalleryDeployment } from "@/lib/private-gallery-deployment";
import { getPrivateGalleryMemoryStore } from "@/lib/private-gallery-memory-store";
import type { PrivateGallerySessionCookie } from "@/lib/private-gallery-session";
import type {
  PrivateGallery,
  PrivateGalleryPlacement,
  PrivateGallerySession,
  PrivateGalleryZipVersion,
} from "@/lib/private-gallery";
import {
  planPrivateGalleryMint,
  PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_MS,
  PrivateGalleryDeliveryError,
  type PrivateGalleryAccessBudgetConfig,
  type PrivateGalleryAccessBudgetDecision,
  type PrivateGalleryDeliveryErrorReason,
  type PrivateGalleryMintKind,
  type PrivateGalleryMintRequest,
} from "@/lib/private-gallery-delivery";
import { presignPrivateGalleryObjectUrl } from "@/lib/private-gallery-signed-url";
import { PRIVATE_GALLERY_DEFAULT_ACCESS_BUDGET_BYTE_MULTIPLIER } from "@/lib/private-gallery-limits";
import {
  getPrivateGalleryRuntimeConfig,
  PrivateGalleryConfigurationError,
} from "@/lib/private-gallery-config";
import {
  PRIVATE_GALLERY_ITEM_LIMITS,
  projectPrivateGalleryItems,
  type PrivateGalleryItem,
} from "@/lib/private-gallery-item";

export type { PrivateGallerySessionCookie } from "@/lib/private-gallery-session";
export type { PrivateGallery, PrivateGallerySession } from "@/lib/private-gallery";
export type { PrivateGalleryItem } from "@/lib/private-gallery-item";
export type { PrivateGalleryMintRequest } from "@/lib/private-gallery-delivery";
export { createPrivateGalleryExchangeIpLimiter };
export { deriveClientKey } from "@/lib/contact-rate-limit";

/**
 * Whether a value is shaped like a gallery handle, as a predicate — a route
 * decides with it rather than catching an exception for control flow. A handle
 * that fails this can never name a gallery, so refusing it reveals nothing.
 */
export function isPrivateGalleryHandle(handle: string): boolean {
  try {
    assertPrivateGalleryHandleShape(handle);
    return true;
  } catch {
    return false;
  }
}

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

/** The dependency bundle a private-gallery route needs, for this deployment. */
export type PrivateGalleryStores = {
  readonly exchangeStore: PrivateGalleryExchangeStore;
  readonly sessionStore: PrivateGallerySessionStore;
  readonly viewStore: PrivateGalleryViewStore;
  readonly keyring: PrivateGalleryCapabilityKeyring;
};

/** Raised when a route asks for stores this deployment cannot provide. */
export class PrivateGalleryStoresUnavailableError extends Error {
  constructor(message: string) {
    super(`[private-gallery-access] ${message}`);
    this.name = "PrivateGalleryStoresUnavailableError";
  }
}

/**
 * Resolves this deployment's private-gallery stores.
 *
 * A route must check `getDeploymentConfig().privateGallery.store` and answer
 * `notFound()` while the feature is `off` — reaching here in that state is a
 * wiring mistake, not a runtime condition, so it throws rather than returning
 * an empty store.
 *
 * `enabled` throws too, loudly: the Postgres and object-store adapters are a
 * later slice, and a deployment that turns the feature on before they exist
 * should fail visibly rather than half-serve.
 */
export function getPrivateGalleryStores(): PrivateGalleryStores {
  const { store } = getPrivateGalleryDeployment();

  if (store === "memory") {
    const memory = getPrivateGalleryMemoryStore();
    return {
      exchangeStore: memory.exchangeStore,
      sessionStore: memory.sessionStore,
      viewStore: memory.viewStore,
      keyring: memory.keyring,
    };
  }

  if (store === "enabled") {
    throw new PrivateGalleryStoresUnavailableError(
      'PRIVATE_GALLERY_STORE is "enabled", but no private-gallery store adapter is implemented yet. Use "memory" for development until the Postgres adapter lands.',
    );
  }

  throw new PrivateGalleryStoresUnavailableError(
    'PRIVATE_GALLERY_STORE is "off"; a route must answer notFound() before asking for stores.',
  );
}

// ---------------------------------------------------------------------------
// Session-authorized gallery view (ADR-0014 §5 Stage 1)
// ---------------------------------------------------------------------------

/**
 * The one read a private page needs beyond the session itself.
 *
 * **Keyed by the session's own `galleryId`, never by the handle in the URL.**
 * A `findGalleryByHandle` would be an unauthenticated lookup primitive over a
 * caller-supplied string — cheap to invent, unbounded, and exactly the shape
 * `consumeExchangeAttempt` refuses to be for the same reason. Reading the
 * gallery the *session* names means a visitor can only ever address the one
 * gallery they already hold a session for; the requested handle is then
 * compared to what came back, and a mismatch is refused.
 *
 * The read must be **fresh and uncached per request** (ADR-0014 §5, §9): the
 * whole point of re-authorizing on every request is that a revoke or an expiry
 * takes effect on the next one, which a cached row would defeat.
 */
export type PrivateGalleryViewStore = {
  findGalleryById(galleryId: string): Promise<PrivateGallery | undefined>;
  /**
   * One bounded page of this gallery's placements, in the photographer's
   * authored order. Keyed by `galleryId` for the same reason
   * {@link PrivateGalleryViewStore.findGalleryById} is: the caller has already
   * proved a session for that gallery, and nothing here is ever addressed by
   * something a URL supplied.
   *
   * `limit` is the caller's page bound; a store that returned more is a defect
   * the projection refuses rather than silently truncates.
   */
  listPlacements(
    galleryId: string,
    limit: number,
  ): Promise<readonly PrivateGalleryPlacement[]>;
};

/** For the operational log only, exactly like the exchange's own failure. */
export type PrivateGalleryViewFailure = {
  readonly reason:
    | PrivateGallerySessionErrorReason
    | "wrong-gallery"
    | "gallery-missing"
    | "unexpected";
  readonly logWorthy: boolean;
};

export type PrivateGalleryViewOutcome =
  | {
      readonly authorized: true;
      readonly gallery: PrivateGallery;
      readonly session: PrivateGallerySession;
    }
  | { readonly authorized: false; readonly failure: PrivateGalleryViewFailure };

/**
 * Which view refusals are a defect rather than an ordinary state. An absent,
 * malformed, expired, or superseded session is what this check exists to
 * refuse — a visitor whose link was replaced, or whose week ran out, produces
 * one of those on an ordinary Tuesday. Only a session naming a gallery that no
 * longer exists, or something unclassifiable, says anything is wrong.
 */
const VIEW_LOG_WORTHY: ReadonlySet<string> = new Set([
  "gallery-missing",
  "invalid-parameter",
  "unexpected",
]);

export type PrivateGalleryViewDeps = {
  readonly sessionStore: PrivateGallerySessionStore;
  readonly viewStore: PrivateGalleryViewStore;
};

export type PrivateGalleryViewRequest = {
  /** The handle from the URL. Compared to the session's gallery, never looked up. */
  readonly handle: string;
  /** `request.headers.get("cookie")` — the raw header, not a parsed accessor. */
  readonly cookieHeader: string | null | undefined;
  readonly now: Date;
};

/**
 * ADR-0014 §5 Stage 1, as the one call a private page makes: is this request
 * carrying a session that currently authorizes *this* gallery?
 *
 * Like {@link exchangePrivateGalleryCapability} it **never throws** — every
 * outcome is a value, so a page cannot accidentally turn one failure class into
 * a different response than another. The page renders the same unauthorized
 * bootstrap document for every `authorized: false`, and that document looks
 * nothing up, so a visitor with no session, one whose session expired, and one
 * asking about a handle that names nothing all see the same page.
 *
 * The raw `Cookie` header is taken rather than a framework cookie accessor on
 * purpose: `extractPrivateGallerySessionCookie` refuses a request carrying two
 * session cookies (a host-only one plus a cookie-tossed `Domain` sibling), and
 * a name-keyed accessor has already silently picked one by the time it answers.
 *
 * **A stale cookie is not cleared here.** An App Router page render cannot set
 * one — `cookies().set()` is a Server Action or Route Handler operation — so a
 * dead session simply keeps failing and the bootstrap re-exchanges over it,
 * writing the same name at the same path. Nothing accumulates.
 */
export async function authorizePrivateGalleryView(
  deps: PrivateGalleryViewDeps,
  request: PrivateGalleryViewRequest,
): Promise<PrivateGalleryViewOutcome> {
  const { handle, cookieHeader, now } = request;

  try {
    const cookieValue = extractPrivateGallerySessionCookie(cookieHeader);
    if (cookieValue === undefined) {
      return {
        authorized: false,
        failure: { reason: "invalid-session", logWorthy: false },
      };
    }

    // The session is read first so the gallery read below is keyed by what the
    // session names, never by anything the URL supplied.
    const session = await readPrivateGallerySession(
      deps.sessionStore,
      cookieValue,
      now,
    );
    const gallery = await deps.viewStore.findGalleryById(session.galleryId);
    if (gallery === undefined) {
      return {
        authorized: false,
        failure: { reason: "gallery-missing", logWorthy: true },
      };
    }

    // The URL's handle is compared against the gallery the session already
    // named. A visitor pointing a valid session at another gallery's address
    // gets the unauthorized document, and no store read ever saw that address.
    if (gallery.galleryHandle !== handle) {
      return {
        authorized: false,
        failure: { reason: "wrong-gallery", logWorthy: false },
      };
    }

    assertPrivateGallerySessionAuthorizesGallery(session, gallery, now);

    return { authorized: true, gallery, session };
  } catch (error) {
    if (error instanceof PrivateGallerySessionError) {
      return {
        authorized: false,
        failure: {
          reason: error.reason,
          logWorthy: VIEW_LOG_WORTHY.has(error.reason),
        },
      };
    }
    return { authorized: false, failure: { reason: "unexpected", logWorthy: true } };
  }
}

/**
 * This gallery's items, projected into what a page may render.
 *
 * Separate from {@link authorizePrivateGalleryView} rather than folded into it,
 * because the two answer different questions and a page that is not authorized
 * must never reach this at all — a caller has to hold an authorized gallery
 * before it can ask, and the type is what says so.
 *
 * The bound is applied twice: once as the store's `limit`, and again by
 * `projectPrivateGalleryItems`, which refuses an over-long page rather than
 * truncating it. A store that ignored the limit would be a defect, and a
 * silently short gallery is precisely what must not happen.
 */
export async function listPrivateGalleryItems(
  viewStore: PrivateGalleryViewStore,
  gallery: PrivateGallery,
): Promise<readonly PrivateGalleryItem[]> {
  const placements = await viewStore.listPlacements(
    gallery.galleryId,
    PRIVATE_GALLERY_ITEM_LIMITS.maxPageSize,
  );
  return projectPrivateGalleryItems(placements);
}

// ---------------------------------------------------------------------------
// Signed asset delivery (ADR-0014 §5 Stage 2)
// ---------------------------------------------------------------------------

/**
 * The reads and the one write a mint needs.
 *
 * Both lookups are keyed by the **gallery the session already named**, never by
 * anything a request supplied on its own — the same rule
 * {@link PrivateGalleryViewStore} follows, and the reason a caller can name a
 * `placementId` without that becoming an IDOR primitive.
 *
 * `consumeAccessBudget` is one **atomic** operation, exactly as
 * `consumeExchangeAttempt` is, computing the semantics
 * `evaluatePrivateGalleryAccessBudget` defines. A caller that read the counter,
 * decided, and wrote it back would race a concurrent mint and let two requests
 * each spend the last of an allowance.
 */
export type PrivateGalleryDeliveryStore = {
  findPlacement(
    galleryId: string,
    placementId: string,
  ): Promise<PrivateGalleryPlacement | undefined>;
  findZipVersion(
    galleryId: string,
    objectKey: string,
  ): Promise<PrivateGalleryZipVersion | undefined>;
  consumeAccessBudget(params: {
    readonly galleryId: string;
    readonly capabilityGeneration: number;
    readonly chargeBytes: number;
    readonly now: Date;
    readonly config: PrivateGalleryAccessBudgetConfig;
  }): Promise<PrivateGalleryAccessBudgetDecision>;
  /** The gallery's own total nominal bytes, which the budget is a multiple of. */
  totalGalleryBytes(galleryId: string): Promise<number>;
};

/** For the operational log only, like every other failure in this facade. */
export type PrivateGalleryMintFailure = {
  readonly reason:
    | PrivateGalleryDeliveryErrorReason
    | "no-object-store"
    | "unexpected";
  readonly logWorthy: boolean;
};

export type PrivateGalleryMintOutcome =
  | {
      readonly ok: true;
      readonly url: string;
      readonly kind: PrivateGalleryMintKind;
      readonly expiresAt: Date;
    }
  | { readonly ok: false; readonly failure: PrivateGalleryMintFailure };

/**
 * Which mint refusals are a defect rather than an ordinary state. A gallery that
 * left `published`, a superseded generation, or a closed window are all things a
 * customer meets on an ordinary afternoon; a malformed row, a missing object
 * store, or an unclassifiable error are not.
 *
 * `budget-exhausted` is deliberately log-worthy: it is the one refusal that says
 * something about *usage* rather than about one request, and it is the signal
 * §8e exists to produce.
 */
const MINT_LOG_WORTHY: ReadonlySet<string> = new Set([
  "malformed-record",
  "invalid-parameter",
  "budget-exhausted",
  "no-object-store",
  "unexpected",
]);

export type PrivateGalleryMintDeps = {
  readonly deliveryStore: PrivateGalleryDeliveryStore;
};

export type PrivateGalleryMintUrlRequest = {
  /** An already-authorized gallery, read fresh in this request. */
  readonly gallery: PrivateGallery;
  /** The session `authorizePrivateGalleryView` returned for it. */
  readonly session: PrivateGallerySession;
  readonly request: PrivateGalleryMintRequest;
  readonly now: Date;
};

/**
 * The whole of ADR-0014 §5 Stage 2, as the one call a route makes: resolve the
 * asset, authorize the mint, spend the budget, and sign.
 *
 * This exists because the pieces must not be assembled by a route. The delivery
 * decision and the signer are both behind `eslint.config.mjs`'s import ban, so
 * before this function there was no legal way to reach either — the security
 * ordering was implemented and unreachable. That ordering is the point:
 *
 * 1. every **free** check first (state, generation, ownership of the resolved
 *    row, the TTL), so a request that was never going to be authorized cannot
 *    spend a gallery's allowance;
 * 2. then the **atomic** budget consume, which the store owns;
 * 3. then, and only then, the signature.
 *
 * A route that did this itself could get the order wrong in a way no test of
 * the individual pieces would catch.
 *
 * Like the rest of this facade it **never throws**: every outcome is a value, so
 * a route cannot turn one failure class into a different response than another.
 * The caller answers every `ok: false` identically.
 */
export async function mintPrivateGalleryAssetUrl(
  deps: PrivateGalleryMintDeps,
  params: PrivateGalleryMintUrlRequest,
): Promise<PrivateGalleryMintOutcome> {
  const { gallery, session, request, now } = params;

  try {
    // The object store is read first only to fail fast on a deployment that has
    // none: `memory` and `off` can authorize a mint perfectly well and then have
    // nothing to sign against, and discovering that after spending the budget
    // would charge a gallery for a URL nobody received.
    let objectStore;
    try {
      objectStore = getPrivateGalleryRuntimeConfig().objectStore;
    } catch (error) {
      if (error instanceof PrivateGalleryConfigurationError) {
        return {
          ok: false,
          failure: { reason: "no-object-store", logWorthy: true },
        };
      }
      throw error;
    }

    const subject =
      request.kind === "zip"
        ? {
            ...(gallery.activeZipObjectKey === undefined
              ? {}
              : {
                  zipVersion: await deps.deliveryStore.findZipVersion(
                    gallery.galleryId,
                    gallery.activeZipObjectKey,
                  ),
                }),
          }
        : {
            ...(await (async () => {
              const placement = await deps.deliveryStore.findPlacement(
                gallery.galleryId,
                request.placementId,
              );
              return placement === undefined ? {} : { placement };
            })()),
          };

    const plan = planPrivateGalleryMint({
      gallery,
      session,
      request,
      subject,
      now,
    });

    const decision = await deps.deliveryStore.consumeAccessBudget({
      galleryId: gallery.galleryId,
      capabilityGeneration: gallery.capabilityGeneration,
      chargeBytes: plan.chargedBytes,
      now,
      config: {
        totalGalleryBytes: await deps.deliveryStore.totalGalleryBytes(
          gallery.galleryId,
        ),
        multiplier: PRIVATE_GALLERY_DEFAULT_ACCESS_BUDGET_BYTE_MULTIPLIER,
        windowMs: PRIVATE_GALLERY_ACCESS_BUDGET_WINDOW_MS,
      },
    });
    if (!decision.allowed) {
      return {
        ok: false,
        failure: {
          reason: "budget-exhausted",
          logWorthy: decision.firstRefusalInWindow,
        },
      };
    }

    const url = presignPrivateGalleryObjectUrl({
      endpoint: objectStore.endpoint,
      bucket: objectStore.bucket,
      region: objectStore.region,
      objectKey: plan.objectKey,
      accessKeyId: objectStore.verifierAccessKeyId,
      secretAccessKey: objectStore.verifierSecretAccessKey,
      expiresInSeconds: plan.ttlSeconds,
      now,
      // Signed, so a recipient cannot alter them: the response carries these
      // whatever metadata the upload happened to set (ADR-0014 §5, §6).
      responseHeaders: {
        cacheControl: "no-store",
        ...(request.kind === "zip"
          ? { contentDisposition: "attachment" }
          : {}),
      },
    });

    return {
      ok: true,
      url,
      kind: request.kind,
      expiresAt: new Date(now.getTime() + plan.ttlSeconds * 1000),
    };
  } catch (error) {
    if (error instanceof PrivateGalleryDeliveryError) {
      return {
        ok: false,
        failure: {
          reason: error.reason,
          logWorthy: MINT_LOG_WORTHY.has(error.reason),
        },
      };
    }
    return { ok: false, failure: { reason: "unexpected", logWorthy: true } };
  }
}


// ---------------------------------------------------------------------------
// Administration (ADR-0015)
// ---------------------------------------------------------------------------

export type { PrivateGalleryAdminSession } from "@/lib/private-gallery";
export type { PrivateGalleryAdminSessionCookie } from "@/lib/private-gallery-admin-session";

/**
 * Why an administrator request was refused. **Operational log only.** Every one
 * of these is answered to the browser identically — ADR-0015 §3 requires a
 * throttled attempt and a wrong secret to be indistinguishable, and there is no
 * reading of "administration is not provisioned" that a stranger is entitled to.
 */
export type PrivateGalleryAdminFailureReason =
  | "rate-limited"
  | "login-counter-malformed"
  | "not-provisioned"
  | "credential-malformed"
  | "wrong-secret"
  | "no-session"
  | "session-refused"
  | "reauthentication-required"
  | "unexpected";

export type PrivateGalleryAdminFailure = {
  readonly reason: PrivateGalleryAdminFailureReason;
  readonly logWorthy: boolean;
};

/**
 * A wrong secret and a throttled attempt are what this boundary exists to
 * refuse; they are not defects. A malformed configured credential, a session the
 * store returned in an unusable shape, and anything unclassified are.
 */
const ADMIN_LOG_WORTHY: ReadonlySet<PrivateGalleryAdminFailureReason> = new Set([
  "login-counter-malformed",
  "not-provisioned",
  "credential-malformed",
  "session-refused",
  "unexpected",
]);

function adminFailure(
  reason: PrivateGalleryAdminFailureReason,
  logWorthy = ADMIN_LOG_WORTHY.has(reason),
): { readonly ok: false; readonly failure: PrivateGalleryAdminFailure } {
  return { ok: false, failure: { reason, logWorthy } };
}

/**
 * Maps a credential-loading failure to this boundary's vocabulary. "Missing" is
 * kept apart from "malformed" for the operational log only: both refuse a login
 * identically, but one means nobody provisioned administration and the other
 * means someone provisioned it wrongly, and an operator reading a log needs to
 * know which.
 */
function adminCredentialFailureReason(
  error: PrivateGalleryAdminCredentialError,
): PrivateGalleryAdminFailureReason {
  return error.reason === "missing" ? "not-provisioned" : "credential-malformed";
}

export type PrivateGalleryAdminLoginDeps = {
  readonly loginStore: PrivateGalleryAdminLoginStore;
  readonly sessionStore: PrivateGalleryAdminSessionStore;
  /** Shared per-process; created once by the route module, not per request. */
  readonly ipLimiter: ContactRateLimiter;
  /** Injected so a test needs no environment; defaults to `process.env`. */
  readonly environment?: Record<string, string | undefined>;
  readonly rateConfig?: PrivateGalleryAdminLoginRateConfig;
  readonly activeSessionCap?: number;
  readonly sessionTtlMs?: number;
};

export type PrivateGalleryAdminLoginRequest = {
  readonly submittedSecret: string;
  /** `deriveClientKey(request)` — a salted, unreversible per-instance key. */
  readonly clientKey: string;
  readonly now: Date;
};

export type PrivateGalleryAdminLoginOutcome =
  | {
      readonly ok: true;
      readonly session: PrivateGalleryAdminSession;
      readonly cookie: PrivateGalleryAdminSessionCookie;
    }
  | { readonly ok: false; readonly failure: PrivateGalleryAdminFailure };

/**
 * Verifies the administrator secret and mints a session, in the one order that
 * is safe (ADR-0015 §3): **throttle first, verify second**.
 *
 * That order is the whole reason this lives behind the facade. `scrypt` is
 * deliberately expensive — roughly 74 ms of CPU per attempt — so a route that
 * verified before consuming the counter would be offering unmetered CPU to
 * anyone who can reach it, and every individual piece would still pass its own
 * tests.
 *
 * The credential is resolved **after** the throttle for the same reason a
 * refusal carries no detail: an unprovisioned deployment must not be
 * distinguishable, by timing or otherwise, from a throttled one.
 *
 * Never throws. On success the caller sets `cookie` with
 * `NextResponse.cookies.set(cookie.name, cookie.value, cookie.options)` —
 * `cookie.value` is the only place the raw session identifier exists.
 */
export async function attemptPrivateGalleryAdminLogin(
  deps: PrivateGalleryAdminLoginDeps,
  request: PrivateGalleryAdminLoginRequest,
): Promise<PrivateGalleryAdminLoginOutcome> {
  try {
    const attempt = await consumePrivateGalleryAdminLoginAttempt({
      ipLimiter: deps.ipLimiter,
      store: deps.loginStore,
      clientKey: request.clientKey,
      now: request.now,
      ...(deps.rateConfig === undefined ? {} : { config: deps.rateConfig }),
    });
    if (attempt.outcome === "refused") {
      return adminFailure("rate-limited", attempt.firstRefusalInWindow);
    }

    const credential = loadPrivateGalleryAdminCredential(
      deps.environment ?? process.env,
    );

    if (!verifyPrivateGalleryAdminSecret(credential, request.submittedSecret)) {
      return adminFailure("wrong-secret");
    }

    const { session, cookie } = await createPrivateGalleryAdminSession(
      deps.sessionStore,
      {
        credentialGeneration: credential.generation,
        now: request.now,
        ...(deps.activeSessionCap === undefined
          ? {}
          : { activeSessionCap: deps.activeSessionCap }),
        ...(deps.sessionTtlMs === undefined
          ? {}
          : { ttlMs: deps.sessionTtlMs }),
      },
    );

    return { ok: true, session, cookie };
  } catch (error) {
    if (error instanceof PrivateGalleryAdminLoginError) {
      // A corrupt counter row refuses the login rather than failing open, and
      // says which row it was: "nobody can log in" is otherwise a long evening.
      return adminFailure(
        error.reason === "malformed-record"
          ? "login-counter-malformed"
          : "unexpected",
      );
    }
    if (error instanceof PrivateGalleryAdminCredentialError) {
      return adminFailure(adminCredentialFailureReason(error));
    }
    if (error instanceof PrivateGalleryAdminSessionError) {
      return adminFailure("session-refused");
    }
    return adminFailure("unexpected");
  }
}

export type PrivateGalleryAdminRequestDeps = {
  readonly sessionStore: PrivateGalleryAdminSessionStore;
  readonly environment?: Record<string, string | undefined>;
};

export type PrivateGalleryAdminRequest = {
  /** The raw `Cookie` header — `request.headers.get("cookie")`. */
  readonly cookieHeader: string | null | undefined;
  readonly now: Date;
};

export type PrivateGalleryAdminAuthorization =
  | { readonly ok: true; readonly session: PrivateGalleryAdminSession }
  | { readonly ok: false; readonly failure: PrivateGalleryAdminFailure };

/**
 * The per-request administrator authorization every administrator route and
 * **every administrator mutation** runs (ADR-0015 §2). There is no "the page
 * loaded, so the mutation is authorized" gap, exactly as ADR-0014 §5 Stage 1
 * leaves none for customers.
 *
 * The credential is re-resolved here rather than carried from login, which is
 * what makes rotation a revocation: the session's stored generation is compared
 * against the deployment's current one on every request, so changing
 * `PRIVATE_GALLERY_ADMIN_SECRET_HASH` and redeploying ends every live session
 * with no table to clear.
 *
 * Never throws.
 */
export async function authorizePrivateGalleryAdministrator(
  deps: PrivateGalleryAdminRequestDeps,
  request: PrivateGalleryAdminRequest,
): Promise<PrivateGalleryAdminAuthorization> {
  try {
    const cookieValue = extractPrivateGalleryAdminSessionCookie(
      request.cookieHeader,
    );
    if (cookieValue === undefined) {
      return adminFailure("no-session", false);
    }

    const credential = loadPrivateGalleryAdminCredential(
      deps.environment ?? process.env,
    );

    const session = await authorizePrivateGalleryAdminRequest(
      deps.sessionStore,
      cookieValue,
      credential.generation,
      request.now,
    );

    return { ok: true, session };
  } catch (error) {
    if (error instanceof PrivateGalleryAdminCredentialError) {
      return adminFailure(adminCredentialFailureReason(error));
    }
    if (error instanceof PrivateGalleryAdminSessionError) {
      // An expired, unknown, or superseded session is the ordinary state of a
      // browser left open; only an unusable stored row is a defect worth an
      // operator's attention. The session module classifies the two, so this
      // reads a reason rather than a message.
      return adminFailure(
        "session-refused",
        error.reason === "malformed-record",
      );
    }
    return adminFailure("unexpected");
  }
}

/**
 * The extra gate an irreversible operation passes — delete, revoke, replace
 * (ADR-0015 §2). Run it **after** {@link authorizePrivateGalleryAdministrator}
 * on the session that returned; it asks only whether the credential was proved
 * recently and says nothing about whether the session is otherwise valid.
 *
 * Never throws.
 */
export function requirePrivateGalleryAdminReauthentication(
  session: PrivateGalleryAdminSession,
  now: Date,
): { readonly ok: true } | { readonly ok: false; readonly failure: PrivateGalleryAdminFailure } {
  try {
    assertPrivateGalleryAdminReauthenticated(session, now);
    return { ok: true };
  } catch (error) {
    if (error instanceof PrivateGalleryAdminSessionError) {
      return adminFailure(
        error.reason === "reauthentication-required"
          ? "reauthentication-required"
          : "session-refused",
      );
    }
    return adminFailure("unexpected");
  }
}

/** The `Set-Cookie` descriptor for administrator logout. */
export function buildPrivateGalleryAdminLogoutCookie(): PrivateGalleryAdminSessionCookie {
  return buildPrivateGalleryAdminSessionClearCookie();
}
