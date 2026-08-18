import {
  resolveContentRedirect,
  type ContentRedirects,
} from "@/lib/content-redirects";
import { resolveStoryRoute, type StoryRoute } from "@/lib/content-routes";
import { RESERVED_ALL_SECTION_SLUG } from "@/lib/gallery-sections";
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
      /**
       * The opaque continuation token this request carries, when the route has
       * a continuation contract that gives one meaning. Transported unchanged
       * and never interpreted here: only the gallery adapter can say whether it
       * names a slice (ADR-0003 decision 8).
       */
      readonly cursor?: string;
      /**
       * The gallery-local section filter this request carries, when the route
       * is a gallery. `undefined` means the unfiltered `All` view — including
       * when the raw parameter was absent, empty, or the reserved `all` token,
       * all three of which decision 8 normalizes to the same thing before this
       * value is ever set. A section name reaching here has already survived
       * {@link GallerySectionExists} when normalization needed to ask it; an
       * unknown one on an already-canonical path is still possible and is the
       * render layer's to answer, the same way an unvalidated canonical-path
       * cursor is.
       */
      readonly section?: string;
    }
  | { readonly kind: "not-found" };

type DefaultLocaleRouteExists = (path: string) => boolean | Promise<boolean>;

/**
 * Whether a continuation token names a real slice of one gallery.
 *
 * Injected, like `defaultLocaleRouteExists`, because only the gallery adapter
 * holds the signing key — this layer transports tokens and cannot read one. It
 * is consulted at exactly one moment: when a token arrives at a path that needs
 * normalizing, where the answer decides between a redirect and a 404.
 *
 * A cursor's own scope is bound to the section it was minted under (ADR-0003
 * decision 8), so validating it without that context would check it against
 * the wrong scope — the optional `sectionSlug` is this request's already-
 * normalized section value (`undefined` for the unfiltered view), passed
 * through unchanged so the adapter validates the pair together rather than
 * two independent facts.
 */
type GalleryCursorNamesASlice = (
  locale: string,
  contentId: string,
  cursor: string,
  sectionSlug?: string,
) => boolean | Promise<boolean>;

/**
 * Whether a gallery-local section slug names a real, declared section of one
 * gallery.
 *
 * Injected for the same reason {@link GalleryCursorNamesASlice} is: only the
 * gallery adapter holds the declared section catalog. Consulted at exactly the
 * same moment cursor validation is — when a section value arrives at a path
 * that needs normalizing — so an unknown section cannot ride along on a
 * permanent redirect to a spelling that would make it appear meaningful.
 */
type GallerySectionExists = (
  locale: string,
  contentId: string,
  sectionSlug: string,
) => boolean | Promise<boolean>;

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
 * Where a previously published path in this locale's space leads now, or `null`
 * when it has no recorded history — or when its recorded target is not a route
 * this application serves.
 *
 * The second case matters as much as the first. Recorded history covers every
 * variant, while the route space covers only the ones with a renderer, so a
 * retired gallery path has a current canonical target that would answer 404. A
 * permanent redirect onto it would teach browsers and crawlers a dead address,
 * so the path keeps its own honest 404 until that route exists.
 */
function resolveHistoricalStoryTarget(
  config: LocaleRouteConfig,
  trees: LocalizedContentTrees,
  redirects: LocalizedContentRedirects,
  localeRoute: LocaleRoute,
  segments: readonly string[],
): { readonly path: string; readonly route: StoryRoute } | null {
  const [namespace, ...branch] = segments;
  if (namespace !== localeRoute.storyNamespace) return null;

  const target = resolveContentRedirect(
    redirects.get(localeRoute.locale),
    branch,
  );
  if (target === null) return null;

  const tree = trees.get(localeRoute.locale);
  const route = tree === undefined ? null : resolveStoryRoute(tree, target);
  if (route === null) return null;

  return {
    path: buildStoryPath(config, localeRoute.locale, target),
    route,
  };
}

/**
 * What a `cursor` parameter means at this route.
 *
 * `cursor` is the continuation contract's parameter, and ADR-0003 decision 8
 * gives it a meaning at exactly two kinds of address: a category listing and a
 * gallery.
 *
 * - A **gallery** now issues one, so it `carry`s the token to the adapter. Only
 *   the adapter holds the signing key, so only it can tell a slice boundary from
 *   a forgery; this layer transports the value and forms no opinion about it.
 * - A **category listing or the story root** recognizes the parameter but issues
 *   no token, so any that arrives is malformed, stale, or tampered with, and
 *   decision 8 answers those with a 404 rather than a page that quietly ignores
 *   it. Listing continuation is a separate story from AB#72.
 * - An **article** has no continuation contract at all, which makes `cursor` an
 *   ordinary unrecognized parameter: decision 8 reads the parameters it knows
 *   and ignores the rest, so a campaign or referral link never turns a real page
 *   into a 404.
 *
 * `section` is a different parameter with its own disposition — see
 * {@link sectionDisposition} — because ADR-0003 gives it no "recognized but
 * unimplemented" state at any route the way `cursor` has at a category
 * listing: it is either a gallery's own filter or it is nowhere meaningful at
 * all.
 */
function cursorDisposition(route: StoryRoute): "carry" | "reject" | "ignore" {
  if (route.kind !== "content") return "reject";
  return route.variant === "gallery" ? "carry" : "ignore";
}

/**
 * What a `section` parameter means at this route.
 *
 * ADR-0003 decision 8 gives `section` exactly one meaning: a gallery-local
 * filter of that gallery's own curated result. Unlike `cursor`, no other route
 * kind recognizes it even in principle — a category listing, the story root,
 * and an article all treat it as an ordinary unrecognized parameter, which
 * decision 8 reads and ignores rather than 404s on. So this has only two
 * states, never `cursorDisposition`'s "reject": a gallery `carry`s the value
 * to the adapter, and everything else `ignore`s it.
 */
function sectionDisposition(route: StoryRoute): "carry" | "ignore" {
  if (route.kind !== "content") return "ignore";
  return route.variant === "gallery" ? "carry" : "ignore";
}

/**
 * This request's section value, normalized the way decision 8 requires before
 * it reaches a gallery: `undefined` for the unfiltered `All` view, whether the
 * raw parameter was absent, an empty string, the reserved `all` token, or a
 * route that does not carry section at all. A repeated `section` parameter
 * also normalizes to `undefined` here — but only because
 * {@link refusesSection} is always checked against the *raw* value first and
 * refuses that case outright before this function's answer is ever used for
 * anything but the cursor-scope check {@link refusesCursor} needs. This
 * function alone would treat the ambiguous case as silently absent; it is
 * `refusesSection` that makes it a 404 instead.
 */
function normalizedCarriedSection(
  route: StoryRoute,
  rawSection: string | readonly string[] | undefined,
): string | undefined {
  if (sectionDisposition(route) !== "carry") return undefined;
  if (typeof rawSection !== "string") return undefined;
  if (rawSection === "" || rawSection === RESERVED_ALL_SECTION_SLUG) {
    return undefined;
  }
  return rawSection;
}

/**
 * Whether this request's named section is unusable at this route.
 *
 * Mirrors {@link refusesCursor}'s shape and reasoning, minus the "reject"
 * case `sectionDisposition` never has, plus one addition: a repeated
 * `section` parameter is ambiguous the same way a repeated cursor is — there
 * is no single filter to hand the adapter — so it is refused unconditionally,
 * before `normalizing` is even consulted, exactly where `refusesCursor`
 * refuses a non-string cursor. This is also what keeps this route-resolution
 * layer agreeing with `/api/gallery`, which already rejects a repeated
 * `?section=` as an invalid request.
 *
 * Everywhere else, `section` here is the *raw* value — `normalizedCarriedSection`
 * only ever collapses a single string, so calling this with the raw value
 * first and normalizing separately for `refusesCursor`'s scope check is what
 * lets the array case be caught before it is silently normalized away.
 * `undefined` and the alias values (`""`/`all`) both cover the unfiltered
 * view and are never refused. Consulted only when the path is being
 * normalized, for the same reason cursor validation is: on an already-
 * canonical path, the render layer validates the section while building the
 * page, so nothing is read twice.
 */
async function refusesSection(
  locale: string,
  route: StoryRoute,
  rawSection: string | readonly string[] | undefined,
  {
    normalizing,
    sectionExists,
  }: {
    readonly normalizing: boolean;
    readonly sectionExists: GallerySectionExists | undefined;
  },
): Promise<boolean> {
  if (rawSection === undefined) return false;
  if (sectionDisposition(route) !== "carry") return false;
  if (typeof rawSection !== "string") return true;
  if (rawSection === "" || rawSection === RESERVED_ALL_SECTION_SLUG) {
    return false;
  }
  if (!normalizing) return false;
  if (route.kind !== "content") return true;

  // Without a validator the safe answer is the strict one: refuse rather than
  // emit a permanent redirect for a section slug nothing has vouched for.
  if (sectionExists === undefined) return true;
  return !(await sectionExists(locale, route.contentId, rawSection));
}

/**
 * Whether this request's token is unusable at this route.
 *
 * Decision 8 splits the two cases that look alike from here. A path that only
 * differs from its canonical form by casing or a redundant prefix still
 * redirects, **carrying its cursor unchanged** — the token is case-sensitive and
 * is never normalized, and a visitor holding a good continuation URL with an odd
 * spelling should land on the slice it names. Only a token that is malformed,
 * tampered with, wrong-scope, or stale answers 404, and it does so without
 * creating a redirect.
 *
 * Telling those apart needs the adapter, because only it holds the signing key.
 * So `namesASlice` is asked — but only when the answer changes something, which
 * is when the path is being normalized. On a canonical path the token is carried
 * through and the page validates it while rendering, so nothing is read twice.
 *
 * `section` is this request's already-normalized section value (see
 * {@link normalizedCarriedSection}), passed through to `namesASlice` unchanged.
 * A cursor's own scope is bound to the section it was minted under, so
 * validating it without that context would check it against the wrong scope —
 * a cursor issued for a named section would then look wrong-scope against the
 * unfiltered view and refuse a perfectly valid `?section=x&cursor=y` request
 * that merely needed an unrelated normalization (casing, a redundant prefix).
 */
async function refusesCursor(
  locale: string,
  route: StoryRoute,
  cursor: string | readonly string[] | undefined,
  section: string | undefined,
  {
    normalizing,
    namesASlice,
  }: {
    readonly normalizing: boolean;
    readonly namesASlice: GalleryCursorNamesASlice | undefined;
  },
): Promise<boolean> {
  if (cursor === undefined) return false;

  const disposition = cursorDisposition(route);
  // An article's `cursor` is an ordinary unrecognized parameter, so it neither
  // blocks a redirect nor rides along as anything but query text.
  if (disposition === "ignore") return false;
  if (disposition === "reject") return true;

  // A gallery continues from one bookmark. Repeating the parameter names no
  // single slice, so it is refused rather than handed to the adapter as a guess
  // about which of them the visitor meant.
  if (typeof cursor !== "string") return true;
  if (!normalizing) return false;
  if (route.kind !== "content") return true;

  // Without a validator the safe answer is the strict one: refuse rather than
  // emit a permanent redirect for a token nothing has vouched for.
  if (namesASlice === undefined) return true;
  return !(await namesASlice(locale, route.contentId, cursor, section));
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
  galleryCursorNamesASlice,
  gallerySectionExists,
  pathHasTrailingSlash = false,
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
  /**
   * Consulted only when a continuation token arrives at a path that needs
   * normalizing, to choose between redirecting with it and refusing it. Absent,
   * every such token is refused rather than redirected on trust.
   */
  readonly galleryCursorNamesASlice?: GalleryCursorNamesASlice;
  /**
   * Consulted only when a named section arrives at a path that needs
   * normalizing, to choose between redirecting with it and refusing it. Absent,
   * every such section is refused rather than redirected on trust — the same
   * default {@link galleryCursorNamesASlice} takes when it is absent.
   */
  readonly gallerySectionExists?: GallerySectionExists;
  /**
   * Whether the original pathname ended in `/` (apart from the site root).
   * Proxy carries the original bounded path because App Router params omit
   * this spelling difference. It participates in normalization only; it is
   * never copied into the canonical destination.
   */
  readonly pathHasTrailingSlash?: boolean;
}): Promise<LocalePrefixRequestResolution> {
  const resolution = resolvePrefixedRoute(config, prefix, segments);
  const defaultRoute = config.byLocale.get(config.defaultLocale);
  if (defaultRoute === undefined) return NOT_FOUND;

  /**
   * The redirect target's query string, for one destination route.
   *
   * `section=all` and an empty `section=` are decision 8's redundant spelling
   * of the unfiltered view and normalize away on any redirect landing on a
   * gallery — the same class of normalization a casing variant already gets.
   * Everywhere else `section` is an ordinary unrecognized parameter, and
   * decision 8's own rule for those is to preserve them through a redirect
   * happening for another reason, not to strip them — so stripping is scoped
   * to exactly the gallery case, never applied by default.
   */
  const buildRedirectQuery = (route?: StoryRoute): string => {
    if (route === undefined || sectionDisposition(route) !== "carry") {
      return buildQueryString(searchParams);
    }
    const raw = searchParams.section;
    if (
      typeof raw !== "string" ||
      (raw !== "" && raw !== RESERVED_ALL_SECTION_SLUG)
    ) {
      return buildQueryString(searchParams);
    }
    const rest: LocalePrefixSearchParams = { ...searchParams };
    delete rest.section;
    return buildQueryString(rest);
  };
  const redirectTo = (location: string, route?: StoryRoute) =>
    ({
      kind: "redirect",
      location: `${location}${buildRedirectQuery(route)}`,
    }) as const;

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

    const story = resolveStorySegments(trees, defaultRoute, canonical);
    if (story !== null) {
      const section = normalizedCarriedSection(story, searchParams.section);
      if (
        (await refusesCursor(
          defaultRoute.locale,
          story,
          searchParams.cursor,
          section,
          { normalizing: true, namesASlice: galleryCursorNamesASlice },
        )) ||
        (await refusesSection(defaultRoute.locale, story, searchParams.section, {
          normalizing: true,
          sectionExists: gallerySectionExists,
        }))
      ) {
        return NOT_FOUND;
      }
      return redirectTo(toPath(canonical), story);
    }

    const historical = resolveHistoricalStoryTarget(
      config,
      trees,
      redirects,
      defaultRoute,
      canonical,
    );
    if (historical !== null) {
      const section = normalizedCarriedSection(
        historical.route,
        searchParams.section,
      );
      if (
        (await refusesCursor(
          defaultRoute.locale,
          historical.route,
          searchParams.cursor,
          section,
          { normalizing: true, namesASlice: galleryCursorNamesASlice },
        )) ||
        (await refusesSection(
          defaultRoute.locale,
          historical.route,
          searchParams.section,
          { normalizing: true, sectionExists: gallerySectionExists },
        ))
      ) {
        return NOT_FOUND;
      }
      return redirectTo(historical.path, historical.route);
    }

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
    const historical = resolveHistoricalStoryTarget(
      config,
      trees,
      redirects,
      localeRoute,
      canonical,
    );
    if (historical === null) return NOT_FOUND;
    const section = normalizedCarriedSection(
      historical.route,
      searchParams.section,
    );
    const refused =
      (await refusesCursor(
        localeRoute.locale,
        historical.route,
        searchParams.cursor,
        section,
        { normalizing: true, namesASlice: galleryCursorNamesASlice },
      )) ||
      (await refusesSection(
        localeRoute.locale,
        historical.route,
        searchParams.section,
        { normalizing: true, sectionExists: gallerySectionExists },
      ));
    return refused ? NOT_FOUND : redirectTo(historical.path, historical.route);
  }

  const rawSection = searchParams.section;
  const isRedundantSectionAlias =
    sectionDisposition(route) === "carry" &&
    typeof rawSection === "string" &&
    (rawSection === "" || rawSection === RESERVED_ALL_SECTION_SLUG);

  const normalizing =
    (resolution.kind === "localized" && !resolution.prefixIsCanonical) ||
    canonical.some((segment, index) => segment !== requested[index]) ||
    pathHasTrailingSlash ||
    isRedundantSectionAlias;

  const section = normalizedCarriedSection(route, rawSection);

  // Refused before any normalization, so a token or section that means
  // nothing here is a 404 at the address requested rather than a redirect to
  // a different spelling that could make it appear meaningful. The cursor
  // value itself is never normalized — decision 8 makes it case-sensitive.
  if (
    (await refusesCursor(localeRoute.locale, route, searchParams.cursor, section, {
      normalizing,
      namesASlice: galleryCursorNamesASlice,
    })) ||
    (await refusesSection(localeRoute.locale, route, rawSection, {
      normalizing,
      sectionExists: gallerySectionExists,
    }))
  ) {
    return NOT_FOUND;
  }

  if (normalizing) {
    return redirectTo(
      buildStoryPath(config, localeRoute.locale, canonical.slice(1)),
      route,
    );
  }

  const cursor =
    cursorDisposition(route) === "carry" &&
    typeof searchParams.cursor === "string"
      ? searchParams.cursor
      : undefined;

  return {
    kind: "story",
    locale: localeRoute.locale,
    route,
    ...(cursor === undefined ? {} : { cursor }),
    ...(section === undefined ? {} : { section }),
  };
}
