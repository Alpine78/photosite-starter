/** In-memory AB#161 reference source. Real reads use the same bounded window. */

import {
  readArticleEndGalleryPage,
  type ArticleEndGalleryQuery,
} from "@/lib/article-end-gallery-pagination";
import {
  selectGalleryWindow,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
} from "@/lib/gallery-pagination";
import { getMockImages } from "@/lib/mock-media";

const FIXTURE_CONTENT_ID = "content-reading-coastal-light";
const FIXTURE_END_GALLERY_ID = "coastal-light-end-gallery";

function languageOf(locale: string): string {
  return new Intl.Locale(locale).language;
}

function placementsFor(locale: string): readonly CuratedGalleryPlacement[] {
  const images = Object.values(getMockImages(languageOf(locale)));
  return Array.from({ length: 30 }, (_, index) => ({
    placementId: `article-end-gallery-${String(index + 1).padStart(2, "0")}`,
    order: index,
    visible: true,
    media: index % 3 === 0
      ? { ...images[index % images.length], caption: languageOf(locale) === "fi"
        ? "Pitkä esimerkkikuvateksti, joka jatkuu usealle riville ilman että kuvan korkeus muuttuu."
        : "A longer example caption that wraps over several lines without changing the photograph height." }
      : images[index % images.length],
  }));
}

export async function getMockArticleEndGalleryPage({
  query,
  cursorCodec,
}: {
  readonly query: ArticleEndGalleryQuery;
  readonly cursorCodec?: GalleryCursorCodec;
}) {
  return readArticleEndGalleryPage({
    query,
    cursorCodec,
    source: async ({ contentId, endGalleryId, locale, window }) => {
      if (
        contentId !== FIXTURE_CONTENT_ID ||
        endGalleryId !== FIXTURE_END_GALLERY_ID
      ) {
        return undefined;
      }
      return selectGalleryWindow(placementsFor(locale), window);
    },
  });
}
