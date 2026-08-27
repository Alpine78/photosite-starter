import { describe, expect, it } from "vitest";

import {
  getSanityBroadInvalidationTags,
  getSanityDocumentInvalidationTags,
  getSanityPublicCachePolicy,
  SANITY_PUBLIC_CACHE_TAGS,
  SANITY_PUBLIC_CACHE_TTL_SECONDS,
} from "@/lib/sanity-cache";

describe("published Sanity query cache policy", () => {
  it.each([
    ["site-settings", "settings"],
    ["home-page", "home"],
    ["service.list", "services"],
    ["article.detail", "articles"],
    ["article.adjacent", "articles"],
    ["category.tree", "categories"],
    ["category.ids", "categories"],
    ["category.listing.version", "categories"],
    ["category.listing.version", "articles"],
    ["category.listing.version", "galleries"],
    ["article.listing.by-category", "articles"],
    ["gallery.placements.window", "galleries"],
    ["gallery.listing", "galleries"],
    ["gallery.listing.by-category", "galleries"],
    ["media.detail", "media"],
  ] as const)("maps %s into the %s public family", (queryTag, family) => {
    const policy = getSanityPublicCachePolicy(queryTag);

    expect(policy?.revalidate).toBe(SANITY_PUBLIC_CACHE_TTL_SECONDS);
    expect(policy?.tags).toContain(SANITY_PUBLIC_CACHE_TAGS.all);
    expect(policy?.tags).toContain(SANITY_PUBLIC_CACHE_TAGS[family]);
  });

  it("leaves an unreviewed or operational query out of the public cache", () => {
    expect(getSanityPublicCachePolicy("connectivity.probe")).toBeUndefined();
    expect(getSanityPublicCachePolicy("future.adapter")).toBeUndefined();
  });
});

describe("document invalidation map", () => {
  it("invalidates every surface that can embed reused media", () => {
    expect(getSanityDocumentInvalidationTags(["media"])).toEqual([
      SANITY_PUBLIC_CACHE_TAGS.home,
      SANITY_PUBLIC_CACHE_TAGS.services,
      SANITY_PUBLIC_CACHE_TAGS.articles,
      SANITY_PUBLIC_CACHE_TAGS.galleries,
      SANITY_PUBLIC_CACHE_TAGS.media,
      SANITY_PUBLIC_CACHE_TAGS.metadata,
      SANITY_PUBLIC_CACHE_TAGS.sitemap,
    ]);
  });

  it("invalidates category listings, content routes, metadata, and sitemap inputs after a tree change", () => {
    expect(getSanityDocumentInvalidationTags(["category"])).toEqual([
      SANITY_PUBLIC_CACHE_TAGS.articles,
      SANITY_PUBLIC_CACHE_TAGS.categories,
      SANITY_PUBLIC_CACHE_TAGS.galleries,
      SANITY_PUBLIC_CACHE_TAGS.metadata,
      SANITY_PUBLIC_CACHE_TAGS.sitemap,
    ]);
  });

  it("de-duplicates a before/after type set and keeps bounded order", () => {
    expect(getSanityDocumentInvalidationTags(["article", "article"])).toEqual(
      getSanityDocumentInvalidationTags(["article"]),
    );
  });

  it("uses one stable global tag for the broad recovery fallback", () => {
    expect(getSanityBroadInvalidationTags()).toEqual([
      SANITY_PUBLIC_CACHE_TAGS.all,
    ]);
  });
});
