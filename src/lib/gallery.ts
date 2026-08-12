/**
 * Route-facing data-access seam for curated galleries. The CMS adapter (AB#114)
 * can replace the mock without changing a route or component import.
 *
 * A gallery is read by the same stable identity the content tree resolved from
 * the path, in the locale the route space belongs to — never by slug, which is
 * translated and editable. What comes back is the shared AB#67 result contract
 * and nothing provider-shaped, which is what lets the grid and the lightbox stay
 * unaware of where the gallery came from.
 */

import type {
  CuratedGalleryResultItem,
  GalleryPage,
  GalleryPageInfo,
} from "@/lib/gallery-result";
import { getMockGalleryResult } from "@/lib/mock-gallery";

/**
 * A result this stage can publish whole: one page, with nothing after it.
 *
 * AB#67's contract permits a continuation, and a conforming adapter may return
 * one. This route cannot yet render it — AB#66 decides the cursor contract and
 * AB#72 the continuation across grid and lightbox — so the seam narrows the type
 * rather than leaving the route to remember. With `hasNextPage` statically
 * `false`, reading `items` alone is reading the whole gallery, and a caller
 * cannot branch on a continuation that the type says is not there.
 *
 * The type states the guarantee; `requireCompleteGalleryPage` is what enforces
 * it. Widening this back to `GalleryPage` would still compile, because a route
 * that reads only `items` reads a field both types have — so the runtime check
 * is the one that must stay, not the one the compiler makes redundant.
 */
export type CompleteGalleryPage = {
  readonly items: readonly CuratedGalleryResultItem[];
  readonly page: Extract<GalleryPageInfo, { readonly hasNextPage: false }>;
};

/**
 * Mock galleries are authored per language while routes are configured per
 * locale: `en-GB` and `en-US` are different route spaces sharing one set of
 * English placements. The locale reached this point through the route config, so
 * it is already a validated BCP 47 tag.
 */
function languageOf(locale: string): string {
  return new Intl.Locale(locale).language;
}

/**
 * Refuses a result whose remainder this stage would silently drop.
 *
 * The failure mode this exists to prevent is the quiet one: a source with more
 * public items than one page returns a perfectly valid AB#67 result, the route
 * renders the first page of it, and a visitor is shown part of a gallery with
 * nothing on the page suggesting the rest exists. An adapter is not wrong to
 * paginate — it is doing what the contract says — so the error names the story
 * that has to land before it can.
 *
 * Exported because it is the rule rather than a detail of the mock: the Sanity
 * adapter (AB#114) passes its own results through the same check.
 */
export function requireCompleteGalleryPage(
  contentId: string,
  result: GalleryPage<CuratedGalleryResultItem>,
): CompleteGalleryPage {
  if (result.page.hasNextPage) {
    throw new Error(
      `Gallery "${contentId}" returned a continuation this route cannot render, so the rest of its items would be hidden; serving a paginated gallery is AB#72`,
    );
  }

  return { items: result.items, page: result.page };
}

/**
 * One curated gallery's complete result, or `undefined` when this locale
 * publishes no gallery for that identity.
 *
 * Bounded either way: an archive-sized gallery does not become an
 * archive-sized payload, it becomes the loud failure above.
 */
export async function getGalleryResult(
  locale: string,
  contentId: string,
): Promise<CompleteGalleryPage | undefined> {
  const result = getMockGalleryResult(languageOf(locale), contentId);
  return result === undefined
    ? undefined
    : requireCompleteGalleryPage(contentId, result);
}
