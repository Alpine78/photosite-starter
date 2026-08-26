/**
 * The public Sanity cache contract owned by AB#83.
 *
 * Query tags are transport diagnostics; cache tags name public representation
 * families. Keeping the translation here prevents an adapter from inventing a
 * cache namespace and gives the webhook one closed, bounded invalidation map.
 * Every cached query also carries `all`, which is the recovery boundary when a
 * delivery has no trustworthy old state.
 */

import "server-only";

export const SANITY_PUBLIC_CACHE_TTL_SECONDS = 60 * 60;

export const SANITY_PUBLIC_CACHE_TAGS = {
  all: "sanity:public",
  settings: "sanity:settings",
  home: "sanity:home",
  services: "sanity:services",
  articles: "sanity:articles",
  categories: "sanity:categories",
  galleries: "sanity:galleries",
  media: "sanity:media",
  metadata: "sanity:metadata",
  sitemap: "sanity:sitemap",
} as const;

export type SanityPublicCacheTag =
  (typeof SANITY_PUBLIC_CACHE_TAGS)[keyof typeof SANITY_PUBLIC_CACHE_TAGS];

export type SanityPublicCachePolicy = {
  readonly revalidate: number;
  readonly tags: readonly SanityPublicCacheTag[];
};

const T = SANITY_PUBLIC_CACHE_TAGS;

const QUERY_CACHE_TAGS: Readonly<
  Record<string, readonly SanityPublicCacheTag[]>
> = {
  "site-settings": [T.settings, T.metadata, T.sitemap],
  "home-page": [T.home, T.media, T.metadata, T.sitemap],
  "service.list": [T.services, T.media, T.metadata, T.sitemap],
  "service.detail": [T.services, T.media, T.metadata, T.sitemap],
  "article.listing": [T.articles, T.categories, T.media, T.metadata, T.sitemap],
  "article.detail": [T.articles, T.categories, T.media, T.metadata, T.sitemap],
  "article.placements": [T.articles, T.categories, T.metadata, T.sitemap],
  "article.adjacent": [T.articles, T.categories, T.media, T.metadata, T.sitemap],
  "category.index": [T.categories, T.articles, T.galleries, T.metadata, T.sitemap],
  "category.tree": [T.categories, T.articles, T.galleries, T.metadata, T.sitemap],
  "gallery.detail": [T.galleries, T.categories, T.media, T.metadata, T.sitemap],
  "gallery.listing": [T.galleries, T.categories, T.media, T.metadata, T.sitemap],
  "gallery.sections": [T.galleries, T.metadata, T.sitemap],
  "gallery.placements": [T.galleries, T.media, T.metadata, T.sitemap],
  "gallery.placements.basics": [T.galleries, T.media, T.metadata, T.sitemap],
  "gallery.placements.window": [T.galleries, T.media, T.metadata, T.sitemap],
  "media.detail": [T.media],
  "media.list": [T.media],
};

/**
 * Unknown and operational queries are deliberately uncached. A newly added
 * adapter therefore cannot put data into the public cache until its effects
 * have been added to the invalidation map and tested here.
 */
export function getSanityPublicCachePolicy(
  queryTag: string,
): SanityPublicCachePolicy | undefined {
  const tags = QUERY_CACHE_TAGS[queryTag];
  if (tags === undefined) return undefined;

  return {
    revalidate: SANITY_PUBLIC_CACHE_TTL_SECONDS,
    tags: [T.all, ...tags],
  };
}

/** Studio document type names, restated at the server-only adapter boundary. */
const DOCUMENT_INVALIDATION_TAGS: Readonly<
  Record<string, readonly SanityPublicCacheTag[]>
> = {
  siteSettings: [T.settings, T.home, T.metadata, T.sitemap],
  homePage: [T.home, T.metadata, T.sitemap],
  service: [T.services, T.metadata, T.sitemap],
  article: [T.articles, T.categories, T.metadata, T.sitemap],
  category: [T.categories, T.articles, T.galleries, T.metadata, T.sitemap],
  gallery: [T.galleries, T.categories, T.metadata, T.sitemap],
  galleryPlacement: [T.galleries, T.metadata, T.sitemap],
  media: [
    T.media,
    T.home,
    T.services,
    T.articles,
    T.galleries,
    T.metadata,
    T.sitemap,
  ],
};

export function isKnownSanityPublicDocumentType(type: string): boolean {
  return DOCUMENT_INVALIDATION_TAGS[type] !== undefined;
}

/**
 * Returns a de-duplicated, deterministic set for one or both document states.
 * Unknown types are rejected by the webhook before this function is called.
 */
export function getSanityDocumentInvalidationTags(
  types: readonly string[],
): readonly SanityPublicCacheTag[] {
  const selected = new Set<SanityPublicCacheTag>();

  for (const type of types) {
    for (const tag of DOCUMENT_INVALIDATION_TAGS[type] ?? []) selected.add(tag);
  }

  return Object.values(T).filter((tag) => selected.has(tag));
}

export function getSanityBroadInvalidationTags(): readonly SanityPublicCacheTag[] {
  return [T.all];
}
