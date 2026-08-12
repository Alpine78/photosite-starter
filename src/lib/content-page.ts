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

import type { ImageMedia, Media } from "@/lib/media";

/**
 * The six body blocks ADR-0003 decision 2 gives both variants. The page title
 * owns the single `h1`, so an authored heading starts at level 2.
 */
export type ContentBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: 2 | 3; text: string }
  | { type: "blockquote"; text: string; attribution?: string }
  | {
      type: "media";
      media: Media;
    }
  | { type: "list"; ordered: boolean; items: string[] }
  | {
      type: "youtube";
      videoId: string;
      /** Accessible title used for the button label and link text. */
      title: string;
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
  /** ISO 8601 date. */
  readonly publishedAt: string;
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
 * The data-access seam a detail route reads one content page through.
 *
 * The locale is part of the request, not context: ADR-0003 gives each locale its
 * own tree and its own authored text, and a page may publish in one locale
 * without existing in another. An adapter that took only the id would have to
 * guess which language it was being asked for.
 */
export type ContentPageSource = (
  locale: string,
  contentId: string,
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
