import {
  getLocaleRoute,
  resolvePrefixedRoute,
  type LocaleRouteConfig,
  type LocaleVersion,
} from "@/lib/locale-routes";

export type StaticPageKind = "home" | "contact";

/** Fixed application page identities, inside a deployment-owned locale base. */
export function buildStaticPagePath(
  config: LocaleRouteConfig,
  locale: string,
  kind: StaticPageKind,
): string {
  const route = getLocaleRoute(config, locale);
  if (route === undefined) throw new TypeError(`static page locale "${locale}" is not configured`);
  return kind === "home" ? route.basePath || "/" : `${route.basePath}/contact`;
}

/** Only known static targets are mapped; arbitrary authored paths stay literal. */
export function localizeStaticPageLink(
  config: LocaleRouteConfig,
  locale: string,
  href: string,
): string {
  if (href === "/") return buildStaticPagePath(config, locale, "home");
  if (href === "/contact") return buildStaticPagePath(config, locale, "contact");
  return href;
}

export function staticPageVersions(
  config: LocaleRouteConfig,
  kind: StaticPageKind,
  availableLocales: readonly string[],
): readonly LocaleVersion[] {
  return config.locales.flatMap((route) => availableLocales.includes(route.locale)
    ? [{ locale: route.locale, path: buildStaticPagePath(config, route.locale, kind) }]
    : []);
}

export function resolveStaticPageRequest(
  config: LocaleRouteConfig,
  prefix: string,
  segments: readonly string[] = [],
): { readonly kind: StaticPageKind; readonly locale: string; readonly canonicalPath: string } | undefined {
  const resolution = resolvePrefixedRoute(config, prefix, segments);
  if (resolution.kind !== "localized") return undefined;
  const kind = segments.length === 0
    ? "home"
    : segments.length === 1 && /^[Cc][Oo][Nn][Tt][Aa][Cc][Tt]$/.test(segments[0])
      ? "contact"
      : undefined;
  if (kind === undefined) return undefined;
  return { kind, locale: resolution.locale, canonicalPath: buildStaticPagePath(config, resolution.locale, kind) };
}
