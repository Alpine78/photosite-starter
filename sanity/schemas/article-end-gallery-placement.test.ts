import { describe, expect, it } from "vitest";
import { inspectValidationRules } from "./validation-test-helper";
import { defineSchemaTypes } from "./index";
import { ARTICLE_TYPE_NAME } from "./article";
import {
  ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME,
  articleEndGalleryPlacementType,
} from "./article-end-gallery-placement";
import { MEDIA_TYPE_NAME } from "./media";

const field = (name: string) => {
  const result = articleEndGalleryPlacementType.fields.find((item) => item.name === name);
  if (result === undefined) throw new Error(`missing ${name}`);
  return result;
};

describe("article end-gallery placement schema", () => {
  it("is registered with article and media references", () => {
    const types = defineSchemaTypes({
      datasetVisibility: "public",
      storyRootPaths: ["/stories"],
    });
    expect(types.some((type) => type.name === ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME)).toBe(true);
    expect(field("article").to).toEqual([{ type: ARTICLE_TYPE_NAME }]);
    expect(field("media").to).toEqual([{ type: MEDIA_TYPE_NAME }]);
  });

  it("requires a non-negative integer order", async () => {
    const { required, checks } = inspectValidationRules(field("order").validation);
    expect(required).toBe(true);
    const context = { getClient: () => { throw new Error("unused"); } };
    await expect(checks[0]?.(0, context)).resolves.toBe(true);
    await expect(checks[0]?.(-1, context)).resolves.toEqual(expect.any(String));
    await expect(checks[0]?.(1.5, context)).resolves.toEqual(expect.any(String));
  });
});

it("rejects same-language duplicate identities and cross-container reuse", async () => {
  const { checks } = inspectValidationRules(field("placementId").validation);
  for (const conflict of [
    { _id: "duplicate", _type: "articleEndGalleryPlacement", articleRef: "article-en", containerContentId: "story", endGalleryId: "ending", mediaRef: "photo" },
    { _id: "curated", _type: "galleryPlacement", containerContentId: "story", mediaRef: "photo" },
  ]) {
    const context = {
      document: { _id: "drafts.placement", article: { _ref: "article-en" }, media: { _ref: "photo" } },
      getClient: () => ({ withConfig() { return this; }, fetch: async <T>() => ({
        published: null,
        articles: [{ _id: "article-en", contentId: "story", endGalleryId: "ending" }],
        conflicts: [conflict],
      }) as T }),
    };
    await expect(checks[0]?.("occurrence", context)).resolves.toEqual(expect.any(String));
  }
});

it("allows matching translations but refuses rebinding a published occurrence", async () => {
  const { checks } = inspectValidationRules(field("placementId").validation);
  const result = {
    published: null as null | { placementId: string; articleRef: string; mediaRef: string },
    articles: [{ _id: "article-en", contentId: "story", endGalleryId: "ending" }],
    conflicts: [{ _id: "translation", _type: "articleEndGalleryPlacement", articleRef: "article-fi", containerContentId: "story", endGalleryId: "ending", mediaRef: "photo" }],
  };
  const context = {
    document: { _id: "drafts.placement", article: { _ref: "article-en" }, media: { _ref: "photo" } },
    getClient: () => ({ withConfig() { return this; }, fetch: async <T>() => result as T }),
  };
  await expect(checks[0]?.("occurrence", context)).resolves.toBe(true);
  result.published = { placementId: "occurrence", articleRef: "article-en", mediaRef: "previous-photo" };
  await expect(checks[0]?.("occurrence", context)).resolves.toEqual(expect.any(String));
});
