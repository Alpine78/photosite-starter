/**
 * Public content tree mock used until the CMS adapter lands.
 *
 * The categories are deliberately generic photographic subjects: a clone
 * rebrands this tree from its own CMS, so no photographer, location, or
 * business-specific taxonomy belongs here.
 *
 * The shape exercises the decided structure end to end: several top-level
 * roots, a branch category that is public only through its descendants, a
 * category public only through a secondary listing, the maximum authored depth,
 * an empty leaf that stays out of public navigation, both content variants, and
 * an unplaced draft.
 *
 * One input per language subtag, because ADR-0003 gives each locale its own
 * tree: labels and slugs are translated while `categoryId` and `contentId` stay
 * identical, which is what associates the language versions. The Finnish tree
 * deliberately omits one article, so a locale publishing no version of a page
 * — the normal state while a translation is being written — is covered too.
 */

import type { ContentRedirectInput } from "@/lib/content-redirects";
import {
  buildContentTree,
  type ContentTree,
  type ContentTreeInput,
} from "@/lib/content-tree";

const englishContentTree: ContentTreeInput = {
  categories: [
    // Top level.
    { categoryId: "cat-landscape", parentId: null, slug: "landscape", label: "Landscape", order: 0 },
    // Branch category: public only because its descendants are.
    { categoryId: "cat-travel", parentId: null, slug: "travel", label: "Travel", order: 1 },
    // Public only through a secondary listing, which is something to show.
    { categoryId: "cat-events", parentId: null, slug: "events", label: "Events", order: 2 },
    // Empty leaf: no content, no descendants, so it stays out of the public tree.
    { categoryId: "cat-archive", parentId: null, slug: "archive", label: "Archive", order: 3 },

    { categoryId: "cat-coastal", parentId: "cat-landscape", slug: "coastal", label: "Coastal", order: 0 },

    // Depth 2-5 branch reaching the maximum authored depth.
    { categoryId: "cat-europe", parentId: "cat-travel", slug: "europe", label: "Europe", order: 0 },
    { categoryId: "cat-nordics", parentId: "cat-europe", slug: "nordics", label: "Nordics", order: 0 },
    { categoryId: "cat-winter", parentId: "cat-nordics", slug: "winter", label: "Winter", order: 0 },
    { categoryId: "cat-polar-night", parentId: "cat-winter", slug: "polar-night", label: "Polar night", order: 0 },
  ],
  placements: [
    {
      contentId: "content-coastal-mornings",
      variant: "gallery",
      slug: "coastal-mornings",
      published: true,
      canonicalCategoryId: "cat-coastal",
      // Listed under Events too, but Coastal owns the one detail route.
      secondaryCategoryIds: ["cat-events"],
    },
    {
      contentId: "content-reading-coastal-light",
      variant: "article",
      slug: "reading-coastal-light",
      published: true,
      canonicalCategoryId: "cat-landscape",
    },
    {
      contentId: "content-polar-night-sessions",
      variant: "gallery",
      slug: "polar-night-sessions",
      published: true,
      canonicalCategoryId: "cat-polar-night",
    },
    {
      // Draft content may stay unplaced until the author chooses its home.
      contentId: "content-unplaced-draft",
      variant: "article",
      slug: "unplaced-draft",
      published: false,
      canonicalCategoryId: null,
    },
  ],
};

const finnishContentTree: ContentTreeInput = {
  categories: [
    { categoryId: "cat-landscape", parentId: null, slug: "maisemat", label: "Maisemat", order: 0 },
    { categoryId: "cat-travel", parentId: null, slug: "matkat", label: "Matkat", order: 1 },
    { categoryId: "cat-events", parentId: null, slug: "tapahtumat", label: "Tapahtumat", order: 2 },
    { categoryId: "cat-archive", parentId: null, slug: "arkisto", label: "Arkisto", order: 3 },

    { categoryId: "cat-coastal", parentId: "cat-landscape", slug: "rannikko", label: "Rannikko", order: 0 },

    { categoryId: "cat-europe", parentId: "cat-travel", slug: "eurooppa", label: "Eurooppa", order: 0 },
    { categoryId: "cat-nordics", parentId: "cat-europe", slug: "pohjoismaat", label: "Pohjoismaat", order: 0 },
    { categoryId: "cat-winter", parentId: "cat-nordics", slug: "talvi", label: "Talvi", order: 0 },
    { categoryId: "cat-polar-night", parentId: "cat-winter", slug: "kaamos", label: "Kaamos", order: 0 },
  ],
  placements: [
    {
      contentId: "content-coastal-mornings",
      variant: "gallery",
      slug: "rannikon-aamut",
      published: true,
      canonicalCategoryId: "cat-coastal",
      secondaryCategoryIds: ["cat-events"],
    },
    // `content-reading-coastal-light` has no Finnish version yet, so Maisemat
    // is a branch category here and an article listing in English.
    {
      contentId: "content-polar-night-sessions",
      variant: "gallery",
      slug: "kaamoskuvaukset",
      published: true,
      canonicalCategoryId: "cat-polar-night",
    },
  ],
};

/**
 * Recorded path history, which a CMS writes when an author confirms a URL
 * change. Both cases ADR-0003 decision 7 names are covered: a rename, where the
 * category kept its parent and changed its own slug, and a move, where the
 * category kept its slug and gained an ancestor.
 */
const englishContentRedirects: readonly ContentRedirectInput[] = [
  { kind: "category", id: "cat-events", previousPath: ["happenings"] },
  { kind: "category", id: "cat-coastal", previousPath: ["coastal"] },
];

const finnishContentRedirects: readonly ContentRedirectInput[] = [
  { kind: "category", id: "cat-events", previousPath: ["tapahtuma"] },
  { kind: "category", id: "cat-coastal", previousPath: ["rannikko"] },
];

/** Authored mock trees per language subtag; a locale absent here publishes none. */
export const mockContentTreeInputs: Readonly<Record<string, ContentTreeInput>> =
  {
    en: englishContentTree,
    fi: finnishContentTree,
  };

/** Recorded path history per language subtag, in that language's own tree. */
export const mockContentRedirectInputs: Readonly<
  Record<string, readonly ContentRedirectInput[]>
> = {
  en: englishContentRedirects,
  fi: finnishContentRedirects,
};

/** The English tree, which the default single-locale example deployment serves. */
export const mockContentTreeInput = englishContentTree;

export function buildMockContentTree(): ContentTree {
  return buildContentTree(mockContentTreeInput);
}
