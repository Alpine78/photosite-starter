/**
 * Locale-aware public route contract: which locales a deployment publishes,
 * where each locale's routes live, and how a visitor moves between them.
 *
 * ADR-0003 decision 6 decides these rules; this module is their implementation.
 * The default locale owns the unprefixed visitor-facing route space, every
 * other configured locale lives beneath its own prefix, and each locale reads
 * its content tree beneath its own story namespace:
 *
 * - default locale: `/tarinat/<category-path>/<content-slug>`
 * - prefixed locale: `/en/stories/<category-path>/<content-slug>`
 *
 * Supported locales, the default locale, prefixes, and namespaces are
 * deployment-owned route configuration, never editable CMS content, so this
 * module validates them once at startup and rejects a collision instead of
 * resolving it at request time.
 *
 * It knows nothing about React, Next.js, or the CMS. Route files pass the
 * incoming segments in and act on the returned resolution; `content-tree.ts`
 * owns the tree itself, one tree per locale.
 */

import {
  getCanonicalContentPath,
  getCategoryPath,
  isCategoryPublic,
  type ContentTree,
} from "@/lib/content-tree";

/** Root segments and namespaces are lowercase with hyphens between words. */
const SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type LocaleRouteInput = {
  /** BCP 47 locale tag; normalized to its canonical casing. */
  readonly locale: string;
  /** `null` marks the default locale, whose routes carry no prefix. */
  readonly prefix: string | null;
  /** Human-facing namespace of the content tree, e.g. `tarinat`, `stories`. */
  readonly storyNamespace: string;
};

export type LocaleRouteConfigInput = {
  readonly locales: readonly LocaleRouteInput[];
  /**
   * Root path segments the application already owns: static route segments,
   * public asset directories, and machine routes. A configured locale prefix
   * that collided with one of them would be shadowed by that route, so the
   * collision fails the deployment instead of producing an unreachable locale.
   */
  readonly reservedRootSegments: readonly string[];
  /**
   * Static visitor-facing segments served inside every locale route space.
   * Unlike `reservedRootSegments`, this excludes root-only public assets and
   * machine routes: `/gallery` being an asset directory must not forbid an
   * otherwise valid `/en/gallery` story namespace.
   */
  readonly reservedLocaleRouteSegments: readonly string[];
};

export type LocaleRoute = {
  readonly locale: string;
  readonly prefix: string | null;
  readonly storyNamespace: string;
  /** `""` for the default locale, `"/en"` for a prefixed one. */
  readonly basePath: string;
  readonly isDefault: boolean;
};

export type LocaleRouteConfig = {
  readonly defaultLocale: string;
  /** Default locale first, then the configured order. */
  readonly locales: readonly LocaleRoute[];
  readonly byLocale: ReadonlyMap<string, LocaleRoute>;
  readonly byPrefix: ReadonlyMap<string, LocaleRoute>;
  /**
   * The default locale's own language subtag, e.g. `fi`. Canonical
   * default-locale URLs never carry it, so it is reserved for normalizing the
   * redundant `/fi/...` form rather than for serving content.
   */
  readonly redundantDefaultPrefix: string;
};

/**
 * Configuration violations are `TypeError`s carrying a bare message, like the
 * media boundary's: the loader that read the value adds the setting name.
 */
function fail(message: string): never {
  throw new TypeError(message);
}

type NormalizedLocale = {
  readonly locale: string;
  readonly language: string;
};

function normalizeLocale(value: string): NormalizedLocale | undefined {
  try {
    const parsed = new Intl.Locale(value);
    const language = parsed.language;

    // `und` is a valid BCP 47 tag, but current ICU implementations expose no
    // concrete `language` for it. This route contract needs that subtag for the
    // redundant default-prefix rule, so accepting it would return an object
    // whose declared `redundantDefaultPrefix: string` is actually undefined.
    if (typeof language !== "string" || language.length === 0) return undefined;

    return { locale: parsed.toString(), language };
  } catch {
    return undefined;
  }
}

/**
 * Validates deployment-owned locale routing and resolves the derived values the
 * route layer needs. Every rule below decides a public URL, so a violation
 * fails the deployment rather than being repaired: guessing which locale owns
 * `/en` would publish routes the deployment never chose.
 */
export function buildLocaleRouteConfig({
  locales,
  reservedRootSegments,
  reservedLocaleRouteSegments,
}: LocaleRouteConfigInput): LocaleRouteConfig {
  if (locales.length === 0) {
    fail("at least one locale must be configured");
  }

  const reservedAtRoot = new Set(reservedRootSegments);
  const reservedInsideLocale = new Set(reservedLocaleRouteSegments);
  const byLocale = new Map<string, LocaleRoute>();
  const byPrefix = new Map<string, LocaleRoute>();
  let defaultRoute: LocaleRoute | undefined;
  let defaultLanguage: string | undefined;

  for (const entry of locales) {
    const normalized =
      normalizeLocale(entry.locale) ??
      fail(
        `invalid locale "${entry.locale}": expected a BCP 47 locale tag with a concrete language subtag`,
      );
    const { locale } = normalized;

    if (byLocale.has(locale)) {
      fail(`locale "${locale}" is configured more than once`);
    }
    if (!SEGMENT_PATTERN.test(entry.storyNamespace)) {
      fail(
        `invalid story namespace "${entry.storyNamespace}" for locale "${locale}": expected lowercase segments with hyphens between words`,
      );
    }
    if (reservedInsideLocale.has(entry.storyNamespace)) {
      fail(
        `story namespace "${entry.storyNamespace}" for locale "${locale}" collides with a localized static route`,
      );
    }

    if (entry.prefix !== null) {
      if (!SEGMENT_PATTERN.test(entry.prefix)) {
        fail(
          `invalid locale prefix "${entry.prefix}" for locale "${locale}": expected lowercase segments with hyphens between words`,
        );
      }
      if (reservedAtRoot.has(entry.prefix)) {
        fail(
          `locale prefix "${entry.prefix}" collides with a root route the application already owns`,
        );
      }
      if (byPrefix.has(entry.prefix)) {
        fail(`locale prefix "${entry.prefix}" is claimed by more than one locale`);
      }
    } else if (defaultRoute !== undefined) {
      fail(
        `locales "${defaultRoute.locale}" and "${locale}" both omit a prefix; exactly one locale is the unprefixed default`,
      );
    }

    const route: LocaleRoute = {
      locale,
      prefix: entry.prefix,
      storyNamespace: entry.storyNamespace,
      basePath: entry.prefix === null ? "" : `/${entry.prefix}`,
      isDefault: entry.prefix === null,
    };

    byLocale.set(locale, route);
    if (entry.prefix !== null) byPrefix.set(entry.prefix, route);
    if (entry.prefix === null) {
      defaultRoute = route;
      defaultLanguage = normalized.language;
    }
  }

  if (defaultRoute === undefined || defaultLanguage === undefined) {
    fail("exactly one locale must be configured without a prefix as the default");
  }

  // The default locale's namespace is itself a root segment, and the redundant
  // default prefix is a root segment this contract claims for normalization.
  // Both are cross-checked here rather than in the loop, because the default
  // locale may be configured after a prefixed one.
  if (reservedAtRoot.has(defaultRoute.storyNamespace)) {
    fail(
      `story namespace "${defaultRoute.storyNamespace}" of default locale "${defaultRoute.locale}" collides with a root route the application already owns`,
    );
  }

  const redundantDefaultPrefix = defaultLanguage;

  for (const route of byPrefix.values()) {
    if (route.prefix === defaultRoute.storyNamespace) {
      fail(
        `locale prefix "${route.prefix}" collides with the default locale's story namespace`,
      );
    }
    if (route.prefix === redundantDefaultPrefix) {
      fail(
        `locale prefix "${route.prefix}" collides with the redundant default-locale prefix of "${defaultRoute.locale}"`,
      );
    }
  }

  if (reservedAtRoot.has(redundantDefaultPrefix)) {
    fail(
      `redundant default-locale prefix "${redundantDefaultPrefix}" collides with a root route the application already owns`,
    );
  }
  if (redundantDefaultPrefix === defaultRoute.storyNamespace) {
    fail(
      `redundant default-locale prefix "${redundantDefaultPrefix}" collides with the default locale's story namespace`,
    );
  }

  return {
    defaultLocale: defaultRoute.locale,
    locales: [
      defaultRoute,
      ...[...byLocale.values()].filter((route) => !route.isDefault),
    ],
    byLocale,
    byPrefix,
    redundantDefaultPrefix,
  };
}

/** The configured route for a locale, or `undefined` when it is not supported. */
export function getLocaleRoute(
  config: LocaleRouteConfig,
  locale: string,
): LocaleRoute | undefined {
  const normalized = normalizeLocale(locale);
  return normalized === undefined
    ? undefined
    : config.byLocale.get(normalized.locale);
}

function requireLocaleRoute(
  config: LocaleRouteConfig,
  locale: string,
): LocaleRoute {
  const route = getLocaleRoute(config, locale);
  if (route === undefined) {
    throw new TypeError(`locale "${locale}" is not configured`);
  }
  return route;
}

// ---------------------------------------------------------------------------
// Path composition
// ---------------------------------------------------------------------------

function joinPath(basePath: string, segments: readonly string[]): string {
  const path = segments.filter((segment) => segment.length > 0).join("/");
  if (path.length === 0) return basePath.length === 0 ? "/" : basePath;
  return `${basePath}/${path}`;
}

/**
 * A route path in one locale's route space: `/services` in the default locale,
 * `/en/services` in a prefixed one. Static pages and the story namespace share
 * the same locale base.
 */
export function buildLocalePath(
  config: LocaleRouteConfig,
  locale: string,
  segments: readonly string[] = [],
): string {
  return joinPath(requireLocaleRoute(config, locale).basePath, segments);
}

/**
 * A path beneath one locale's story namespace. With no segments this is the
 * public content-tree root; category paths and canonical content paths from
 * `content-tree.ts` are passed through unchanged.
 */
export function buildStoryPath(
  config: LocaleRouteConfig,
  locale: string,
  segments: readonly string[] = [],
): string {
  const route = requireLocaleRoute(config, locale);
  return joinPath(route.basePath, [route.storyNamespace, ...segments]);
}

// ---------------------------------------------------------------------------
// Incoming route resolution
// ---------------------------------------------------------------------------

export type PrefixedRouteResolution =
  /** A configured non-default locale owns the remaining segments. */
  | {
      readonly kind: "localized";
      readonly locale: string;
      readonly segments: readonly string[];
    }
  /**
   * The redundant default-locale prefix. The route layer redirects permanently
   * to `canonicalPath` only when that exact unprefixed route exists, and
   * otherwise falls back to normal not-found behavior — a blanket redirect
   * would claim a page the deployment does not serve.
   */
  | { readonly kind: "redundant-default-prefix"; readonly canonicalPath: string }
  /** Not a locale prefix at all; the default locale's route space owns it. */
  | { readonly kind: "not-a-locale" };

/**
 * Resolves a first path segment that may be a locale prefix, together with the
 * segments beneath it. Matching is exact: a differently cased prefix is not a
 * locale, because case normalization is a whole-path rule that belongs to the
 * canonical route resolver, not to locale detection.
 */
export function resolvePrefixedRoute(
  config: LocaleRouteConfig,
  prefix: string,
  segments: readonly string[] = [],
): PrefixedRouteResolution {
  const route = config.byPrefix.get(prefix);
  if (route !== undefined) {
    return { kind: "localized", locale: route.locale, segments };
  }

  if (prefix === config.redundantDefaultPrefix) {
    return {
      kind: "redundant-default-prefix",
      canonicalPath: joinPath("", segments),
    };
  }

  return { kind: "not-a-locale" };
}

/**
 * Document-shell locale for a path entering the dynamic prefix segment.
 *
 * A configured non-default prefix owns its locale. The redundant default
 * prefix and an unknown first segment both use the default locale's shell while
 * the leaf route performs its exact redirect or not-found decision. This lets
 * the owning root layout select the configured locale without guessing a
 * language for `/sv/...`.
 */
export function resolveRouteShellLocale(
  config: LocaleRouteConfig,
  prefix: string,
): string {
  const resolution = resolvePrefixedRoute(config, prefix);
  return resolution.kind === "localized"
    ? resolution.locale
    : config.defaultLocale;
}

// ---------------------------------------------------------------------------
// Locale versions and language switching
// ---------------------------------------------------------------------------

/**
 * One validated public content tree per locale, keyed by the configured locale
 * tag. A locale may be absent while its content is still being authored.
 */
export type LocalizedContentTrees = ReadonlyMap<string, ContentTree>;

/**
 * What a visitor is looking at, by stable identity. Localized labels and slugs
 * are never association keys: they are exactly the values a translation
 * changes.
 */
export type ContentLocation =
  | { readonly kind: "content"; readonly contentId: string }
  | { readonly kind: "category"; readonly categoryId: string };

export type LocaleVersion = {
  readonly locale: string;
  /** Canonical, parameter-free path of this locale's published version. */
  readonly path: string;
};

/**
 * The published path of one identity in one locale, or `null` when that locale
 * publishes no version of it. A locale without a version is normal: ADR-0003
 * lets a page publish in one locale without requiring the others to exist.
 */
function resolveLocaleVersionPath(
  config: LocaleRouteConfig,
  trees: LocalizedContentTrees,
  location: ContentLocation,
  locale: string,
): string | null {
  const tree = trees.get(locale);
  if (tree === undefined) return null;

  if (location.kind === "content") {
    const path = getCanonicalContentPath(tree, location.contentId);
    return path === null ? null : buildStoryPath(config, locale, path);
  }

  if (!tree.categories.has(location.categoryId)) return null;
  if (!isCategoryPublic(tree, location.categoryId)) return null;
  return buildStoryPath(
    config,
    locale,
    getCategoryPath(tree, location.categoryId),
  );
}

/**
 * Every published version of one identity, default locale first.
 *
 * This is the alternate-language set: metadata and the sitemap name only these
 * real published versions, including the page's own, and never invent a
 * translation. A caller emitting `x-default` uses the default locale's entry
 * and omits `x-default` when that entry is absent.
 */
export function listPublishedLocaleVersions(
  config: LocaleRouteConfig,
  trees: LocalizedContentTrees,
  location: ContentLocation,
): readonly LocaleVersion[] {
  return config.locales.flatMap((route) => {
    const path = resolveLocaleVersionPath(
      config,
      trees,
      location,
      route.locale,
    );
    return path === null ? [] : [{ locale: route.locale, path }];
  });
}

export type LanguageSwitchResolution =
  /** The target locale publishes this exact content or category. */
  | { readonly kind: "exact"; readonly locale: string; readonly path: string }
  /**
   * The exact version is missing, so the switch opens the target locale's
   * version of the canonical parent category, one tree level up. The visitor
   * has to be told this is not the same page.
   */
  | {
      readonly kind: "parent-category";
      readonly locale: string;
      readonly path: string;
    }
  /**
   * Defensive fallback for invalid or stale data: a valid localized tree always
   * has the parent ancestry. Also the honest answer for a top-level category
   * whose target-locale version is missing.
   */
  | { readonly kind: "story-root"; readonly locale: string; readonly path: string }
  /** The requested locale is not configured; the route layer 404s. */
  | { readonly kind: "unknown-locale" };

/** The canonical parent of a location, read from the locale the visitor is on. */
function resolveParentCategoryId(
  trees: LocalizedContentTrees,
  sourceLocale: string,
  location: ContentLocation,
): string | null {
  const tree = trees.get(sourceLocale);
  if (tree === undefined) return null;

  if (location.kind === "content") {
    return tree.placements.get(location.contentId)?.canonicalCategoryId ?? null;
  }
  return tree.categories.get(location.categoryId)?.parentId ?? null;
}

/**
 * Where an explicit language switch leads.
 *
 * The target is resolved by stable identity rather than by editing the current
 * path: a translated category or content slug differs from the source, so
 * swapping a prefix into the current URL would produce a path that does not
 * exist. The result carries no section or cursor state, because a language
 * version is a different result set and continuing another locale's pagination
 * inside it would be a claim the data does not support.
 *
 * Nothing here inspects `Accept-Language`. Language selection is deliberate
 * navigation; browser language never redirects a visitor.
 */
export function resolveLanguageSwitch(
  config: LocaleRouteConfig,
  trees: LocalizedContentTrees,
  source: { readonly locale: string; readonly location: ContentLocation },
  targetLocale: string,
): LanguageSwitchResolution {
  const targetRoute = getLocaleRoute(config, targetLocale);
  const sourceRoute = getLocaleRoute(config, source.locale);
  if (targetRoute === undefined || sourceRoute === undefined) {
    return { kind: "unknown-locale" };
  }

  const locale = targetRoute.locale;
  const exact = resolveLocaleVersionPath(
    config,
    trees,
    source.location,
    locale,
  );
  if (exact !== null) return { kind: "exact", locale, path: exact };

  const parentCategoryId = resolveParentCategoryId(
    trees,
    sourceRoute.locale,
    source.location,
  );
  if (parentCategoryId !== null) {
    const parentPath = resolveLocaleVersionPath(
      config,
      trees,
      { kind: "category", categoryId: parentCategoryId },
      locale,
    );
    if (parentPath !== null) {
      return { kind: "parent-category", locale, path: parentPath };
    }
  }

  return {
    kind: "story-root",
    locale,
    path: buildStoryPath(config, locale),
  };
}
