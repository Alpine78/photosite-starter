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
 * One public content page.
 *
 * The first five fields are the same ones a listing card projects, and the mock
 * source composes both from one record so a card and its detail page cannot
 * disagree. A CMS adapter projects them from one document for the same reason —
 * which is also why a listing query must never reach for `body`.
 */
export type ContentPage = {
  /** Immutable project identity, shared with the tree placement. */
  readonly contentId: string;
  /** Must match the placement's variant; the tree is authoritative. */
  readonly variant: ContentVariant;
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

/** The data-access seam a detail route reads one content page through. */
export type ContentPageSource = (
  contentId: string,
) => Promise<ContentPage | undefined>;
