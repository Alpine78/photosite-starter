/**
 * The site search service (ADR-0033): one query in, grouped hits out.
 *
 * {@link buildSiteSearchResponse} is the whole decision and is pure, so every
 * rule below is tested with fixtures and no I/O. {@link searchSite} only loads
 * what that function is given.
 *
 * Eligibility is not re-derived here. A story is searchable exactly when the
 * locale's public content tree gives its `contentId` a canonical route, a
 * service exactly when `buildServiceRoutes` resolved it and it is not hidden
 * from listings. The result links to that same route, so a hit can never name a
 * page the public site would 404, and no ended, unpublished, secondary-only, or
 * unlisted page can appear.
 */

import { getContentTrees } from "@/lib/content";
import { listPublicRoutePaths, type ContentTree } from "@/lib/content-tree";
import { getDeploymentConfig } from "@/lib/deployment-config";
import {
  buildServicePath,
  buildStoryPath,
  getLocaleRoute,
  type LocaleRouteConfig,
} from "@/lib/locale-routes";
import type { ResolvedService } from "@/lib/service-routes";
import { getServiceRoutes } from "@/lib/services";
import {
  getSiteSearchStoryRecords,
  type SiteSearchStoryRecord,
} from "@/lib/site-search-index";
import {
  parseSearchQuery,
  scoreSearchFields,
  type SearchQuery,
} from "@/lib/site-search-query";
import {
  EMPTY_SITE_SEARCH_RESPONSE,
  type SiteSearchGroup,
  type SiteSearchHit,
  type SiteSearchResponse,
  type SiteSearchThumbnail,
} from "@/lib/site-search-types";

/** Hits per group in the dialog. */
export const SITE_SEARCH_DIALOG_LIMIT = 5;
/** Hits per group on the results page; there is no pagination in v1. */
export const SITE_SEARCH_PAGE_LIMIT = 50;

type Scored = { readonly score: number; readonly hit: SiteSearchHit };

function toGroup(scored: readonly Scored[], limit: number): SiteSearchGroup {
  return {
    hits: scored.slice(0, limit).map((entry) => entry.hit),
    total: scored.length,
  };
}

/** Higher score first; then newer event date; then `contentId` in code-unit order. */
function compareStories(
  a: Scored & { readonly eventDate: string },
  b: Scored & { readonly eventDate: string },
): number {
  if (a.score !== b.score) return b.score - a.score;
  if (a.eventDate !== b.eventDate) return a.eventDate < b.eventDate ? 1 : -1;
  return a.hit.id < b.hit.id ? -1 : a.hit.id > b.hit.id ? 1 : 0;
}

export type SiteSearchInput = {
  readonly query: SearchQuery;
  readonly config: LocaleRouteConfig;
  readonly locale: string;
  readonly stories: readonly SiteSearchStoryRecord[];
  /** The locale's public tree, or `undefined` when it publishes none. */
  readonly tree: ContentTree | undefined;
  readonly services: readonly ResolvedService[];
  readonly limit: number;
};

/** Pure: match, rank, and shape one locale's stories and services. */
export function buildSiteSearchResponse(input: SiteSearchInput): SiteSearchResponse {
  const { tokens } = input.query;
  if (tokens.length === 0) return EMPTY_SITE_SEARCH_RESPONSE;

  const stories: (Scored & { readonly eventDate: string })[] = [];
  if (input.tree !== undefined) {
    const paths = new Map<string, readonly string[]>();
    for (const route of listPublicRoutePaths(input.tree)) {
      if (route.kind === "content") paths.set(route.id, route.segments);
    }

    for (const record of input.stories) {
      const segments = paths.get(record.contentId);
      if (segments === undefined) continue;
      const score = scoreSearchFields(tokens, {
        title: record.title,
        tags: record.tags.join(" "),
        ...(record.summary === undefined ? {} : { summary: record.summary }),
      });
      if (score === undefined) continue;
      const thumbnail = thumbnailOf(record.cover?.rendition);
      stories.push({
        score,
        eventDate: record.eventDate,
        hit: {
          kind: "story",
          id: record.contentId,
          title: record.title,
          ...(record.summary === undefined ? {} : { summary: record.summary }),
          href: buildStoryPath(input.config, input.locale, segments),
          eventDate: record.eventDate,
          ...(thumbnail === undefined ? {} : { thumbnail }),
        },
      });
    }
    stories.sort(compareStories);
  }

  const services: Scored[] = [];
  for (const { service, path } of input.services) {
    if (service.hideFromListing === true) continue;
    const score = scoreSearchFields(tokens, {
      title: service.name,
      summary: service.shortDescription,
    });
    if (score === undefined) continue;
    const cover = service.coverMedia;
    const thumbnail =
      cover?.type === "image" ? thumbnailOf(cover.rendition) : undefined;
    services.push({
      score,
      hit: {
        kind: "service",
        id: service.serviceId,
        title: service.name,
        summary: service.shortDescription,
        href: buildServicePath(input.config, input.locale, path),
        ...(thumbnail === undefined ? {} : { thumbnail }),
      },
    });
  }
  // A stable sort keeps the catalogue's own order among equally good services.
  services.sort((a, b) => b.score - a.score);

  return {
    stories: toGroup(stories, input.limit),
    services: toGroup(services, input.limit),
  };
}

function thumbnailOf(
  rendition: { readonly src: string; readonly width: number; readonly height: number } | undefined,
): SiteSearchThumbnail | undefined {
  if (rendition === undefined) return undefined;
  return { src: rendition.src, width: rendition.width, height: rendition.height };
}

/**
 * Searches one locale's public stories and services.
 *
 * `rawQuery` is whatever the request carried; it is parsed and bounded here so
 * the API and the results page cannot disagree about what a query is. An
 * unusable query returns the empty answer without reading anything. A locale
 * the deployment does not route is a caller defect and throws.
 */
export async function searchSite(input: {
  readonly rawQuery: unknown;
  readonly locale: string;
  readonly limit: number;
}): Promise<SiteSearchResponse> {
  const query = parseSearchQuery(input.rawQuery);
  if (query.tokens.length === 0) return EMPTY_SITE_SEARCH_RESPONSE;

  const { localeRoutes } = getDeploymentConfig();
  const route = getLocaleRoute(localeRoutes, input.locale);
  if (route === undefined) {
    throw new TypeError(`site search locale "${input.locale}" is not configured`);
  }
  const language = new Intl.Locale(route.locale).language;

  const [stories, trees, services] = await Promise.all([
    getSiteSearchStoryRecords(language),
    getContentTrees(),
    getServiceRoutes(route.locale),
  ]);

  return buildSiteSearchResponse({
    query,
    config: localeRoutes,
    locale: route.locale,
    stories,
    tree: trees.get(route.locale),
    services,
    limit: input.limit,
  });
}
