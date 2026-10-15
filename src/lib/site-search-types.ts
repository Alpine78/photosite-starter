/**
 * The shapes a site-search answer has (ADR-0033). Kept in a module with no
 * server dependency because the dialog, which runs in the browser, imports
 * them to type the API's response.
 *
 * A hit carries only what a result row shows. The thumbnail is the public
 * derivative's `src` with its true intrinsic dimensions and the alternative
 * text: no master, locator, provider detail, or media identity ever reaches
 * the browser through search.
 */

export type SiteSearchThumbnail = {
  readonly src: string;
  /** The derivative's real pixel size, so the box can reserve its ratio. */
  readonly width: number;
  readonly height: number;
};

export type SiteSearchHit = {
  readonly kind: "story" | "service";
  /** `contentId` for a story, `serviceId` for a service. */
  readonly id: string;
  readonly title: string;
  readonly summary?: string;
  /** The page's one canonical, locale-correct route. */
  readonly href: string;
  /** Effective event date of a story, ISO 8601. Absent for a service. */
  readonly eventDate?: string;
  readonly thumbnail?: SiteSearchThumbnail;
};

export type SiteSearchGroup = {
  /** At most the requested limit, best first. */
  readonly hits: readonly SiteSearchHit[];
  /** How many records matched in all, so a cut group can say so honestly. */
  readonly total: number;
};

export type SiteSearchResponse = {
  readonly stories: SiteSearchGroup;
  readonly services: SiteSearchGroup;
};

export const EMPTY_SITE_SEARCH_RESPONSE: SiteSearchResponse = {
  stories: { hits: [], total: 0 },
  services: { hits: [], total: 0 },
};
