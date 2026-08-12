/**
 * Public content tree mock used until the CMS adapter lands.
 *
 * The categories are deliberately generic photographic subjects: a clone
 * rebrands this tree from its own CMS, so no photographer, location, or
 * business-specific taxonomy belongs here.
 *
 * The shape exercises the decided structure end to end: several top-level
 * roots, branch categories that are public only through their descendants,
 * categories public only through a secondary listing, the maximum authored
 * depth, an empty leaf that stays out of public navigation, both content
 * variants, and an unplaced draft.
 *
 * One input per language subtag, because ADR-0003 gives each locale its own
 * tree: labels and slugs are translated while `categoryId` and `contentId` stay
 * identical, which is what associates the language versions. The Finnish tree
 * publishes a small but useful set of articles and deliberately omits the
 * rest, along with one whole category, so both halves of the normal bilingual
 * state are covered: pages with real translations, and pages — and a branch —
 * that have none yet.
 */

import type { ContentRedirectInput } from "@/lib/content-redirects";
import {
  buildContentTree,
  type ContentTree,
  type ContentTreeInput,
} from "@/lib/content-tree";

const englishContentTree: ContentTreeInput = {
  categories: [
    // Top level. The showcase category comes first: it holds the curated
    // selection the site chrome points at, and later showcase galleries join it
    // rather than earning another root of their own.
    { categoryId: "cat-portfolio", parentId: null, slug: "portfolio", label: "Portfolio", order: 0 },
    { categoryId: "cat-landscape", parentId: null, slug: "landscape", label: "Landscape", order: 1 },
    { categoryId: "cat-travel", parentId: null, slug: "travel", label: "Travel", order: 2 },
    // Public only through a secondary listing, which is something to show.
    { categoryId: "cat-events", parentId: null, slug: "events", label: "Events", order: 3 },
    // Empty leaf: no content, no descendants, so it stays out of the public tree.
    { categoryId: "cat-archive", parentId: null, slug: "archive", label: "Archive", order: 4 },
    // The subjects the articles were already filed under before they moved into
    // this tree. Galleries and articles share one tree, so they are ordinary
    // categories rather than a separate article taxonomy.
    { categoryId: "cat-gear", parentId: null, slug: "gear", label: "Gear", order: 5 },
    { categoryId: "cat-technique", parentId: null, slug: "technique", label: "Technique", order: 6 },
    { categoryId: "cat-behind-the-scenes", parentId: null, slug: "behind-the-scenes", label: "Behind the scenes", order: 7 },

    { categoryId: "cat-coastal", parentId: "cat-landscape", slug: "coastal", label: "Coastal", order: 0 },

    // Depth 2-5 branch reaching the maximum authored depth.
    { categoryId: "cat-europe", parentId: "cat-travel", slug: "europe", label: "Europe", order: 0 },
    { categoryId: "cat-nordics", parentId: "cat-europe", slug: "nordics", label: "Nordics", order: 0 },
    { categoryId: "cat-winter", parentId: "cat-nordics", slug: "winter", label: "Winter", order: 0 },
    { categoryId: "cat-polar-night", parentId: "cat-winter", slug: "polar-night", label: "Polar night", order: 0 },
  ],
  placements: [
    {
      // The site's own selection, and the gallery the header, footer, and home
      // page reach by this identity rather than by a hardcoded path.
      contentId: "content-selected-work",
      variant: "gallery",
      slug: "selected-work",
      published: true,
      canonicalCategoryId: "cat-portfolio",
    },
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
      // Published with nothing in it yet: a gallery between selections is a
      // normal authoring state, and its route says so rather than 404ing an
      // address a visitor may already hold.
      contentId: "content-awaiting-selection",
      variant: "gallery",
      slug: "awaiting-selection",
      published: true,
      canonicalCategoryId: "cat-portfolio",
    },
    // The migrated articles keep the categories they were already filed under.
    // The old model listed them unordered; the migration rule is that the first
    // authored category became the canonical placement and any remaining ones
    // became secondary listings, so no article silently changed subject.
    {
      contentId: "content-choosing-a-telephoto-lens",
      variant: "article",
      slug: "choosing-a-telephoto-lens",
      published: true,
      canonicalCategoryId: "cat-gear",
    },
    {
      contentId: "content-understanding-exposure-triangle",
      variant: "article",
      slug: "understanding-exposure-triangle",
      published: true,
      canonicalCategoryId: "cat-technique",
    },
    {
      // Was filed under Travel and Behind the scenes, so it is the article that
      // exercises a secondary listing linking to one canonical detail route.
      contentId: "content-packing-for-a-photo-trip",
      variant: "article",
      slug: "packing-for-a-photo-trip",
      published: true,
      canonicalCategoryId: "cat-travel",
      secondaryCategoryIds: ["cat-behind-the-scenes"],
    },
    {
      contentId: "content-shooting-in-low-light",
      variant: "article",
      slug: "shooting-in-low-light",
      published: true,
      canonicalCategoryId: "cat-technique",
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
    { categoryId: "cat-portfolio", parentId: null, slug: "portfolio", label: "Portfolio", order: 0 },
    { categoryId: "cat-landscape", parentId: null, slug: "maisemat", label: "Maisemat", order: 1 },
    { categoryId: "cat-travel", parentId: null, slug: "matkat", label: "Matkat", order: 2 },
    { categoryId: "cat-events", parentId: null, slug: "tapahtumat", label: "Tapahtumat", order: 3 },
    { categoryId: "cat-archive", parentId: null, slug: "arkisto", label: "Arkisto", order: 4 },
    // `cat-gear` has no Finnish version at all: a category, like a page, may
    // exist in one locale before the other.
    { categoryId: "cat-technique", parentId: null, slug: "tekniikka", label: "Tekniikka", order: 6 },

    { categoryId: "cat-coastal", parentId: "cat-landscape", slug: "rannikko", label: "Rannikko", order: 0 },

    { categoryId: "cat-europe", parentId: "cat-travel", slug: "eurooppa", label: "Eurooppa", order: 0 },
    { categoryId: "cat-nordics", parentId: "cat-europe", slug: "pohjoismaat", label: "Pohjoismaat", order: 0 },
    { categoryId: "cat-winter", parentId: "cat-nordics", slug: "talvi", label: "Talvi", order: 0 },
    { categoryId: "cat-polar-night", parentId: "cat-winter", slug: "kaamos", label: "Kaamos", order: 0 },
  ],
  placements: [
    {
      contentId: "content-selected-work",
      variant: "gallery",
      slug: "valikoima",
      published: true,
      canonicalCategoryId: "cat-portfolio",
    },
    {
      contentId: "content-coastal-mornings",
      variant: "gallery",
      slug: "rannikon-aamut",
      published: true,
      canonicalCategoryId: "cat-coastal",
      secondaryCategoryIds: ["cat-events"],
    },
    {
      contentId: "content-reading-coastal-light",
      variant: "article",
      slug: "rannikon-valon-lukeminen",
      published: true,
      canonicalCategoryId: "cat-landscape",
    },
    {
      contentId: "content-polar-night-sessions",
      variant: "gallery",
      slug: "kaamoskuvaukset",
      published: true,
      canonicalCategoryId: "cat-polar-night",
    },
    {
      contentId: "content-awaiting-selection",
      variant: "gallery",
      slug: "odottaa-valintaa",
      published: true,
      canonicalCategoryId: "cat-portfolio",
    },
    // One of the articles published in both languages, so a detail page has a
    // real exact language switch to offer. Some English siblings still have no
    // Finnish version and fall back to the nearest page instead.
    {
      contentId: "content-understanding-exposure-triangle",
      variant: "article",
      slug: "valotuskolmio-kaytannossa",
      published: true,
      canonicalCategoryId: "cat-technique",
    },
    {
      contentId: "content-shooting-in-low-light",
      variant: "article",
      slug: "hamarakuvaus-ilman-jalustaa",
      published: true,
      canonicalCategoryId: "cat-technique",
    },
  ],
};

/**
 * Recorded path history, which a CMS writes when an author confirms a URL
 * change. Every case ADR-0003 decision 7 names is covered: a rename, where the
 * category kept its parent and changed its own slug; a move, where the category
 * kept its slug and gained an ancestor; and a content page whose own slug
 * changed beneath an unchanged category.
 */
const englishContentRedirects: readonly ContentRedirectInput[] = [
  { kind: "category", id: "cat-events", previousPath: ["happenings"] },
  { kind: "category", id: "cat-coastal", previousPath: ["coastal"] },
  {
    kind: "content",
    id: "content-shooting-in-low-light",
    previousPath: ["technique", "low-light-without-a-tripod"],
  },
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
