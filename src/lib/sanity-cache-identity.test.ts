import { afterEach, describe, expect, it, vi } from "vitest";
import { IncrementalCache } from "next/dist/server/lib/incremental-cache";
import { createSanityClient, type SanityClient } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import { getSanityPublicCachePolicy } from "@/lib/sanity-cache";
import {
  readPublicArticlePage,
  readPublicArticleListingRecords,
  readPublicArticleListingRecordsInCategories,
  readPublicArticleAdjacentRecords,
} from "@/lib/sanity-article";
import {
  readPublicGalleryPage,
  readPublicGalleryListingRecords,
  readPublicGalleryListingRecordsInCategories,
} from "@/lib/sanity-gallery";

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};
const listing = {
  scope: "routed-content" as const,
  contentIds: ["content-a"],
  ordering: "event-date-desc-v1" as const,
  limit: 5,
};
const category = {
  scope: "category-subtree" as const,
  categoryIds: ["category-a"],
  ordering: "event-date-desc-v1" as const,
  limit: 5,
};
const reads: readonly [string, (client: SanityClient, language: string) => Promise<unknown>][] = [
  ["article.detail", (client, language) => readPublicArticlePage("content-a", { client, language, config })],
  ["gallery.detail", (client, language) => readPublicGalleryPage("content-a", { client, language, config })],
  ["article.listing", (client, language) => readPublicArticleListingRecords(listing, { client, language, config })],
  ["gallery.listing", (client, language) => readPublicGalleryListingRecords(listing, { client, language, config })],
  ["article.listing.by-category", (client, language) => readPublicArticleListingRecordsInCategories(category, { client, language, config })],
  ["gallery.listing.by-category", (client, language) => readPublicGalleryListingRecordsInCategories(category, { client, language, config })],
  ["article.adjacent", (client, language) => readPublicArticleAdjacentRecords("content-a", { client, language, config })],
];

afterEach(() => vi.useRealTimers());

describe("Sanity transport and installed Next cache identity (AB#154)", () => {
  it.each(reads)("%s reuses its identity as time advances, with locale isolation", async (tag, read) => {
    vi.useFakeTimers();
    const calls: { url: string; init?: RequestInit }[] = [];
    const client = createSanityClient({
      config,
      fetchImplementation: async (input, init) => {
        const url = String(input);
        const requestTag = new URL(url).searchParams.get("tag");
        if (requestTag === tag) calls.push({ url, init });
        return Response.json({ result: requestTag === "category.ids" ? [{ _id: "category-doc-a" }] : requestTag === "article.adjacent" ? null : [] });
      },
    });
    for (const time of ["2026-09-07T10:00:00.000Z", "2026-09-07T10:00:00.001Z", "2026-09-07T10:59:59.999Z", "2026-09-07T11:00:00.000Z"]) {
      vi.setSystemTime(new Date(time));
      await read(client, "en");
    }
    expect(calls).toHaveLength(4);
    // Exercise the installed implementation without initializing its filesystem cache.
    const cache = Object.create(IncrementalCache.prototype) as IncrementalCache;
    const keys = await Promise.all(calls.map(({ url, init }) => cache.generateCacheKey(url, init)));
    expect(new Set(calls.map(({ url }) => url)).size).toBe(1);
    expect(new Set(keys).size).toBe(1);
    const url = new URL(calls[0].url);
    expect(url.hostname).toBe("zp7mbokg.api.sanity.io");
    expect(url.searchParams.get("perspective")).toBe("published");
    expect(url.searchParams.has("$now")).toBe(false);
    const query = url.searchParams.get("query")!;
    expect(query).toContain("!defined(endDate) || dateTime(endDate) > dateTime(now())");
    expect(query.indexOf("dateTime(now())")).toBeLessThan(query.indexOf("[0"));
    expect(calls[0].init).toMatchObject({ next: getSanityPublicCachePolicy(tag) });
    await read(client, "fi");
    expect(await cache.generateCacheKey(calls[4].url, calls[4].init)).not.toBe(keys[0]);
  });
});
