/**
 * The public content page itself: one gallery or article, as the route layer
 * and its renderers see it.
 *
 * `content-tree.ts` owns where a page lives — identity, placement, ancestry —
 * and deliberately knows nothing about what it says. This module owns the
 * other half: the title, lead, cover, publication date, tags, and the authored
 * body ADR-0003 decision 2 allows. The two meet in the route, which resolves a
 * path to a `contentId` in the tree and then reads that page here.
 *
 * ADR-0003 decision 1 makes the variant explicit rather than inferred, and a
 * `gallery` variant's curated result set is *not* part of this type: a media
 * block in the body is a content placement and never enters a gallery's grid,
 * lightbox sequence, sections, or pagination. AB#66 owns that result set and
 * AB#104 the route that renders it.
 *
 * Nothing here is provider-shaped. The body is a typed block list in the
 * Portable Text tradition, so a CMS adapter maps its documents onto this
 * boundary instead of leaking a query type into a component.
 */

import type { ContentVariant } from "@/lib/content-tree";
import type { ImageMedia, Media } from "@/lib/media";

/**
 * The six body blocks ADR-0003 decision 2 gives both variants. The page title
 * owns the single `h1`, so an authored heading starts at level 2.
 *
 * `key` is a stable per-block identity, distinct from the position a block
 * happens to render at. A CMS-backed body carries the store's own stable key
 * (Sanity's array-item `_key`, which survives a reorder or an edit); the mock
 * fixture layer has no such concept and omits it, since its content is never
 * live-edited. A renderer prefers `key` and falls back to array index only
 * when it is absent, so a reordered CMS body does not lose React state keyed
 * to the wrong block.
 */
export type ContentBlock =
  | { type: "paragraph"; text: string; key?: string }
  | { type: "heading"; level: 2 | 3; text: string; key?: string }
  | { type: "blockquote"; text: string; attribution?: string; key?: string }
  | {
      type: "media";
      media: Media;
      key?: string;
    }
  | { type: "list"; ordered: boolean; items: string[]; key?: string }
  | {
      type: "youtube";
      videoId: string;
      /** Accessible title used for the button label and link text. */
      title: string;
      key?: string;
    };

/**
 * What both variants of a public content page carry.
 *
 * The first five fields are the same ones a listing card projects, and the mock
 * source composes both from one record so a card and its detail page cannot
 * disagree. A CMS adapter projects them from one document for the same reason —
 * which is also why a listing query must never reach for `body`.
 *
 * `cover` is an image rather than the general `Media`, matching
 * `ContentListingRecord`: a cover is chosen to be *shown* on a card and at the
 * head of a page, and nothing on this site can play a video yet. Widening it
 * would let a page declare a cover that every surface then silently drops.
 */
type ContentPageBase = {
  /** Immutable project identity, shared with the tree placement. */
  readonly contentId: string;
  readonly title: string;
  /** Short lead introducing the page; omitted when it has none. */
  readonly summary?: string;
  /**
   * ISO 8601 date. When the page went live *on this site* — technical
   * bookkeeping only (AB#150, ADR-0017). It is still what Open Graph's
   * `article:published_time` reports, but it drives no visible order and
   * renders nowhere a visitor sees: `eventDate ?? publishedAt`, resolved
   * through {@link effectiveEventDate}, is the ordering and display key.
   */
  readonly publishedAt: string;
  /**
   * ISO 8601 date. When the real-world event or session this page documents
   * actually happened, distinct from when it was published here (AB#150,
   * ADR-0017). Optional: a page with none behaves exactly as before, ordered
   * and dated by `publishedAt`. When set, it is the effective event date.
   */
  readonly eventDate?: string;
  /**
   * ISO 8601 date. Once the current time is at or past it, every public read
   * treats the page as unpublished — absent from listings, the story-root
   * overview and the sitemap, and a 404 at its own detail route — the same
   * posture the tree's `published` flag gives (AB#150, ADR-0017 decision 5).
   * A read-time gate, not a scheduled job; enforced once at the adapter
   * boundary, never at a route.
   */
  readonly endDate?: string;
  readonly cover?: ImageMedia;
  /**
   * Free keywords. ADR-0003 decision 4 keeps them separate from categories:
   * they consume no tree depth and own no public route of their own, so they
   * render as plain text until the reserved keyword-query route exists.
   */
  readonly tags?: readonly string[];
  readonly body: readonly ContentBlock[];
};

/**
 * An editorial page. Its body is the page; it acquires no gallery result set
 * from the media placed in that body (ADR-0003 decision 1).
 */
export type ArticleContentPage = ContentPageBase & {
  readonly variant: "article";
};

/**
 * A curated photographic series. Its ordered result set is the shared gallery
 * contract's (AB#66) and is deliberately not a field here; AB#104 renders it.
 */
export type GalleryContentPage = ContentPageBase & {
  readonly variant: "gallery";
};

/**
 * One public content page. Discriminated on the variant so a renderer that only
 * handles one of them has to say so, rather than reading a field the other
 * variant never fills.
 */
export type ContentPage = ArticleContentPage | GalleryContentPage;

/**
 * The one place the `eventDate ?? publishedAt` fallback is expressed (AB#150,
 * ADR-0017 decision 2). Every consumer — the mock and Sanity adapters, the
 * listing and detail projections, the hero, the listing card, the sibling-nav
 * label — reads this, never the raw fields, so the mock and Sanity paths (or
 * two projections of one document) cannot silently disagree about which date
 * orders and dates a page.
 *
 * The result is compared **verbatim as a string** wherever it orders content
 * (ADR-0013 decision 1, ADR-0017 decision 3): `eventDate` and `publishedAt`
 * must each be stored in a form whose lexical order is its chronological order
 * (ISO 8601, one offset), and a deployment must not mix a date-only value of
 * one with a datetime value of the other. This function never parses or
 * reformats — it picks one string or the other.
 */
export function effectiveEventDate(
  page: Pick<ContentPageBase, "publishedAt" | "eventDate">,
): string {
  return page.eventDate ?? page.publishedAt;
}

/**
 * Whether `endDate` has been reached by `now` (AB#150, ADR-0017 decision 5).
 * `undefined` — the ordinary case — is never ended. Unlike the ordering
 * comparison above this is a real point-in-time check against the wall clock,
 * so it parses; an unparseable authored value is an adapter defect and throws
 * rather than silently keeping the page visible forever.
 */
export function isContentEnded(
  endDate: string | undefined,
  now: Date,
): boolean {
  if (endDate === undefined) return false;
  const ends = Date.parse(endDate);
  if (Number.isNaN(ends)) {
    throw new TypeError(`content endDate is not a parseable ISO date: "${endDate}"`);
  }
  return now.getTime() >= ends;
}

/**
 * The page title owns the single `h1` (see `ContentBlock`'s own doc comment),
 * so a body's first heading has to be level 2 — a level-3 heading appearing
 * before any level-2 heading would skip a level, breaking the semantic
 * hierarchy AB#106 requires. Fails fast, matching this project's other
 * structural `assert*` boundaries (`assertGallerySections`,
 * `assertPlacements`), rather than collecting every issue.
 */
export function assertSemanticHeadingOrder(blocks: readonly ContentBlock[]): void {
  let sawLevel2 = false;
  for (const block of blocks) {
    if (block.type !== "heading") continue;
    if (block.level === 2) {
      sawLevel2 = true;
    } else if (!sawLevel2) {
      throw new TypeError(
        "A level-3 heading appears before any level-2 heading — the page title owns h1, so the body's first heading must be level 2",
      );
    }
  }
}

/**
 * The data-access seam a detail route reads one content page through.
 *
 * The locale is part of the request, not context: ADR-0003 gives each locale its
 * own tree and its own authored text, and a page may publish in one locale
 * without existing in another. An adapter that took only the id would have to
 * guess which language it was being asked for.
 *
 * `variant` is an optional performance hint, not a filter: a caller that
 * already resolved the tree's placement for this `contentId` (the route
 * always has) can pass it so a per-variant-document store reads only the one
 * matching detail query instead of every variant concurrently. A caller with
 * no placement in hand yet (an existence check reached from a redirect or
 * not-found boundary) omits it, and every source must still resolve the page
 * correctly either way.
 */
export type ContentPageSource = (
  locale: string,
  contentId: string,
  variant?: ContentVariant,
) => Promise<ContentPage | undefined>;

/**
 * The page a content route resolved, when it is one this renderer handles and
 * really is the page that was asked for.
 *
 * The identity check is not ceremony: the route resolved a `contentId` from the
 * tree, and rendering whatever the source returned under that path would let an
 * adapter defect publish one page at another's canonical URL.
 */
export function asArticlePage(
  contentId: string,
  page: ContentPage | undefined,
): ArticleContentPage | undefined {
  return page?.variant === "article" && page.contentId === contentId
    ? page
    : undefined;
}

/**
 * The same check for the gallery renderer. A gallery's ordered result set is
 * read separately through the AB#67 contract; what this returns is the page
 * around it — title, lead, publication date, and tags.
 */
export function asGalleryPage(
  contentId: string,
  page: ContentPage | undefined,
): GalleryContentPage | undefined {
  return page?.variant === "gallery" && page.contentId === contentId
    ? page
    : undefined;
}
