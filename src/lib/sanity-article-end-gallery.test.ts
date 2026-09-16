import { describe, expect, it, vi } from "vitest";
import { articleType, MAX_ARTICLE_END_GALLERY_ID_LENGTH } from "../../sanity/schemas/article";
import { inspectValidationRules } from "../../sanity/schemas/validation-test-helper";
import { projectArticleContentPage } from "@/lib/sanity-article";
import {
  ARTICLE_END_GALLERY_PLACEMENT_DOCUMENT_TYPE,
  readSanityArticleEndGalleryPage,
  SanityArticleEndGalleryError,
} from "@/lib/sanity-article-end-gallery";
import { createHmacGalleryCursorCodec } from "@/lib/gallery-pagination";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import { articleEndGalleryPlacementType } from "../../sanity/schemas/article-end-gallery-placement";

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

function media(index: number) {
  const token = `asset${index}`;
  const path = `images/${config.projectId}/${config.dataset}/${token}-1600x1067.webp`;
  return {
    mediaId: `media-${index}`,
    mediaType: "image",
    publiclyRenderable: true,
    alt: [{ language: "en", value: `Image ${index}` }],
    asset: {
      url: `https://cdn.sanity.io/${path}`,
      path,
      extension: "webp",
      mimeType: "image/webp",
      width: 1600,
      height: 1067,
      archiveLocator: "must-not-escape",
    },
    privateOnly: false,
    providerSecret: "must-not-escape",
  };
}

function row(index: number) {
  return {
    placementId: `end-${index}`,
    order: index,
    visible: true,
    media: media(index),
  };
}

function clientWith(answers: readonly unknown[]) {
  const requests: SanityQueryRequest[] = [];
  let index = 0;
  const client: SanityClient = {
    async query(request) {
      requests.push(request);
      return answers[index++];
    },
  };
  return { client, requests };
}

describe("Sanity article end-gallery adapter", () => {
  it("pins the adapter and schema document type names", () => {
    expect(ARTICLE_END_GALLERY_PLACEMENT_DOCUMENT_TYPE).toBe(
      articleEndGalleryPlacementType.name,
    );
  });

  it("queries one compound-key bounded window and strips provider fields", async () => {
    const { client, requests } = clientWith([
      [{ _id: "article-doc", endGalleryId: "ending", latestPlacementUpdatedAt: "v1" }],
      [row(1), row(2), row(3)],
    ]);
    const page = await readSanityArticleEndGalleryPage({
      query: {
        locale: "en-GB",
        contentId: "article-one",
        endGalleryId: "ending",
        pageSize: 2,
      },
      cursorCodec: createHmacGalleryCursorCodec("x".repeat(32)),
      client,
      config,
    });
    expect(page?.items.map((item) => item.itemId)).toEqual(["end-1", "end-2"]);
    expect(requests[1]?.params?.candidateLimit).toBe(3);
    expect(requests[1]?.query).toContain("order(order asc, placementId asc)");
    expect(requests[1]?.query).toContain("[0...$candidateLimit]");
    expect(JSON.stringify(page)).not.toContain("archiveLocator");
    expect(JSON.stringify(page)).not.toContain("providerSecret");
  });

  it("rejects malformed store answers and a mismatched declared identity", async () => {
    const malformed = clientWith([{}]);
    await expect(
      readSanityArticleEndGalleryPage({
        query: { locale: "en-GB", contentId: "one", endGalleryId: "ending" },
        client: malformed.client,
        config,
      }),
    ).rejects.toBeInstanceOf(SanityArticleEndGalleryError);

    const mismatch = clientWith([
      [{ _id: "article-doc", endGalleryId: "other" }],
    ]);
    await expect(
      readSanityArticleEndGalleryPage({
        query: { locale: "en-GB", contentId: "one", endGalleryId: "ending" },
        client: mismatch.client,
        config,
      }),
    ).resolves.toBeUndefined();
  });
});

it("continues using the signed compound boundary, rejecting stale and private rows", async () => {
  const codec = createHmacGalleryCursorCodec("x".repeat(32));
  const query = { locale: "en-GB", contentId: "article-one", endGalleryId: "ending", pageSize: 2 };
  const basics = [{ _id: "article-doc", endGalleryId: "ending" }];
  const first = await readSanityArticleEndGalleryPage({ query, config, cursorCodec: codec, ...clientWith([basics, [row(1), row(2), row(3)]]) });
  if (!first?.page.hasNextPage) throw new Error("missing continuation");
  const continuedQuery = { ...query, cursor: first.page.endCursor };
  const next = clientWith([basics, { boundary: row(2), candidates: [row(3)] }]);
  const page = await readSanityArticleEndGalleryPage({ query: continuedQuery, config, cursorCodec: codec, client: next.client });
  expect(page?.items.map((item) => item.itemId)).toEqual(["end-3"]);
  expect(page?.page.hasNextPage).toBe(false);
  expect(next.requests[1]?.params).toMatchObject({ afterOrder: 2, afterPlacementId: "end-2", candidateLimit: 3 });
  expect(next.requests[1]?.query).toContain("placementId > $afterPlacementId");
  await expect(readSanityArticleEndGalleryPage({ query: continuedQuery, config, cursorCodec: codec, ...clientWith([basics, { boundary: null, candidates: [] }]) })).rejects.toMatchObject({ code: "stale" });
  for (const bad of [
    { ...row(1), placementId: " BAD " },
    { ...row(1), media: { ...media(1), privateOnly: true } },
  ]) {
    await expect(readSanityArticleEndGalleryPage({ query, config, cursorCodec: codec, ...clientWith([basics, [bad]]) })).rejects.toThrow();
  }
});


it.each([
  "a", "gallery-1", "a".repeat(MAX_ARTICLE_END_GALLERY_ID_LENGTH),
  "a".repeat(MAX_ARTICLE_END_GALLERY_ID_LENGTH + 1),
  "", "Uppercase", "a_b", "a--b", "-a", "a-", " a ",
])("keeps Studio and both public read boundaries aligned for identity %j", async (endGalleryId) => {
  const field = articleType.fields.find((candidate) => candidate.name === "endGalleryId");
  const { checks } = inspectValidationRules(field?.validation);
  expect(checks).toHaveLength(1);
  const accepted = await checks[0](endGalleryId, {
    getClient: () => { throw new Error("syntax validation needs no store"); },
  }) === true;
  const project = () => projectArticleContentPage({
    contentId: "article-one", title: "Example article", publishedAt: "2024-08-02",
    endGalleryId,
    body: [{ _key: "body-1", _type: "contentParagraphBlock", text: "Example body." }],
  }, { language: "en", fallbackLanguage: "fi", config });
  const read = readSanityArticleEndGalleryPage({
    query: { locale: "en-GB", contentId: "article-one", endGalleryId }, config,
    ...clientWith([[{ _id: "article-doc", endGalleryId }], []]),
  });
  if (accepted) {
    expect(project().endGalleryId).toBe(endGalleryId);
    await expect(read).resolves.toMatchObject({ items: [] });
  } else {
    expect(project).toThrow("invalid end-gallery identity");
    await expect(read).rejects.toThrow("invalid end-gallery identity");
  }
});
