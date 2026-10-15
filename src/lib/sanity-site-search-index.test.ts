import { describe, expect, it, vi } from "vitest";

import { articleType } from "../../sanity/schemas/article";
import { galleryType } from "../../sanity/schemas/gallery";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import {
  PROJECTED_SITE_SEARCH_FIELDS,
  SITE_SEARCH_INDEX_MAX_RESPONSE_BYTES,
  SITE_SEARCH_QUERY_TAG,
  SITE_SEARCH_STORY_QUERY,
  SiteSearchIndexError,
  readPublicSiteSearchStoryRecords,
} from "@/lib/sanity-site-search-index";

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

function fakeClient(answer: unknown): {
  client: SanityClient;
  requests: SanityQueryRequest[];
} {
  const requests: SanityQueryRequest[] = [];
  return {
    requests,
    client: {
      async query(request) {
        requests.push(request);
        return answer;
      },
    },
  };
}

function cover() {
  return {
    mediaId: "latvia-cover",
    mediaType: "image",
    publiclyRenderable: true,
    alt: [{ language: "fi", value: "Ralliauto soralla" }],
    asset: {
      url: "https://cdn.sanity.io/images/zp7mbokg/production/Tb9Ew8CXIwaY6R1kjMvI0uRR-1600x1067.webp",
      path: "images/zp7mbokg/production/Tb9Ew8CXIwaY6R1kjMvI0uRR-1600x1067.webp",
      extension: "webp",
      mimeType: "image/webp",
      width: 1600,
      height: 1067,
    },
  };
}

describe("the site-search story query", () => {
  it("reads only fields both story schemas declare", () => {
    const article = new Set(articleType.fields.map((field) => field.name));
    const gallery = new Set(galleryType.fields.map((field) => field.name));
    for (const field of PROJECTED_SITE_SEARCH_FIELDS) {
      expect(article.has(field), `article.${field}`).toBe(true);
      expect(gallery.has(field), `gallery.${field}`).toBe(true);
    }
  });

  it("takes the language as a parameter and never reads a body or private field", () => {
    expect(SITE_SEARCH_STORY_QUERY).toContain("language == $language");
    expect(SITE_SEARCH_STORY_QUERY).toContain("dateTime(endDate) > dateTime(now())");
    // The shared public-media projection is audited by its own suite; what this
    // query adds on top of it must stay as narrow as the search row.
    const own = SITE_SEARCH_STORY_QUERY.slice(
      0,
      SITE_SEARCH_STORY_QUERY.indexOf('"cover"'),
    );
    for (const forbidden of ["body", "author", "imageCount", "archiveLocator"]) {
      expect(own).not.toContain(forbidden);
    }
  });

  it("stays inside the client's response ceiling", () => {
    expect(SITE_SEARCH_INDEX_MAX_RESPONSE_BYTES).toBeLessThanOrEqual(1024 * 1024);
  });
});

describe("readPublicSiteSearchStoryRecords", () => {
  it("projects articles and galleries through the listing validators", async () => {
    const { client, requests } = fakeClient([
      {
        documentType: "article",
        contentId: "article-one",
        title: "Camera notes",
        summary: "Choosing a lens.",
        tags: ["gear", "  lenses ", "", 7, null],
        publishedAt: "2024-05-01T10:00:00Z",
        cover: null,
      },
      {
        documentType: "gallery",
        contentId: "gallery-one",
        title: "Tet Rally Latvia 2024",
        tags: null,
        publishedAt: "2024-07-30T10:00:00Z",
        eventDate: "2024-07-27",
        cover: cover(),
      },
    ]);

    const records = await readPublicSiteSearchStoryRecords({
      language: "fi-FI",
      client,
      config,
    });

    expect(requests).toEqual([
      {
        query: SITE_SEARCH_STORY_QUERY,
        params: { language: "fi" },
        tag: SITE_SEARCH_QUERY_TAG,
      },
    ]);
    expect(records.map((record) => record.contentId)).toEqual([
      "article-one",
      "gallery-one",
    ]);
    expect(records[0]).toMatchObject({
      title: "Camera notes",
      summary: "Choosing a lens.",
      // The effective event date falls back to `publishedAt`.
      eventDate: "2024-05-01T10:00:00Z",
      tags: ["gear", "lenses"],
    });
    expect(records[0]?.cover).toBeUndefined();
    expect(records[1]).toMatchObject({ eventDate: "2024-07-27", tags: [] });
    expect(records[1]?.cover?.rendition).toMatchObject({ width: 1600, height: 1067 });
  });

  it("refuses an answer that is not a list of documents", async () => {
    for (const answer of [null, {}, "x", [1], [{ contentId: "a" }, "b"]]) {
      await expect(
        readPublicSiteSearchStoryRecords({
          language: "fi",
          client: fakeClient(answer).client,
          config,
        }),
      ).rejects.toBeInstanceOf(SiteSearchIndexError);
    }
  });

  it("refuses a document with no usable identity rather than hiding it", async () => {
    await expect(
      readPublicSiteSearchStoryRecords({
        language: "fi",
        client: fakeClient([
          { documentType: "article", contentId: "Not Valid", title: "x", publishedAt: "2024-05-01T10:00:00Z" },
        ]).client,
        config,
      }),
    ).rejects.toThrow(/contentId/);
  });

  it("returns an empty index for an empty list", async () => {
    await expect(
      readPublicSiteSearchStoryRecords({
        language: "en",
        client: fakeClient([]).client,
        config,
      }),
    ).resolves.toEqual([]);
  });
});
