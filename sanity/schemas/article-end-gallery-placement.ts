/** One separately queryable placement in an article's optional end gallery. */

import { ARTICLE_TYPE_NAME } from "./article";
import {
  GALLERY_PLACEMENT_TYPE_NAME,
  MAX_PLACEMENT_ID_LENGTH,
} from "./gallery-placement";
import { MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaFieldDefinition,
  SchemaTypeDefinition,
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

export const ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME =
  "articleEndGalleryPlacement";
const PLACEMENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function ref(document: Readonly<Record<string, unknown>>, field: string) {
  const value = document[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return text((value as { readonly _ref?: unknown })._ref);
}

async function validatePlacementIdentity(
  value: string | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (
    value === undefined ||
    !PLACEMENT_ID.test(value) ||
    value.length > MAX_PLACEMENT_ID_LENGTH
  ) {
    return `Use at most ${MAX_PLACEMENT_ID_LENGTH} lowercase letters, digits, and single hyphens.`;
  }
  const document = context.document;
  if (document === undefined) return true;
  const documentId = text(document._id);
  const articleRef = ref(document, "article");
  const mediaRef = ref(document, "media");
  if (
    documentId === undefined ||
    articleRef === undefined ||
    mediaRef === undefined
  ) {
    return true;
  }
  const published = publishedIdOf(documentId);
  const publishedArticleRef = publishedIdOf(articleRef);
  const draftArticleRef = `drafts.${publishedArticleRef}`;
  const result = await validationClientOf(context).fetch<{
    readonly published: {
      readonly placementId?: string | null;
      readonly articleRef?: string | null;
      readonly mediaRef?: string | null;
    } | null;
    readonly articles: readonly {
      readonly _id: string;
      readonly contentId?: string | null;
      readonly endGalleryId?: string | null;
    }[];
    readonly conflicts: readonly {
      readonly _id: string;
      readonly _type: string;
      readonly mediaRef?: string | null;
      readonly containerContentId?: string | null;
      readonly articleRef?: string | null;
      readonly endGalleryId?: string | null;
    }[];
  }>(
    `{
      "published": *[_id == $published][0]{
        placementId, "articleRef": article._ref, "mediaRef": media._ref
      },
      "articles": *[_type == "article" && _id in [$articleRef, $draftArticleRef]]{
        _id, contentId, endGalleryId
      },
      "conflicts": *[
        _type in [$type, $galleryType] && placementId == $placementId &&
        !sanity::versionOf($published)
      ]{
        _id, _type, "mediaRef": media._ref, "articleRef": article._ref,
        "containerContentId": coalesce(article->contentId, gallery->contentId),
        "endGalleryId": article->endGalleryId
      }
    }`,
    {
      type: ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME,
      galleryType: GALLERY_PLACEMENT_TYPE_NAME,
      placementId: value,
      published,
      articleRef: publishedArticleRef,
      draftArticleRef,
    },
  );
  const article =
    result.articles.find((candidate) => candidate._id === draftArticleRef) ??
    result.articles.find((candidate) => candidate._id === publishedArticleRef);
  const contentId = text(article?.contentId);
  const endGalleryId = text(article?.endGalleryId);
  if (contentId === undefined || endGalleryId === undefined) {
    return "The referenced article must declare an end-gallery ID before this placement can be published.";
  }

  for (const conflict of result.conflicts) {
    if (conflict._id === documentId) continue;
    if (
      conflict._type !== ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME ||
      (typeof conflict.articleRef === "string" && publishedIdOf(conflict.articleRef) === publishedArticleRef) ||
      text(conflict.containerContentId) !== contentId ||
      text(conflict.endGalleryId) !== endGalleryId ||
      text(conflict.mediaRef) !== mediaRef
    ) {
      return `Placement id "${value}" is already bound to another public occurrence (ADR-0002 §1).`;
    }
  }

  if (result.published !== null) {
    if (
      typeof result.published.placementId === "string" &&
      result.published.placementId !== value
    ) {
      return "A published placement ID cannot be changed.";
    }
    if (
      typeof result.published.articleRef === "string" &&
      result.published.articleRef !== publishedArticleRef
    ) {
      return "Moving a published placement requires a new placement ID.";
    }
    if (
      typeof result.published.mediaRef === "string" &&
      result.published.mediaRef !== mediaRef
    ) {
      return "Replacing media in a published placement requires a new placement ID.";
    }
  }
  return true;
}

async function warnRepeatedMedia(
  value: { readonly _ref?: unknown } | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  const document = context.document;
  const documentId = text(document?._id);
  const articleRef = document === undefined ? undefined : ref(document, "article");
  const mediaRef = text(value?._ref);
  if (!documentId || !articleRef || !mediaRef) return true;
  const published = publishedIdOf(documentId);
  const siblings = await validationClientOf(context).fetch<
    readonly { readonly _id: string; readonly mediaRef?: string | null }[]
  >(
    `*[_type == $type && article._ref == $articleRef && !sanity::versionOf($published)]{
      _id, "mediaRef": media._ref
    }`,
    {
      type: ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME,
      articleRef,
      published,
    },
  );
  return siblings.some(
    (sibling) => sibling._id !== documentId && sibling.mediaRef === mediaRef,
  )
    ? "This end gallery already contains this photograph. Allowed, but confirm the repetition is intentional."
    : true;
}

const nonNegativeInteger = (value: number | undefined): SchemaValidationResult =>
  value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? true
    : "Enter a whole number, 0 or greater";

const fields: readonly SchemaFieldDefinition[] = [
  {
    name: "article",
    title: "Article",
    type: "reference",
    to: [{ type: ARTICLE_TYPE_NAME }],
    validation: (rule) => rule.required(),
  },
  {
    name: "placementId",
    title: "Placement ID",
    type: "string",
    description: "Stable site-wide occurrence identity (ADR-0002 §1).",
    validation: (rule) => rule.required().custom(validatePlacementIdentity),
  },
  {
    name: "order",
    title: "Order",
    type: "number",
    description:
      "Manual position. Equal values are deterministically tie-broken by placement ID.",
    validation: (rule) => rule.required().custom<number>(nonNegativeInteger),
  },
  {
    name: "visible",
    title: "Visible",
    type: "boolean",
    initialValue: true,
    validation: (rule) => rule.required(),
  },
  {
    name: "media",
    title: "Media",
    type: "reference",
    to: [{ type: MEDIA_TYPE_NAME }],
    validation: (rule) => [rule.required(), rule.custom(warnRepeatedMedia).warning()],
  },
  { name: "altOverride", title: "Alt text override", type: "string" },
  { name: "captionOverride", title: "Caption override", type: "string" },
];

export const articleEndGalleryPlacementType: SchemaTypeDefinition = {
  name: ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME,
  title: "Article end-gallery placement",
  type: "document",
  description:
    "One ordered photograph occurrence in the large gallery after an article body (AB#161).",
  fields,
  preview: { select: { title: "placementId", subtitle: "article.title", media: "media" } },
};
