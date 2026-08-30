/**
 * Public mock media used until the CMS adapter lands.
 *
 * Each path names immutable, content-versioned web bytes. Replacing an image
 * requires a new filename and therefore a new public source URL.
 *
 * The bytes are language-neutral and the sentences about them are not, so each
 * image is authored once and described per language. `getMockImages` is what a
 * localized listing, gallery, or page reads, and the two sets always name the
 * identical rendition — only the words differ.
 */

import {
  projectPublicImageMedia,
  withLocalizedText,
  type ImageMedia,
} from "@/lib/media";

export const mockImages = {
  coastalLandscape: projectPublicImageMedia({
    mediaId: "coastal-landscape",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/coastal-landscape.1683eecb7e65.webp",
      version: "1683eecb7e65",
      width: 1536,
      height: 1024,
    },
    alt: "Rocky shoreline beside calm water under an overcast sky",
  }),
  forestStream: projectPublicImageMedia({
    mediaId: "forest-stream",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/forest-stream.4707752d81a6.webp",
      version: "4707752d81a6",
      width: 1024,
      height: 1536,
    },
    alt: "Forest stream flowing over dark moss-covered stones",
  }),
  lakesideReeds: projectPublicImageMedia({
    mediaId: "lakeside-reeds",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/lakeside-reeds.ddbe8db0379c.webp",
      version: "ddbe8db0379c",
      width: 1254,
      height: 1254,
    },
    alt: "Golden reeds moving beside blue lake water",
  }),
  lichenStones: projectPublicImageMedia({
    mediaId: "lichen-stones",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/lichen-stones.013e44e81dda.webp",
      version: "013e44e81dda",
      width: 1254,
      height: 1254,
    },
    alt: "Rain-darkened stones patterned with pale lichen",
  }),
  mistyBirch: projectPublicImageMedia({
    mediaId: "misty-birch",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/misty-birch.dac688b96d85.webp",
      version: "dac688b96d85",
      width: 1024,
      height: 1536,
    },
    alt: "Silver birch standing in a misty green forest",
    // One credited image, followed by an item with no metadata in the portfolio
    // result, so the journey exercises both presentation and stale removal.
    credit: "Placeholder credit",
  }),
  openMarsh: projectPublicImageMedia({
    mediaId: "open-marsh",
    publiclyRenderable: true,
    rendition: {
      sourceKind: "public-web-derivative",
      src: "/gallery/open-marsh.e679c408d1ee.webp",
      version: "e679c408d1ee",
      width: 1536,
      height: 1024,
    },
    alt: "Reflective water channel winding through an open marsh",
  }),
} as const satisfies Record<string, ImageMedia>;

export type MockImages = typeof mockImages;

/**
 * The same public renditions, described in Finnish. Alt text is what a screen
 * reader announces inside a page that declares `lang="fi"`, so it is authored
 * per locale even though the bytes are shared.
 */
const finnishImages = {
  coastalLandscape: withLocalizedText(mockImages.coastalLandscape, {
    alt: "Kivinen rantaviiva tyynen veden äärellä pilvisen taivaan alla",
  }),
  forestStream: withLocalizedText(mockImages.forestStream, {
    alt: "Metsäpuro virtaa tummien sammaleisten kivien yli",
  }),
  lakesideReeds: withLocalizedText(mockImages.lakesideReeds, {
    alt: "Kultaisia kaisloja liikkumassa sinisen järviveden äärellä",
  }),
  lichenStones: withLocalizedText(mockImages.lichenStones, {
    alt: "Sateen tummentamia kiviä vaalean jäkälän kuvioimina",
  }),
  mistyBirch: withLocalizedText(mockImages.mistyBirch, {
    alt: "Hopeakoivu sumuisessa vihreässä metsässä",
  }),
  openMarsh: withLocalizedText(mockImages.openMarsh, {
    alt: "Heijastava vesiuoma mutkittelee avoimen suon halki",
  }),
} as const satisfies MockImages;

const imagesByLanguage: Readonly<Record<string, MockImages>> = {
  en: mockImages,
  fi: finnishImages,
};

/**
 * The mock media described in one language subtag.
 *
 * A language the fixture has not been translated into falls back to the
 * authored English text rather than to no text at all: an image with no
 * alternative text is unusable to a screen reader, while one described in the
 * wrong language is at least still described. A real deployment authors its
 * media text per locale in the CMS and never reaches this fallback.
 */
export function getMockImages(language: string): MockImages {
  return imagesByLanguage[language] ?? mockImages;
}

/**
 * One mock photograph by its stable `mediaId`, or `undefined` when the fixture
 * has none. The counterpart to a store's "read one media by id" — a dynamic
 * enquiry (ADR-0002 §1, `itemId === mediaId`) has no placement to look up, so it
 * resolves the photograph directly.
 */
export function findMockImageByMediaId(
  language: string,
  mediaId: string,
): ImageMedia | undefined {
  return Object.values(getMockImages(language)).find(
    (image) => image.mediaId === mediaId,
  );
}
