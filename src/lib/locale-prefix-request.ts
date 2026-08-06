import {
  resolvePrefixedRoute,
  type LocaleRouteConfig,
} from "@/lib/locale-routes";

export type LocalePrefixSearchParams = Record<
  string,
  string | string[] | undefined
>;

export type LocalePrefixRequestResolution =
  | { readonly kind: "redirect"; readonly location: string }
  | { readonly kind: "not-found" };

type DefaultLocaleRouteExists = (path: string) => boolean | Promise<boolean>;

/** Every canonical route segment in the current public route contract. */
const CANONICAL_ROUTE_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

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

/**
 * Visitor-facing decision at the dynamic locale-prefix boundary.
 *
 * Only the redundant default prefix can redirect, and only to an exact route
 * known to exist. Configured non-default prefixes are left for localized pages
 * in their own route space; until a matching page exists, the catch-all emits
 * a 404 rather than changing the visitor's language.
 */
export async function resolveLocalePrefixRequest({
  config,
  prefix,
  segments = [],
  searchParams,
  defaultLocaleRouteExists,
}: {
  readonly config: LocaleRouteConfig;
  readonly prefix: string;
  readonly segments?: readonly string[];
  readonly searchParams: LocalePrefixSearchParams;
  readonly defaultLocaleRouteExists: DefaultLocaleRouteExists;
}): Promise<LocalePrefixRequestResolution> {
  const resolution = resolvePrefixedRoute(config, prefix, segments);

  if (resolution.kind !== "redundant-default-prefix") {
    return { kind: "not-found" };
  }

  // Treat path values as untrusted even though Next normally supplies decoded
  // segments. This prevents separators, dot traversal, control characters, or
  // protocol-relative targets from reaching the Location header if the helper
  // is reused at another HTTP boundary.
  if (!segments.every((segment) => CANONICAL_ROUTE_SEGMENT_PATTERN.test(segment))) {
    return { kind: "not-found" };
  }

  if (!(await defaultLocaleRouteExists(resolution.canonicalPath))) {
    return { kind: "not-found" };
  }

  return {
    kind: "redirect",
    location: `${resolution.canonicalPath}${buildQueryString(searchParams)}`,
  };
}
