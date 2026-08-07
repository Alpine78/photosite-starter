import {
  resolveContentRedirect,
  type ContentRedirects,
} from "@/lib/content-redirects";
import { resolveStoryRoute, type StoryRoute } from "@/lib/content-routes";
import {
  buildStoryPath,
  resolvePrefixedRoute,
  type LocaleRoute,
  type LocaleRouteConfig,
  type LocalizedContentTrees,
} from "@/lib/locale-routes";

export type LocalePrefixSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type LocalizedContentRedirects = ReadonlyMap<string, ContentRedirects>;

export type LocalePrefixRequestResolution =
  | { readonly kind: "redirect"; readonly location: string }
  /** A public content-tree branch in one locale's story namespace. */
  | {
      readonly kind: "story";
      readonly locale: string;
      readonly route: StoryRoute;
    }
  | { readonly kind: "not-found" };

type DefaultLocaleRouteExists = (path: string) => boolean | Promise<boolean>;

const NOT_FOUND = { kind: "not-found" } as const;

/**
 * A path segment in the public route contract, in any casing. A path is
 * identity, so a variant spelling of it normalizes to one canonical form
 * (ADR-0003 decision 8); anything that is not a route segment at all — a
 * separator, dot traversal, a control character — still fails closed.
 */
const ROUTE_SEGMENT_PATTERN = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;

/** Serializes incoming query values without treating any value as URL syntax. */
function buildQueryString(searchParams: LocalePrefixSearchParams): string {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(searchParams)) {
    if (value === undefined) continue;
    for (const single of Array.isArray(value) ? value : [value]) {
      params.append(name, single);
    }
  }
  const query = params.toString();
  return query.length === 0 ? "" : `?${query}`;
}

function toPath(segments: readonly string[]): string {
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/**
 * Resolves already-lowercased path segments inside one locale's route space
 * against that locale's story namespace and content tree.
 */
function resolveStorySegments(
  trees: LocalizedContentTrees,
  localeRoute: LocaleRoute,
  segments: readonly string[],
): StoryRoute | null {
  const [namespace, ...branch] = segments;
  if (namespace !== localeRoute.storyNamespace) return null;

  const tree = trees.get(localeRoute.locale);
  return tree === undefined ? null : resolveStoryRoute(tree, branch);
}

/**
 * The current path of a previously published branch in this locale's space, or
 * `null` when the path has no recorded history.
 */
function resolveHistoricalStoryPath(
  config: LocaleRouteConfig,
  redirects: LocalizedContentRedirects,
  localeRoute: LocaleRoute,
  segments: readonly string[],
): string | null {
  const [namespace, ...branch] = segments;
  if (namespace !== localeRoute.storyNamespace) return null;

  const target = resolveContentRedirect(
    redirects.get(localeRoute.locale),
    branch,
  );
  return target === null
    ? null
    : buildStoryPath(config, localeRoute.locale, target);
}

/**
 * Visitor-facing decision at the dynamic locale-prefix boundary.
 *
 * Static routes win over the dynamic segment, so what arrives here is the
 * locale-prefixed route space plus everything the default locale's own routes
 * did not claim. Four outcomes:
 *
 * - the redundant default-locale prefix (`/fi/...`) redirects permanently to
 *   the unprefixed canonical path, but only to an exact route that exists;
 * - a path that differs from its canonical form only by casing, or one a move
 *   or rename has retired, redirects permanently to the current canonical form;
 * - a public content-tree branch renders in the locale that owns it; and
 * - anything else is an ordinary unknown path.
 *
 * Every redirect it emits is direct. A retired path reached through the
 * redundant prefix resolves to the current canonical path in one hop rather
 * than bouncing through the unprefixed retired one, because ADR-0003 decision 7
 * rejects chains.
 *
 * An unresolved localized path 404s rather than redirecting a visitor into
 * another language, and an unknown branch 404s rather than redirecting to an
 * ancestor it has no evidence for.
 */
export async function resolveLocalePrefixRequest({
  config,
  trees,
  redirects,
  prefix,
  segments = [],
  searchParams,
  defaultLocaleRouteExists,
}: {
  readonly config: LocaleRouteConfig;
  /** One validated tree per locale that publishes content; see `content.ts`. */
  readonly trees: LocalizedContentTrees;
  /** Recorded path history per locale, from the same source as the trees. */
  readonly redirects: LocalizedContentRedirects;
  readonly prefix: string;
  readonly segments?: readonly string[];
  readonly searchParams: LocalePrefixSearchParams;
  readonly defaultLocaleRouteExists: DefaultLocaleRouteExists;
}): Promise<LocalePrefixRequestResolution> {
  const resolution = resolvePrefixedRoute(config, prefix, segments);
  const defaultRoute = config.byLocale.get(config.defaultLocale);
  if (defaultRoute === undefined) return NOT_FOUND;

  const query = buildQueryString(searchParams);
  const redirectTo = (location: string) =>
    ({ kind: "redirect", location: `${location}${query}` }) as const;

  if (resolution.kind === "redundant-default-prefix") {
    // Treat path values as untrusted even though Next normally supplies decoded
    // segments. This prevents separators, dot traversal, control characters, or
    // protocol-relative targets from reaching the Location header if the helper
    // is reused at another HTTP boundary.
    if (!segments.every((segment) => ROUTE_SEGMENT_PATTERN.test(segment))) {
      return NOT_FOUND;
    }

    // Normalized first: a redundant prefix and a casing variant are two
    // spellings of one identity, and the visitor should reach the canonical
    // form in one redirect rather than one per defect.
    const canonical = segments.map((segment) => segment.toLowerCase());

    if (resolveStorySegments(trees, defaultRoute, canonical) !== null) {
      return redirectTo(toPath(canonical));
    }

    const historical = resolveHistoricalStoryPath(
      config,
      redirects,
      defaultRoute,
      canonical,
    );
    if (historical !== null) return redirectTo(historical);

    return (await defaultLocaleRouteExists(toPath(canonical)))
      ? redirectTo(toPath(canonical))
      : NOT_FOUND;
  }

  // Anything that is not a locale prefix belongs to the unprefixed route space,
  // where the first segment is an ordinary path segment again.
  const localeRoute =
    resolution.kind === "localized"
      ? config.byLocale.get(resolution.locale)
      : defaultRoute;
  const requested =
    resolution.kind === "localized"
      ? resolution.segments
      : [prefix, ...segments];

  if (
    localeRoute === undefined ||
    !requested.every((segment) => ROUTE_SEGMENT_PATTERN.test(segment))
  ) {
    return NOT_FOUND;
  }

  const canonical = requested.map((segment) => segment.toLowerCase());
  const route = resolveStorySegments(trees, localeRoute, canonical);

  if (route === null) {
    const historical = resolveHistoricalStoryPath(
      config,
      redirects,
      localeRoute,
      canonical,
    );
    return historical === null ? NOT_FOUND : redirectTo(historical);
  }

  if (canonical.some((segment, index) => segment !== requested[index])) {
    return redirectTo(
      buildStoryPath(config, localeRoute.locale, canonical.slice(1)),
    );
  }

  // A category listing accepts `?cursor=` by ADR-0003 decision 8, but no
  // category cursor is issued yet: the continuation contract is AB#66's and
  // AB#72's. Every token that could arrive today is therefore foreign or stale,
  // and the decision answers those with a 404 rather than silently serving the
  // first page as if it were a later slice.
  if (searchParams.cursor !== undefined) return NOT_FOUND;

  return { kind: "story", locale: localeRoute.locale, route };
}
