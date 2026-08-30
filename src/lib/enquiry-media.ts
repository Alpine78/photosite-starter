/**
 * Server-only resolution of a public gallery-item enquiry target (AB#60).
 *
 * A visitor asks about one photograph they are looking at. The browser knows
 * only public identities — a curated result's `placementId`, or a dynamic
 * result's `mediaId` (ADR-0002 §1) — and states which kind of result it is
 * (`kind`), because a `placementId` and a `mediaId` share one syntax and one
 * string could be both. This module turns that public reference into the
 * photographer-facing facts an enquiry email needs: the stable `mediaId`, and,
 * when the private dataset records one, the `archiveLocator` that leads from a
 * published image back to its master (ADR-0002 §1).
 *
 * Three boundaries are enforced here, in this order, and each fails closed:
 *
 * 1. **The request is shaped like one of ours.** The route locale must be a
 *    configured locale; `itemId` (and, for a curated request, `contentId`) must
 *    match the site-wide identity syntax and the shared `MAX_ITEM_ID_LENGTH`
 *    bound. Nothing the caller sent is echoed back in an error — an `itemId`
 *    reaching this module is attacker-controlled and is not assumed free of
 *    personal data, and ADR-0004 §5 keeps user-facing errors generic anyway.
 * 2. **The container is a supported public route.** A curated request's
 *    `contentId` must resolve, through the *public content tree* for that exact
 *    locale, to a published, canonically placed `gallery` — the same check
 *    `getPublicContentRoute` already makes for every other by-identity link.
 *    A published Sanity `gallery` document on its own does not establish this;
 *    the tree does. This runs before the content source is consulted, so an
 *    unauthorized container never reaches a store query.
 * 3. **The photograph is enquirable.** `publiclyRenderable AND enquiryEligible
 *    AND NOT privateOnly` (ADR-0002 §3/§4), plus `dynamicallyDiscoverable` for a
 *    dynamic request (ADR-0012 §2). `enquiryEligible` is media-owned, opt-in,
 *    and never inferred from publication.
 *
 * The resolved target — `archiveLocator` included — is for a server-side
 * consumer (PR2's enquiry email). It must never be serialized into a browser
 * payload; the public gallery result contract (`gallery-result.ts`) carries no
 * such field and this module adds none to it.
 *
 * Dynamic resolution is real in the pure and mock layers so the seam and its
 * authorization are tested now, but a Sanity deployment has no authoritative
 * dynamic result to resolve against yet — AB#58 (the dynamic query) and AB#68
 * (`dynamicallyDiscoverable` in the model) are its prerequisites — so the Sanity
 * source refuses a dynamic enquiry (`dynamic-unsupported`) rather than
 * authorizing one on partial information. AB#60 stays open until a real dynamic
 * result exists to wire in.
 */

import "server-only";

import { getContentTrees } from "@/lib/content";
import { getPublicContentRoute } from "@/lib/content-routes";
import { dispatchContentSource } from "@/lib/content-source";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { MAX_ITEM_ID_LENGTH } from "@/lib/gallery-pagination";

/**
 * What the browser submits. `kind` is stated by the caller, never inferred from
 * "did a placement match": a curated `placementId` and a dynamic `mediaId` are
 * one syntax, and inferring the kind would let a stale or wrong-container
 * curated reference silently resolve as a dynamic one.
 */
export type EnquiryTargetRequest =
  | {
      readonly kind: "curated";
      /** A configured route locale, e.g. `en-GB`. */
      readonly locale: string;
      /** The gallery's stable content-tree identity. */
      readonly contentId: string;
      /** `itemId === placementId` for a curated result (ADR-0002 §1). */
      readonly itemId: string;
    }
  | {
      readonly kind: "dynamic";
      readonly locale: string;
      /** `itemId === mediaId` for a dynamic result (ADR-0002 §1). */
      readonly itemId: string;
    };

/**
 * The photographer-facing facts an enquiry needs. A discriminated union, so a
 * dynamic target cannot carry a `placementId` and a curated one always does —
 * the same shape `gallery-result.ts` gives its curated and dynamic items.
 *
 * `caption`/`credit` are the ADR-0002-resolved values (placement override, then
 * media default) carried for the enquiry email's context; `archiveLocator` is
 * present only when the private dataset recorded one. None of these is
 * visitor-facing output.
 */
export type ResolvedEnquiryTarget =
  | {
      readonly kind: "curated";
      readonly mediaId: string;
      readonly placementId: string;
      readonly contentId: string;
      readonly sectionId?: string;
      readonly archiveLocator?: string;
      readonly caption?: string;
      readonly credit?: string;
    }
  | {
      readonly kind: "dynamic";
      readonly mediaId: string;
      readonly placementId?: never;
      readonly contentId?: never;
      readonly sectionId?: never;
      readonly archiveLocator?: string;
      readonly caption?: string;
      readonly credit?: string;
    };

export type EnquiryResolutionRejection =
  /** The request is not shaped like a supported public item reference. */
  | "malformed-request"
  /** No public item answers to that identity in that container. */
  | "unknown-item"
  /** The container is not a published public route in this locale. */
  | "container-unavailable"
  /** The photograph is not publicly renderable, or is private-only. */
  | "not-public"
  /** The photograph is not opted in to enquiries (or, dynamic: not discoverable). */
  | "not-enquirable"
  /** A dynamic-result enquiry against a source that cannot authorize one yet. */
  | "dynamic-unsupported"
  /**
   * A read against the content store failed in a way a retry could survive —
   * a timeout, a 5xx, a rate limit. The visitor is told it may be worth trying
   * again.
   */
  | "source-unavailable"
  /**
   * A read against the content store failed in a way a retry cannot fix — the
   * credential was refused, the project or dataset is wrong, the query was
   * rejected, or the HTTP envelope was not the documented one. A deployment
   * problem, not the visitor's.
   */
  | "source-error"
  /**
   * A read *succeeded* but returned a shape this resolver cannot trust —
   * distinct from `source-error`: the request reached the store and came back,
   * the data is just wrong.
   */
  | "malformed-source";

/**
 * One fixed message per rejection. Deliberately says nothing about which rule
 * failed for which value: the caller's `itemId`/`contentId`/`locale` are
 * untrusted input, and ADR-0004 §5 keeps user-facing errors generic. A
 * diagnostic that needs the identity belongs in a server log keyed by a
 * correlation id (PR2), and only a project-minted id even then.
 */
const REJECTION_MESSAGES: Record<EnquiryResolutionRejection, string> = {
  "malformed-request":
    "the enquiry request is not shaped like a supported public item reference",
  "unknown-item": "no public item answers to that identity",
  "container-unavailable":
    "the item's gallery is not a published public route in this locale",
  "not-public": "the photograph is not available to the public",
  "not-enquirable": "the photograph is not open to enquiries",
  "dynamic-unsupported":
    "a dynamic-result enquiry is not supported by this content source yet",
  "source-unavailable":
    "a content-store read failed in a way a retry could survive",
  "source-error":
    "a content-store read failed in a way a retry cannot fix",
  "malformed-source":
    "the content store answered with something this resolver cannot trust",
};

export class EnquiryResolutionError extends Error {
  readonly rejection: EnquiryResolutionRejection;

  constructor(rejection: EnquiryResolutionRejection) {
    super(`[enquiry-media] ${REJECTION_MESSAGES[rejection]}`);
    this.name = "EnquiryResolutionError";
    this.rejection = rejection;
  }
}

/**
 * Classifies a failure raised while resolving an enquiry target.
 *
 * `resolveEnquiryTarget` reads the content store more than once for a curated
 * request — `getContentTrees()` for the container authorization, then the source
 * adapter — and its callers read further (`getSiteSettings()`). Every one of
 * those can throw one of the content boundary's own classified errors, and none
 * of them may reach a route as an unclassified 500:
 *
 * - **`SanityQueryError`** is a transport failure. It carries the client's own
 *   retry decision, preserved here: `source-unavailable` when a retry could
 *   survive it, `source-error` when it cannot.
 * - **Any other `Sanity…Error`** (`SanityContentTreeError`, `SanityArticleError`,
 *   `SanityGalleryError`, `SanitySiteSettingsError`, `SanityMediaError`, …) is a
 *   read that *completed* and returned a document the adapter refused to trust —
 *   exactly `malformed-source`.
 *
 * All checks are structural (`name`), so no provider type is imported into this
 * seam — the same approach `gallery.ts` takes with `SanityGalleryError`.
 * Returns `undefined` for a genuine, unclassifiable defect, which the caller
 * then lets propagate.
 */
export function classifyEnquiryFailure(
  error: unknown,
): EnquiryResolutionError | undefined {
  if (error instanceof EnquiryResolutionError) {
    return error;
  }
  if (!(error instanceof Error)) {
    return undefined;
  }
  if (error.name === "SanityQueryError") {
    const retryable = (error as { readonly retryable?: unknown }).retryable;
    if (typeof retryable === "boolean") {
      return new EnquiryResolutionError(
        retryable ? "source-unavailable" : "source-error",
      );
    }
    return undefined;
  }
  if (/^Sanity[A-Za-z]*Error$/.test(error.name)) {
    return new EnquiryResolutionError("malformed-source");
  }
  return undefined;
}

/** The site-wide identity syntax `mediaId` and `placementId` already share. */
const PUBLIC_IDENTITY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type EnquiryEligibilityFlags = {
  readonly publiclyRenderable: boolean;
  readonly enquiryEligible: boolean;
  readonly privateOnly?: boolean;
  /** Required to be `true` only for a dynamic request (ADR-0012 §2). */
  readonly dynamicallyDiscoverable?: boolean;
};

/**
 * ADR-0002 §3/§4's AND, plus ADR-0012 §2's dynamic-discoverability conjunct,
 * composed in one place. Every flag is compared strictly to `true`, so a
 * document written before a flag existed fails closed rather than being assumed
 * enquirable.
 */
export function assertEnquiryEligible(
  flags: EnquiryEligibilityFlags,
  kind: "curated" | "dynamic",
): void {
  if (flags.publiclyRenderable !== true || flags.privateOnly === true) {
    throw new EnquiryResolutionError("not-public");
  }
  if (flags.enquiryEligible !== true) {
    throw new EnquiryResolutionError("not-enquirable");
  }
  if (kind === "dynamic" && flags.dynamicallyDiscoverable !== true) {
    throw new EnquiryResolutionError("not-enquirable");
  }
}

function assertIdentity(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_ITEM_ID_LENGTH ||
    !PUBLIC_IDENTITY.test(value)
  ) {
    throw new EnquiryResolutionError("malformed-request");
  }
}

/**
 * Turns an untrusted reference — PR2 will hand this parsed request JSON — into a
 * validated `EnquiryTargetRequest`, or throws `malformed-request`. Every field
 * is checked by a closed allow-list before anything downstream runs: an
 * unrecognized `kind`, a non-string identity, or a missing field is rejected
 * here rather than skipping a `kind`-guarded authorization branch or reaching a
 * source adapter that would treat it as curated.
 */
function normalizeEnquiryRequest(request: unknown): EnquiryTargetRequest {
  if (request === null || typeof request !== "object") {
    throw new EnquiryResolutionError("malformed-request");
  }
  const raw = request as Record<string, unknown>;
  if (typeof raw.locale !== "string") {
    throw new EnquiryResolutionError("malformed-request");
  }
  assertIdentity(raw.itemId);

  if (raw.kind === "dynamic") {
    // A dynamic result has no container, so a `contentId` alongside it is a
    // malformed request rather than a field to quietly drop — the allow-list is
    // closed per kind, not merely projected.
    if ("contentId" in raw) {
      throw new EnquiryResolutionError("malformed-request");
    }
    return { kind: "dynamic", locale: raw.locale, itemId: raw.itemId };
  }
  if (raw.kind === "curated") {
    assertIdentity(raw.contentId);
    return {
      kind: "curated",
      locale: raw.locale,
      contentId: raw.contentId,
      itemId: raw.itemId,
    };
  }
  throw new EnquiryResolutionError("malformed-request");
}

/**
 * The per-source resolver, injected so a test can prove the container check
 * short-circuits before the store is ever consulted. Production passes
 * {@link resolveViaContentSource}.
 */
export type EnquiryTargetSource = (
  request: EnquiryTargetRequest,
  language: string,
) => Promise<ResolvedEnquiryTarget>;

async function resolveViaContentSource(
  request: EnquiryTargetRequest,
  language: string,
): Promise<ResolvedEnquiryTarget> {
  const { contentSource } = getDeploymentConfig();
  // Both source adapters are loaded dynamically, inside the branch that runs:
  // each carries `server-only` and imports back into this module, so a static
  // import would be a needless module cycle. This mirrors `content.ts`'s own
  // dynamic-import pattern for its source adapters.
  return dispatchContentSource(contentSource, {
    mock: async () => {
      const { resolveMockEnquiryTarget } = await import(
        "@/lib/mock-enquiry-media"
      );
      return resolveMockEnquiryTarget(request, language);
    },
    sanity: async () => {
      const { resolveSanityEnquiryTarget } = await import(
        "@/lib/sanity-enquiry-media"
      );
      return resolveSanityEnquiryTarget(request, language);
    },
  });
}

/**
 * Resolves one public enquiry reference into its server-side target, or throws
 * `EnquiryResolutionError`.
 *
 * `request` is untrusted — PR2 hands this parsed request JSON — so it is
 * normalized against a closed allow-list first. The route locale is then
 * validated against the deployment's configured locales (not merely reduced to
 * a language subtag), so `language` is derived from a real `LocaleRoute` rather
 * than from arbitrary input. For a curated request the container is authorized
 * through the public content tree before `source` is called at all.
 *
 * Everything after the pure request/locale validation — the content-tree read,
 * the authorization, and the source call — is wrapped so a classified
 * content-store failure surfaces as an `EnquiryResolutionError`
 * (`source-unavailable` / `source-error`) rather than an unclassified error a
 * route would answer with a bare 500. A genuine, unclassifiable defect still
 * propagates.
 */
export async function resolveEnquiryTarget(
  request: unknown,
  source: EnquiryTargetSource = resolveViaContentSource,
): Promise<ResolvedEnquiryTarget> {
  const normalized = normalizeEnquiryRequest(request);

  const { localeRoutes } = getDeploymentConfig();
  const localeRoute = localeRoutes.byLocale.get(normalized.locale);
  if (localeRoute === undefined) {
    throw new EnquiryResolutionError("malformed-request");
  }
  const language = new Intl.Locale(localeRoute.locale).language;

  try {
    if (normalized.kind === "curated") {
      const trees = await getContentTrees();
      const route = getPublicContentRoute(
        localeRoutes,
        trees.get(localeRoute.locale),
        localeRoute.locale,
        normalized.contentId,
        "gallery",
      );
      if (route === undefined) {
        throw new EnquiryResolutionError("container-unavailable");
      }
    }

    return await source(normalized, language);
  } catch (error) {
    const classified = classifyEnquiryFailure(error);
    if (classified !== undefined) {
      throw classified;
    }
    throw error;
  }
}
