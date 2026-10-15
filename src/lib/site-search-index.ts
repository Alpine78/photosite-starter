/**
 * Route-facing source of the site search's story records (ADR-0033): what the
 * in-memory matcher searches, per language, from the mock fixtures or Sanity.
 *
 * It is a *candidate* set, not a visibility decision. A record is searchable
 * only once `site-search.ts` has found its `contentId` in the locale's public
 * content tree, so eligibility and the destination path are the public
 * route's by construction; nothing here decides either. Services need no
 * source of their own: `services.ts` already reads them, with their routes.
 */

import type { ContentListingRecord } from "@/lib/content-listing";
import { dispatchContentSource } from "@/lib/content-source";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { mockContentListingRecords } from "@/lib/mock-content-listing";
import { mockContentPages } from "@/lib/mock-content-pages";

/** The fields one story is searched and listed by. */
export type SiteSearchStoryRecord = Pick<
  ContentListingRecord,
  "contentId" | "title" | "summary" | "eventDate" | "cover"
> & {
  /** Free keywords, searched but never displayed as a category. */
  readonly tags: readonly string[];
};

/**
 * Every story (article and gallery) of one language that is a candidate for
 * search, in no promised order. `language` is a bare subtag such as `fi`.
 */
export async function getSiteSearchStoryRecords(
  language: string,
): Promise<readonly SiteSearchStoryRecord[]> {
  const { contentSource } = getDeploymentConfig();
  return dispatchContentSource(contentSource, {
    // See `dispatchContentSource` for why the adapter import is dynamic.
    sanity: async () => {
      const { readPublicSiteSearchStoryRecords } = await import(
        "@/lib/sanity-site-search-index"
      );
      return readPublicSiteSearchStoryRecords({ language });
    },
    mock: async () => {
      const records = mockContentListingRecords[language];
      const pages = mockContentPages[language];
      if (records === undefined) return [];
      return [...records.values()].map(
        (record): SiteSearchStoryRecord => ({
          contentId: record.contentId,
          title: record.title,
          eventDate: record.eventDate,
          ...(record.summary === undefined ? {} : { summary: record.summary }),
          ...(record.cover === undefined ? {} : { cover: record.cover }),
          tags: pages?.get(record.contentId)?.tags ?? [],
        }),
      );
    },
  });
}
