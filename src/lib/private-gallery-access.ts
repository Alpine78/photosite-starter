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
import { getPrivateGalleryDeployment } from "@/lib/private-gallery-deployment";
import { getPrivateGalleryMemoryStore } from "@/lib/private-gallery-memory-store";
import type { PrivateGallerySessionCookie } from "@/lib/private-gallery-session";
import type {
  PrivateGallery,
  PrivateGalleryPlacement,
  PrivateGallerySession,
} from "@/lib/private-gallery";
import {
  PRIVATE_GALLERY_ITEM_LIMITS,
  projectPrivateGalleryItems,
  type PrivateGalleryItem,
} from "@/lib/private-gallery-item";

export type { PrivateGallerySessionCookie } from "@/lib/private-gallery-session";
export type { PrivateGallery, PrivateGallerySession } from "@/lib/private-gallery";
export type { PrivateGalleryItem } from "@/lib/private-gallery-item";
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
