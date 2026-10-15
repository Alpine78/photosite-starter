import { LanguageSwitch, type LanguageLink } from "@/components/language-switch";
import { SiteSearchResults } from "@/components/site-search-results";
import { getBuiltInLabels, getDeploymentConfig } from "@/lib/deployment-config";
import { languageName } from "@/lib/language-fallback";
import { buildSearchPath } from "@/lib/locale-routes";
import {
  SITE_SEARCH_PAGE_LIMIT,
  searchSite,
} from "@/lib/site-search";
import { noResultsText, resultCountText } from "@/lib/site-search-copy";
import {
  SEARCH_MAX_QUERY_CHARACTERS,
  parseSearchQuery,
} from "@/lib/site-search-query";
import type { SiteSearchResponse } from "@/lib/site-search-types";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2";

/** The other locales' search pages. They carry no query: no translation of results is implied. */
function languageLinks(locale: string): readonly LanguageLink[] {
  const { localeRoutes } = getDeploymentConfig();
  return localeRoutes.locales.flatMap((route) =>
    route.locale === locale
      ? []
      : [
          {
            locale: route.locale,
            label: languageName(route.locale),
            href: buildSearchPath(localeRoutes, route.locale),
          },
        ],
  );
}

/**
 * The search results page (ADR-0033): a plain GET form and server-rendered
 * results, so search works with no JavaScript and the dialog is an upgrade of
 * this page rather than a second implementation of it.
 *
 * The query lives in the URL here, which puts it in browser history and in
 * hosting request logs; that exposure is named in `docs/search-data-flow.md`.
 * The dialog posts instead, so the common path never writes a term to a URL.
 */
export async function SiteSearchPage({
  locale,
  rawQuery,
}: {
  readonly locale: string;
  readonly rawQuery: string | undefined;
}) {
  const labels = getBuiltInLabels(locale);
  const copy = labels.search;
  const { localeRoutes } = getDeploymentConfig();
  const searchPath = buildSearchPath(localeRoutes, locale);
  const query = parseSearchQuery(rawQuery);

  let response: SiteSearchResponse | undefined;
  let unavailable = false;
  if (query.tokens.length > 0) {
    try {
      response = await searchSite({
        rawQuery,
        locale,
        limit: SITE_SEARCH_PAGE_LIMIT,
      });
    } catch (error) {
      // The class and message describe the content store, never the query.
      console.error(
        "[site-search] results page unavailable",
        error instanceof Error ? `${error.name}: ${error.message}` : "unknown error",
      );
      unavailable = true;
    }
  }

  const total =
    response === undefined ? 0 : response.stories.total + response.services.total;

  return (
    <main>
      <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <header className="max-w-2xl">
          <h1 className="text-4xl font-semibold leading-none tracking-tight sm:text-6xl">
            {copy.title}
          </h1>
          <form
            role="search"
            action={searchPath}
            method="get"
            className="mt-8 flex flex-col gap-3 sm:flex-row"
          >
            <label htmlFor="site-search-page-q" className="sr-only">
              {copy.fieldLabel}
            </label>
            <input
              id="site-search-page-q"
              name="q"
              type="search"
              defaultValue={query.text}
              placeholder={copy.placeholder}
              maxLength={SEARCH_MAX_QUERY_CHARACTERS}
              autoComplete="off"
              className={`min-h-12 flex-1 rounded-sm border border-border-control bg-surface px-4 text-lg ${focusRing}`}
            />
            <button
              type="submit"
              className={`inline-flex min-h-12 items-center justify-center rounded-full bg-accent px-6 text-base font-medium text-accent-foreground transition-opacity hover:opacity-90 ${focusRing}`}
            >
              {copy.submit}
            </button>
          </form>
          <LanguageSwitch
            label={labels.contentTree.languages}
            links={languageLinks(locale)}
          />
        </header>

        <div className="mt-12">
          {unavailable ? (
            <p role="status" className="text-lg text-muted">
              {copy.unavailable}
            </p>
          ) : query.tokens.length === 0 ? (
            <p className="text-lg text-muted">{copy.prompt}</p>
          ) : response === undefined || total === 0 ? (
            <p className="text-lg text-muted">{noResultsText(copy, query.text)}</p>
          ) : (
            <>
              <p className="mb-8 text-muted">{resultCountText(copy, total)}</p>
              <SiteSearchResults
                idPrefix="site-search-page"
                response={response}
                tokens={query.tokens}
                locale={locale}
                labels={copy}
                showSummary
                showCapNotice
              />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
