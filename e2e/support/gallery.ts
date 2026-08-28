import { expect, type Locator } from "@playwright/test";
import {
  buildContentTree,
  getCanonicalContentPath,
} from "../../src/lib/content-tree";
import { createHmacGalleryCursorCodec } from "../../src/lib/gallery-pagination";
import { getMockGalleryResult } from "../../src/lib/mock-gallery";
import { mockContentPages } from "../../src/lib/mock-content-pages";
import { mockContentTreeInputs } from "../../src/lib/mock-content-tree";
import { appUnderTestEnvironment, DEFAULT_STORY_NAMESPACE } from "./harness-environment";

/**
 * Gallery-route discovery shared by the lightbox journeys.
 *
 * A clone renames every category and slug in this tree, so a journey names no
 * path — it derives one from the same adapter data the harness serves. Both the
 * base lightbox spec and the zoom/pan spec need the same kind of gallery (mixed
 * aspect ratios, more than one item), so that derivation lives here once rather
 * than being copied into each file.
 */

/** The unprefixed story-namespace root for the harness's default locale. */
export const STORY_ROOT = `/${DEFAULT_STORY_NAMESPACE}`;

/**
 * Some galleries this scan reaches (`content-large-archive`) are large enough
 * to paginate, and a paginated result cannot be built without a codec to sign
 * its continuation cursor — even for a first page that itself fits.
 */
const harnessCursorCodec = createHmacGalleryCursorCodec(
  appUnderTestEnvironment.GALLERY_CURSOR_SIGNING_KEY,
);

function defaultLocaleLanguage(): string {
  return new Intl.Locale(appUnderTestEnvironment.SITE_LOCALE).language;
}

function defaultLocaleTree() {
  const language = defaultLocaleLanguage();
  const treeInput = mockContentTreeInputs[language];
  if (treeInput === undefined) {
    throw new Error(`[e2e] The default locale ${language} publishes no mock tree.`);
  }
  return { language, tree: buildContentTree(treeInput) } as const;
}

/**
 * A curated gallery whose first page has two or more items and more than one
 * aspect ratio among them — enough to navigate between, and enough differently
 * shaped frames to prove the layout and the lightbox never crop or reorder.
 */
export async function firstMixedRatioGalleryPath(): Promise<string> {
  const { language, tree } = defaultLocaleTree();

  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    // The codec is passed even though the target is a small gallery: a
    // paginated one reached earlier in a reordered or cloned fixture would
    // otherwise throw ("a gallery cursor codec is required for a paginated
    // result") and abort the whole suite before the small one is found.
    const result = await getMockGalleryResult(language, contentId, {
      cursorCodec: harnessCursorCodec,
    });
    if (path === null || result === undefined) continue;

    const ratios = new Set(
      result.items.map(
        (item) => item.media.rendition.width / item.media.rendition.height,
      ),
    );
    if (result.items.length > 1 && ratios.size > 1) {
      return `${STORY_ROOT}/${path.join("/")}`;
    }
  }

  throw new Error(
    "[e2e] The harness needs one mixed-ratio gallery of two or more items.",
  );
}

/**
 * A published gallery with no items, by the same derivation. The empty state is
 * a state the site serves, so a journey finds it in the adapter data rather
 * than assuming which page it is.
 */
export async function emptyGalleryPath(): Promise<string> {
  const { language, tree } = defaultLocaleTree();

  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    // Same reason as `firstMixedRatioGalleryPath`: a paginated gallery reached
    // before the empty one must not throw the scan.
    const result = await getMockGalleryResult(language, contentId, {
      cursorCodec: harnessCursorCodec,
    });
    if (path !== null && result?.items.length === 0) {
      return `${STORY_ROOT}/${path.join("/")}`;
    }
  }

  throw new Error("[e2e] The harness needs one published gallery with no items.");
}

/**
 * A curated gallery whose first page places one photograph under two different
 * result identities (ADR-0002 §2 allows exactly this): the case that tells an
 * `itemId`-keyed implementation apart from a `mediaId`-keyed one.
 */
export async function repeatedMediaGallery(): Promise<{
  readonly path: string;
  /** Every item's `itemId`, in the source's own authoritative order. */
  readonly expectedItemIds: readonly string[];
  /** Indexes, in that same order, of the two placements sharing one mediaId. */
  readonly repeated: readonly [number, number];
}> {
  const { language, tree } = defaultLocaleTree();

  for (const [contentId, page] of mockContentPages[language] ?? []) {
    if (page.variant !== "gallery") continue;

    const path = getCanonicalContentPath(tree, contentId);
    const result = await getMockGalleryResult(language, contentId, {
      cursorCodec: harnessCursorCodec,
    });
    if (path === null || result === undefined) continue;

    const firstIndexOfMediaId = new Map<string, number>();
    for (const [index, item] of result.items.entries()) {
      const firstIndex = firstIndexOfMediaId.get(item.mediaId);
      if (firstIndex !== undefined) {
        return {
          path: `${STORY_ROOT}/${path.join("/")}`,
          expectedItemIds: result.items.map((entry) => entry.itemId),
          repeated: [firstIndex, index],
        };
      }
      firstIndexOfMediaId.set(item.mediaId, index);
    }
  }

  throw new Error(
    "[e2e] The harness needs one gallery whose first page places one photograph under two placements.",
  );
}

/**
 * The alternative text of each grid photograph, in result order. Content, so a
 * journey reads it from the page rather than knowing it: a clone replaces every
 * one of these photographs with its own.
 */
export async function galleryImageAlts(triggers: Locator): Promise<string[]> {
  return triggers.evaluateAll((buttons) =>
    buttons.map((button) => button.querySelector("img")?.alt ?? ""),
  );
}

/**
 * The grid's own items.
 *
 * A gallery page carries other lists — the breadcrumb trail, the language
 * switch, the tags — so "every list item in main" would mix them in. The grid's
 * list is the one whose items open images.
 */
export function galleryItems(main: Locator): Locator {
  return main
    .getByRole("list")
    .filter({ has: main.page().getByRole("button") })
    .first()
    .getByRole("listitem");
}

/**
 * What the grid itself says about each photograph, in result order, with an
 * empty string where it says nothing.
 */
export async function galleryCaptions(main: Locator): Promise<string[]> {
  return galleryItems(main).evaluateAll((items) =>
    items.map(
      (item) => item.querySelector("figcaption")?.textContent?.trim() ?? "",
    ),
  );
}

/**
 * The browser may only ever hold a versioned public web derivative, optimized
 * or not. Anything else reaching the viewer is the failure ADR-0005 exists to
 * prevent, so it is asserted rather than assumed.
 */
export function expectApprovedPublicRendition(currentSrc: string): void {
  const delivered = new URL(currentSrc);
  const versionedPublicPath =
    /^\/gallery\/[a-z0-9]+(?:-[a-z0-9]+)*\.[a-f0-9]{12}\.(?:avif|jpe?g|png|webp)$/;

  const source =
    delivered.pathname === "/_next/image"
      ? (delivered.searchParams.get("url") ?? "")
      : delivered.pathname;

  expect(source, `unexpected lightbox source: ${currentSrc}`).toMatch(
    versionedPublicPath,
  );
}

/**
 * Time an opening action gets to land before it is treated as blocked. Short on
 * purpose: a click that cannot reach the trigger has nothing to wait for.
 */
export const OPEN_ACTION_TIMEOUT = 3_000;
