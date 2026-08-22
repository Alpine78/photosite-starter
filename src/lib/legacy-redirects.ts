/**
 * The deployment's legacy-URL redirect and retirement registry (AB#19).
 *
 * ADR-0003 decision 9: a legacy Joomla page maps directly to its exact
 * same-language canonical target, or — when no genuine same-visitor-intent
 * replacement exists — a justified `410 Gone`. Never a blanket redirect to a
 * locale root, story root, category, or home page, and never a redirect
 * through another legacy URL (no chains).
 *
 * `content-redirects.ts` owns the content-tree's own move/rename history and
 * already names this module's job as a separate registry: legacy paths use a
 * completely different, disjoint URL taxonomy from `/tarinat` and
 * `/en/stories` (Joomla's own structure, not this site's), so they are never
 * resolved against the content tree at all. Both are flat maps combined into
 * one validated route registry per ADR-0003, but each validates its own
 * source independently.
 *
 * Pure and synchronous: no adapter or content read, so it satisfies
 * `src/proxy.ts`'s documented O(1)/no-content-read constraint and is fully
 * testable without a running server.
 */

import type { LocaleRoute, LocaleRouteConfig } from "@/lib/locale-routes";

/**
 * How a `redirect` row's destination treats `cursor` and `section` — the two
 * query parameter names this application's own route contract gives a
 * specific meaning (ADR-0003 decision 8). Decision 9 requires an *explicit*
 * recorded behavior rather than a blanket default in either direction: a
 * Joomla-era `?cursor=` shares nothing with this app's HMAC-signed
 * continuation tokens, so forwarding it onto a new gallery target could fail
 * validation and 404 a page the legacy URL used to show, or — if the value
 * happens to collide with a real token or section slug — silently show a
 * different one than the legacy URL ever did. `"strip"` is the safe choice
 * absent a verified equivalent, and the only one this codebase's own tests
 * exercise today; `"preserve"` exists for the row that has actually verified
 * its target treats the same values the same way. Every other query
 * parameter always passes through unexamined, regardless of this choice —
 * decision 9's ordinary default for anything this application does not
 * itself interpret.
 */
export type LegacyReservedQueryHandling = "preserve" | "strip";

export type LegacyRedirectOutcome =
  | {
      readonly kind: "redirect";
      readonly target: string;
      readonly reservedQueryParams: LegacyReservedQueryHandling;
    }
  | { readonly kind: "gone"; readonly reason: string };

export type LegacyRedirectEntry = {
  /**
   * An exact, absolute, single pathname — no query string, no fragment. A
   * single optional trailing slash is accepted, because Joomla served at
   * least one real directory-style URL (a bare locale root, `/en/`) that has
   * no slash-free equivalent to alias instead — see
   * {@link isCanonicalLegacyPath}. ADR-0003 decision 9: the query string
   * itself is a separate axis, decided by {@link LegacyReservedQueryHandling}
   * on a `redirect` outcome, not by this field.
   */
  readonly source: string;
  readonly outcome: LegacyRedirectOutcome;
};

export type LegacyRedirectIssueCode =
  | "invalid-source"
  | "invalid-target"
  | "self-redirect"
  | "duplicate-source"
  | "chained-target"
  | "reserved-source";

export type LegacyRedirectIssue = {
  readonly code: LegacyRedirectIssueCode;
  readonly subject: string;
  readonly message: string;
};

export class LegacyRedirectValidationError extends Error {
  readonly issues: readonly LegacyRedirectIssue[];

  constructor(issues: readonly LegacyRedirectIssue[]) {
    super(
      `invalid legacy redirects: ${issues
        .map((issue) => `${issue.subject}: ${issue.message}`)
        .join("; ")}`,
    );
    this.name = "LegacyRedirectValidationError";
    this.issues = issues;
  }
}

export type LegacyRedirects = ReadonlyMap<string, LegacyRedirectOutcome>;

/**
 * A path segment in this registry, lowercase with hyphens between words —
 * the same shape `content-tree.ts` and `content-redirects.ts` already
 * require of a canonical path segment. A legacy *source* is a historical
 * external identifier, not a URL a browser could spell a dozen ways: the
 * crawl inventory this registry is built from already recorded every legacy
 * path in exactly this decoded, lowercase, ASCII shape (Joomla itself
 * transliterated diacritics out of its own slugs), so requiring the same
 * canonical shape here — rather than accepting encoded, mixed-case, or
 * Unicode spellings and normalizing them — means there is exactly one valid
 * spelling per row and no risk of two distinct historical URLs collapsing
 * into one by accident. A request that does not already match this shape
 * (a casing variant, percent-encoding, a repeated separator) simply finds no
 * row and falls through to the site's ordinary not-found handling, per the
 * acceptance criterion that an unknown legacy URL behaves normally.
 *
 * `allowTrailingSlash` exists only for a `source`, never a `target`: the
 * crawl inventory records at least one real directory-style legacy URL (a
 * bare locale root, `/en/`) with no slash-free equivalent it could alias
 * instead, while a `target` is always this application's own canonical route
 * shape, which decision 8 makes slash-free with no exception. `src/proxy.ts`
 * checks the legacy registry *before* its own generic trailing-slash
 * normalization specifically so an exact slash-bearing source like this
 * resolves in one hop rather than being stripped into a different pathname
 * first and chaining through a second redirect to reach it.
 */
function isCanonicalLegacyPath(
  path: string,
  { allowTrailingSlash = false }: { readonly allowTrailingSlash?: boolean } = {},
): boolean {
  if (!path.startsWith("/")) return false;
  if (path === "/") return true;
  const hasTrailingSlash = path.endsWith("/");
  if (hasTrailingSlash && !allowTrailingSlash) return false;
  const bare = hasTrailingSlash ? path.slice(0, -1) : path;
  const segments = bare.slice(1).split("/");
  return segments.every((segment) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment));
}

/**
 * Whether a path falls inside `/api`, `src/proxy.ts`'s own reserved machine
 * namespace (this same file checks `pathname === "/api" ||
 * pathname.startsWith("/api/")` a few lines below its legacy-redirect
 * lookup). A legacy source here is never deployment-specific route
 * configuration the way a story namespace or a static page's path is — every
 * clone of this application reserves `/api` the same way — so this check
 * belongs to the reusable engine itself rather than to first-site data. A
 * legacy source landing here would otherwise silently shadow a real API
 * route, since Proxy checks the legacy registry first.
 */
function isReservedApiPath(path: string): boolean {
  return path === "/api" || path.startsWith("/api/");
}

function compareIssues(a: LegacyRedirectIssue, b: LegacyRedirectIssue) {
  if (a.subject !== b.subject) return a.subject < b.subject ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return a.message < b.message ? -1 : a.message > b.message ? 1 : 0;
}

/**
 * Validates a first-site deployment's legacy-URL rows and returns the
 * lookup `src/proxy.ts` serves requests from.
 *
 * Chains are rejected structurally, the same way `content-redirects.ts`
 * makes them impossible by construction: a `redirect` row's `target` may
 * never itself be another row's `source` — ADR-0003 decision 9's "aliases
 * map directly to the final target, never through another legacy URL."
 * Unlike `content-redirects.ts`, a `target` is not checked against a live
 * content tree here: this module has no adapter access, and no row in this
 * deployment resolves a `redirect` yet — that check belongs to a build-time
 * or e2e test once a `redirect` row exists.
 */
export function buildLegacyRedirects(
  entries: readonly LegacyRedirectEntry[],
): LegacyRedirects {
  const issues: LegacyRedirectIssue[] = [];
  const redirects = new Map<string, LegacyRedirectOutcome>();
  const sources = new Set<string>();

  const fail = (
    code: LegacyRedirectIssueCode,
    subject: string,
    message: string,
  ) => issues.push({ code, subject, message });

  for (const entry of entries) {
    if (!isCanonicalLegacyPath(entry.source, { allowTrailingSlash: true })) {
      fail(
        "invalid-source",
        entry.source,
        `source "${entry.source}" must be an absolute, lowercase, hyphenated path, with at most one trailing slash`,
      );
      continue;
    }

    if (isReservedApiPath(entry.source)) {
      fail(
        "reserved-source",
        entry.source,
        `source "${entry.source}" falls inside the reserved "/api" namespace and would shadow a real API route`,
      );
      continue;
    }

    if (entry.outcome.kind === "redirect") {
      if (!isCanonicalLegacyPath(entry.outcome.target)) {
        fail(
          "invalid-target",
          entry.source,
          `target "${entry.outcome.target}" must be an absolute, lowercase, hyphenated path with no trailing slash`,
        );
        continue;
      }
      if (entry.outcome.target === entry.source) {
        fail(
          "self-redirect",
          entry.source,
          `target "${entry.outcome.target}" is the same as its own source`,
        );
        continue;
      }
    }

    if (sources.has(entry.source)) {
      fail(
        "duplicate-source",
        entry.source,
        `source "${entry.source}" is recorded more than once`,
      );
      continue;
    }

    sources.add(entry.source);
    redirects.set(entry.source, entry.outcome);
  }

  for (const [source, outcome] of redirects) {
    if (outcome.kind === "redirect" && sources.has(outcome.target)) {
      fail(
        "chained-target",
        source,
        `target "${outcome.target}" is itself another legacy source; redirects must point directly at the final target`,
      );
    }
  }

  if (issues.length > 0) {
    throw new LegacyRedirectValidationError(issues.sort(compareIssues));
  }
  return redirects;
}

/** The outcome recorded for this exact pathname, or `undefined` for none. */
export function resolveLegacyRedirect(
  redirects: LegacyRedirects,
  pathname: string,
): LegacyRedirectOutcome | undefined {
  return redirects.get(pathname);
}

/**
 * Query parameter names this application's own route contract gives a
 * specific meaning: `cursor`, a signed continuation bookmark, and `section`,
 * a gallery-local filter (ADR-0003 decision 8).
 */
const RESERVED_QUERY_PARAMS = new Set(["cursor", "section"]);

/**
 * The query string a legacy `redirect` outcome's destination carries,
 * derived from the request's own — never copied unchanged.
 *
 * ADR-0003 decision 9's default is that a query string is never stripped or
 * translated automatically; `reservedQueryParams` is the row's own recorded
 * exception to that default for `cursor` and `section` specifically, the two
 * names this application's route contract already interprets (decision 8).
 * `"strip"` drops both, because a Joomla-era `?cursor=` shares nothing with
 * this app's HMAC-signed continuation tokens — forwarding it onto a
 * canonical gallery target would have the target misinterpret it: a foreign
 * cursor fails validation and 404s a page the legacy URL used to show, and a
 * foreign section value that happens to match a real section slug would
 * silently render a different subset than the legacy URL ever did.
 * `"preserve"` forwards both unchanged, for the row whose author has
 * verified its target actually treats them the same way. Every other
 * parameter — including one this application does not recognize at all —
 * always passes through unchanged regardless of this choice, matching how a
 * legacy URL's target and an arbitrary campaign or referral parameter
 * already coexist elsewhere in this application.
 *
 * "Unchanged" means byte-for-byte, not merely present with the same name and
 * value: this operates on the raw `key=value` segments rather than round
 * tripping through `URLSearchParams`, whose own `toString()` re-encodes a
 * space as `+` instead of the `%20` a request may have carried and turns a
 * bare flag like `?flag` into `flag=`. A signed or otherwise byte-sensitive
 * unrecognized parameter would silently become a different value than the
 * legacy URL had if this used that shortcut.
 */
export function legacyRedirectDestinationSearch(
  originalSearch: string,
  reservedQueryParams: LegacyReservedQueryHandling,
): string {
  const search = originalSearch.startsWith("?")
    ? originalSearch.slice(1)
    : originalSearch;
  if (reservedQueryParams === "preserve" || search === "") {
    return search;
  }

  const kept = search.split("&").filter((pair) => {
    if (pair === "") return false;
    const rawName = pair.split("=", 1)[0];
    let name: string;
    try {
      name = decodeURIComponent(rawName.replace(/\+/g, " "));
    } catch {
      // An unparseable escape is not a valid encoding of "cursor" or
      // "section" either, so it is kept exactly as sent rather than guessed
      // at or dropped.
      name = rawName;
    }
    return !RESERVED_QUERY_PARAMS.has(name);
  });

  return kept.join("&");
}

/**
 * A BCP 47 tag: language subtag, optionally followed by further subtags. The
 * same shape `deployment-config.ts` already validates `SITE_LOCALE` against
 * before this value is exposed as `LocaleRouteConfig.defaultLocale` — this is
 * a second, independent check at the point the value is interpolated into
 * HTML, since a value that already passed one validator elsewhere is still
 * untrusted input to this function's own contract.
 */
const BCP47_LOCALE_PATTERN = /^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*$/;

/**
 * Which of the two languages {@link GONE_COPY} actually has copy for a given
 * locale renders in. A configured locale outside `fi`/`en` (`LocaleRouteConfig`
 * permits any BCP 47 tag) falls back to English rather than claiming a
 * language the body text was never written in.
 *
 * This is the one place that decision is made. `buildLegacyGoneHtml` and
 * `src/proxy.ts`'s `Content-Language` header both call it, so the declared
 * language can never drift between the HTML `lang` attribute and the HTTP
 * header the way it once could when each computed its own fallback.
 */
export function resolveLegacyGoneLanguage(locale: string): "fi" | "en" {
  const language = BCP47_LOCALE_PATTERN.test(locale)
    ? locale.split("-", 1)[0].toLowerCase()
    : "en";
  return language === "fi" ? "fi" : "en";
}

/**
 * The only two languages this static page has copy for. A locale outside
 * this set falls back to English rather than tagging `lang` with a language
 * the body text was never written in — the same defect this replaces (see
 * {@link buildLegacyGoneHtml}'s own comment).
 */
const GONE_COPY: Record<
  "en" | "fi",
  { readonly title: string; readonly body: string; readonly link: string }
> = {
  en: {
    title: "410 Gone",
    body: "This page has been permanently removed.",
    link: "Go to the homepage",
  },
  fi: {
    title: "410 Sivu poistettu",
    body: "Tämä sivu on poistettu pysyvästi.",
    link: "Etusivulle",
  },
};

/**
 * Which locale route this response belongs to, and — via it — the link back
 * a 410 offers.
 *
 * A legacy 410 has no content-tree route of its own to read a locale from,
 * so the answer comes from the same signal `resolveLocalePrefixRequest`
 * already uses to tell a locale's route space apart from every other path:
 * whether the request's first segment matches a configured locale's prefix.
 * `config.byPrefix` covers only non-default locales — a `null` prefix is the
 * default locale's own unprefixed space — so anything else, including the
 * default locale's own paths, falls back to the default locale's own route.
 * `buildLocaleRouteConfig` always registers one, so this never needs to
 * fail — the thrown branch exists only to keep the return type honest rather
 * than asserting past a case that cannot happen.
 */
export function resolveLegacyGoneRoute(
  config: LocaleRouteConfig,
  pathname: string,
): LocaleRoute {
  const [firstSegment] = pathname.split("/").filter((segment) => segment !== "");
  const prefixed = firstSegment === undefined ? undefined : config.byPrefix.get(firstSegment);
  if (prefixed !== undefined) return prefixed;

  const defaultRoute = config.byLocale.get(config.defaultLocale);
  if (defaultRoute === undefined) {
    throw new Error(
      "[legacy-redirects] deployment config has no route for its own default locale",
    );
  }
  return defaultRoute;
}

/**
 * Where a 410's "go back" link leads: the site root for the default locale,
 * whose home page lives there, or that locale's own story root otherwise.
 *
 * A non-default locale has no home page of its own yet (localized static
 * routes remain later work — see `AGENTS.md`), so linking to its bare prefix
 * (`/en`) would land on another 404, worse than the language mismatch this
 * replaces. Its story root, by contrast, is the one same-language page
 * ADR-0003 already guarantees a route for whenever that locale publishes
 * anything at all, and its address is derived purely from deployment
 * configuration — no content read, which this file cannot perform. Once a
 * real home page exists for a non-default locale, this starts pointing at it
 * with no further change here.
 */
function goneLinkHref(route: LocaleRoute): string {
  return route.isDefault ? "/" : `${route.basePath}/${route.storyNamespace}`;
}

/**
 * The static, generic, accessible body a `410 Gone` response renders.
 *
 * `src/proxy.ts` is the only layer in this application able to emit a 410
 * (see that file's own comment), and it cannot render this app's ordinary
 * React chrome or read `SiteSettings` — no content or adapter reads are
 * permitted there. So this is plain, self-contained HTML: a real heading and
 * a real link back to a page in the same locale, not an empty body, so a
 * visitor or a screen reader is told something rather than shown nothing.
 *
 * `route` — the output of {@link resolveLegacyGoneRoute}, never raw request
 * input — selects which of {@link GONE_COPY}'s two languages renders and
 * where its link leads (see {@link goneLinkHref}). The declared `lang`
 * attribute and the actual body text are derived from the exact same
 * lookup, so they can never disagree the way a `lang` taken from one source
 * and English-only body text taken from another once did.
 */
export function buildLegacyGoneHtml(route: LocaleRoute): string {
  const lang = resolveLegacyGoneLanguage(route.locale);
  const copy = GONE_COPY[lang];
  const href = goneLinkHref(route);

  return `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${copy.title}</title>
</head>
<body>
<h1>${copy.title}</h1>
<p>${copy.body}</p>
<p><a href="${href}">${copy.link}</a></p>
</body>
</html>
`;
}
