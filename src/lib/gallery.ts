/**
 * Route-facing data-access seam for curated galleries. The CMS adapter (AB#114)
 * can replace the mock without changing a route or component import.
 *
 * A gallery is read by the same stable identity the content tree resolved from
 * the path, in the locale the route space belongs to — never by slug, which is
 * translated and editable. What comes back is the shared AB#67 result contract
 * and nothing provider-shaped, which is what lets the grid and the lightbox stay
 * unaware of where the gallery came from.
 *
 * Bounded in both directions: one page in, one page out. An archive-sized
 * gallery never becomes an archive-sized payload, and a visitor continues
 * through it a page at a time by spending the cursor the previous page issued.
 */

import { galleryCursorCodec } from "@/lib/gallery-cursor";
import type {
  CuratedGalleryResultItem,
  GalleryPage,
} from "@/lib/gallery-result";
import { getMockGalleryResult } from "@/lib/mock-gallery";

export { GalleryCursorError } from "@/lib/gallery-pagination";

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
 * One bounded page of a curated gallery, or `undefined` when this locale
 * publishes no gallery for that identity.
 *
 * `cursor` is the opaque token the previous page issued as `page.endCursor`, and
 * this seam is the only thing that may interpret it — ADR-0003 decision 8 makes
 * the route a transport for the value and nothing more. A token that is
 * malformed, tampered with, scoped to another query, or stale because the slice
 * boundary it names has moved throws `GalleryCursorError`, which the route
 * answers with a 404 rather than by quietly serving the first page under a URL
 * that promised a later one.
 *
 * This is also where the deployment's signing key enters. The source below is a
 * fixture and a CMS adapter (AB#114) will be another; neither should hold a
 * secret, so the codec is supplied here and passed down. It resolves the key
 * lazily, so a deployment whose galleries all fit inside one page never reads it.
 */
export async function getGalleryPage(
  locale: string,
  contentId: string,
  cursor?: string,
): Promise<GalleryPage<CuratedGalleryResultItem> | undefined> {
  return getMockGalleryResult(languageOf(locale), contentId, {
    ...(cursor === undefined ? {} : { cursor }),
    cursorCodec: galleryCursorCodec,
  });
}
