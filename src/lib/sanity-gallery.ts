/**
 * The public gallery adapter (AB#113): Sanity `gallery` documents in, two
 * things out — the `ContentPlacementInput` `content-tree.ts` needs to place
 * the page, and the page-level `GalleryContentPage` (`content-page.ts`) a
 * detail route renders. A gallery's own curated items (`CuratedGalleryPlacement`)
 * and its section catalog's `intro` are deliberately narrower here than
 * `sanity-article.ts`'s equivalent read: `projectGalleryPlacement` and
 * `projectGallerySectionIntro` are pure, unit-tested projectors that AB#114's
 * bounded/windowed query calls, not something this module calls itself from an
 * eager "read every placement" query — that shape is exactly what AB#114
 * replaces `mock-gallery.ts`'s in-memory equivalent with (see the
 * `buildCuratedGalleryPage`/AB#134 precedent already set for the unfiltered and
 * section-filtered gallery reads).
 *
 * ## One document per language
 *
 * Same reasoning as `sanity-article.ts`: `gallery.ts`'s module comment
 * explains why a gallery is one document per language, not one document
 * describing every language.
 *
 * ## Visibility composes by AND (ADR-0002 §3)
 *
 * `projectGalleryPlacement` never rejects the whole document over one
 * placement referencing non-public media — that is the normal "this
 * occurrence doesn't render" state, computed as
 * `placement.visible && media.publiclyRenderable`, never a thrown error.
 */

import "server-only";

import type { GalleryContentPage } from "@/lib/content-page";
import type { ContentPlacementInput } from "@/lib/content-tree";
import type { CuratedGalleryPlacement } from "@/lib/gallery-pagination";
import type {
  GallerySectionIntroBlock,
  GallerySectionInlineMark,
  GallerySectionInlineSpan,
  GallerySectionSummary,
} from "@/lib/gallery-sections";
import {
  CONTENT_BLOCK_PROJECTION,
  readContentBlocks,
} from "@/lib/sanity-content-blocks";
import { readCategoryDocumentIndex } from "@/lib/sanity-content-tree";
import {
  getSanityClient,
  type SanityClient,
} from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  isPubliclyRenderable,
  projectPublicMedia,
  PUBLIC_MEDIA_PROJECTION,
  type PublicMediaLanguage,
  type RawPublicMediaDocument,
} from "@/lib/sanity-media";
import { isRecord, readString, toLanguageSubtag } from "@/lib/sanity-values";
import { getDeploymentConfig } from "@/lib/deployment-config";

/**
 * The document type this adapter reads. Declared here rather than imported
 * from `sanity/schemas`: the Studio schema is content-store configuration, not
 * application code (ADR-0006).
 */
export const GALLERY_DOCUMENT_TYPE = "gallery";

/** The identity form `gallery.ts`'s Studio validation enforces, enforced again here. */
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const GALLERY_FILTER = `_type == "${GALLERY_DOCUMENT_TYPE}" && language == $language`;

/**
 * The gallery *page's* placement in the category tree — `contentId`, `slug`,
 * `canonicalCategoryRef`, `secondaryCategoryRefs` — unrelated to the gallery's
 * own curated items/`CuratedGalleryPlacement` list. Named to match
 * `sanity-article.ts#ARTICLE_PLACEMENT_PROJECTION`'s identical concept, not the
 * gallery's own `placements` field.
 */
export const GALLERY_PLACEMENT_PROJECTION = `{
  contentId,
  slug,
  "canonicalCategoryRef": canonicalCategory._ref,
  "secondaryCategoryRefs": secondaryCategories[]._ref
}`;

export const GALLERY_DETAIL_PROJECTION = `{
  contentId,
  title,
  summary,
  publishedAt,
  "cover": cover->${PUBLIC_MEDIA_PROJECTION},
  tags,
  body[]${CONTENT_BLOCK_PROJECTION}
}`;

/** Why a document could not become a published gallery projection. */
export type SanityGalleryRejection =
  | "incomplete-document"
  | "malformed-section"
  | "ambiguous-content-id"
  | "malformed-result";

export class SanityGalleryError extends Error {
  readonly rejection: SanityGalleryRejection;
  readonly contentId: string | undefined;

  constructor(
    rejection: SanityGalleryRejection,
    detail: string,
    contentId?: string,
  ) {
    super(
      `[sanity-gallery] ${detail}${contentId === undefined ? "" : ` (contentId "${contentId}")`}`,
    );
    this.name = "SanityGalleryError";
    this.rejection = rejection;
    this.contentId = contentId;
  }
}

export type RawGalleryPlacementDocument = {
  readonly contentId?: unknown;
  readonly slug?: unknown;
  readonly canonicalCategoryRef?: unknown;
  readonly secondaryCategoryRefs?: unknown;
};

export type RawGalleryDetailDocument = {
  readonly contentId?: unknown;
  readonly title?: unknown;
  readonly summary?: unknown;
  readonly publishedAt?: unknown;
  readonly cover?: unknown;
  readonly tags?: unknown;
  readonly body?: unknown;
};

function readContentId(value: unknown, context?: string): string {
  const contentId = readString(value);
  if (contentId === undefined || !CONTENT_ID.test(contentId)) {
    throw new SanityGalleryError(
      "incomplete-document",
      `a gallery document has no usable contentId, so nothing can reference it${context === undefined ? "" : ` (${context})`}`,
    );
  }
  return contentId;
}

const ISO_DATE_OR_DATETIME =
  /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z)?$/;

/** Same round-trip validation as `sanity-article.ts#isValidIsoDate`. */
function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE_OR_DATETIME.exec(value);
  if (match === null) return false;

  const [, year, month, day, hour, minute, second] = match;
  const y = Number(year);
  const mo = Number(month);
  const d = Number(day);
  const h = hour === undefined ? 0 : Number(hour);
  const mi = minute === undefined ? 0 : Number(minute);
  const s = second === undefined ? 0 : Number(second);

  const rebuilt = new Date(Date.UTC(y, mo - 1, d, h, mi, s));
  return (
    rebuilt.getUTCFullYear() === y &&
    rebuilt.getUTCMonth() === mo - 1 &&
    rebuilt.getUTCDate() === d &&
    rebuilt.getUTCHours() === h &&
    rebuilt.getUTCMinutes() === mi &&
    rebuilt.getUTCSeconds() === s
  );
}

function readPublishedAt(value: unknown, contentId: string): string {
  const publishedAt = readString(value);
  if (publishedAt === undefined || !isValidIsoDate(publishedAt)) {
    throw new SanityGalleryError(
      "incomplete-document",
      "the gallery has no publishedAt, or it is not a real ISO calendar date",
      contentId,
    );
  }
  return publishedAt;
}

const UNRESOLVED_CATEGORY_PREFIX = "unresolved-ref:";

function resolveCategoryId(
  ref: string,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): string {
  return (
    categoryIdsByDocumentId.get(ref) ?? `${UNRESOLVED_CATEGORY_PREFIX}${ref}`
  );
}

function readCategoryReference(value: unknown, contentId: string): string | null {
  if (value === undefined || value === null) return null;
  const ref = readString(value);
  if (ref !== undefined) return ref;
  throw new SanityGalleryError(
    "incomplete-document",
    "the gallery's canonical category reference is malformed",
    contentId,
  );
}

function readSecondaryCategoryReferences(
  value: unknown,
  contentId: string,
): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new SanityGalleryError(
      "incomplete-document",
      "the gallery's secondary categories are not a list",
      contentId,
    );
  }
  return value.map((entry) => {
    const ref = readString(entry);
    if (ref === undefined) {
      throw new SanityGalleryError(
        "incomplete-document",
        "the gallery has a malformed secondary category reference",
        contentId,
      );
    }
    return ref;
  });
}

/**
 * Projects one document into the placement `content-tree.ts` needs — page-
 * level metadata, unrelated to the gallery's own curated items. Pure and
 * exported so a fixture test can exercise it without a network, mirroring
 * `sanity-article.ts#projectArticlePlacementInput`.
 */
export function projectGalleryPlacementInput(
  document: RawGalleryPlacementDocument,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): ContentPlacementInput {
  const contentId = readContentId(document.contentId);

  const slug = readString(document.slug);
  if (slug === undefined) {
    throw new SanityGalleryError("incomplete-document", "the gallery has no slug", contentId);
  }

  const canonicalRef = readCategoryReference(document.canonicalCategoryRef, contentId);
  const canonicalCategoryId =
    canonicalRef === null ? null : resolveCategoryId(canonicalRef, categoryIdsByDocumentId);

  const secondaryRefs = readSecondaryCategoryReferences(
    document.secondaryCategoryRefs,
    contentId,
  );
  const secondaryCategoryIds = secondaryRefs.map((ref) =>
    resolveCategoryId(ref, categoryIdsByDocumentId),
  );

  return {
    contentId,
    variant: "gallery",
    slug,
    published: true,
    canonicalCategoryId,
    ...(secondaryCategoryIds.length > 0 ? { secondaryCategoryIds } : {}),
  };
}

function readDocuments<T>(result: unknown): readonly T[] {
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered with something other than a list of gallery documents",
    );
  }
  return result as readonly T[];
}

function getFallbackLocale(): string {
  return getDeploymentConfig().localeRoutes.defaultLocale;
}

export type PublicGalleryPlacementReadOptions = {
  readonly language: string;
  readonly client?: SanityClient;
};

/**
 * Every published gallery in one language, as the placements
 * `readPublicContentTree` composes with categories into one validated tree.
 * In scope for AB#113: this is page-level metadata, not the gallery's curated
 * items.
 */
export async function readPublicGalleryPlacements(
  options: PublicGalleryPlacementReadOptions,
): Promise<readonly ContentPlacementInput[]> {
  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const categoryIdsByDocumentId = await readCategoryDocumentIndex(client);

  const result = await client.query({
    query: `*[${GALLERY_FILTER}]${GALLERY_PLACEMENT_PROJECTION}`,
    params: { language },
    tag: "gallery.placements",
  });

  return readDocuments<RawGalleryPlacementDocument>(result).map((document) =>
    projectGalleryPlacementInput(document, categoryIdsByDocumentId),
  );
}

function readTags(value: unknown, contentId: string): readonly string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new SanityGalleryError(
      "incomplete-document",
      "the gallery's tags are not a list of strings",
      contentId,
    );
  }
  return value;
}

type DetailProjectionOptions = {
  readonly language: string;
  readonly fallbackLanguage: string;
  readonly config: SanityConfig;
};

/**
 * Projects one document into the page-level `GalleryContentPage` a route
 * renders — title, lead, publication date, tags, body, and an explicit cover
 * only. Unlike `sanity-article.ts#projectArticleContentPage`, an empty body is
 * not a defect (ADR-0003 decision 3: a gallery's body is optional editorial
 * content, separate from its curated grid), and there is no fallback here from
 * a missing `cover` to the gallery's first visible placement — that fallback
 * needs the ordered, visible placement list, which is AB#114's bounded query.
 */
export function projectGalleryContentPage(
  document: RawGalleryDetailDocument,
  options: DetailProjectionOptions,
): GalleryContentPage {
  const contentId = readContentId(document.contentId);

  const title = readString(document.title);
  if (title === undefined) {
    throw new SanityGalleryError("incomplete-document", "the gallery has no title", contentId);
  }

  const publishedAt = readPublishedAt(document.publishedAt, contentId);

  const summary = readString(document.summary);
  const cover = isRecord(document.cover)
    ? projectPublicMedia(document.cover as RawPublicMediaDocument, options)
    : undefined;
  const tags = readTags(document.tags, contentId);
  const body = readContentBlocks(document.body, options);

  return {
    contentId,
    variant: "gallery",
    title,
    publishedAt,
    ...(summary === undefined ? {} : { summary }),
    ...(cover === undefined ? {} : { cover }),
    ...(tags.length > 0 ? { tags } : {}),
    body,
  };
}

export type PublicGalleryReadOptions = {
  readonly language: string;
  readonly client?: SanityClient;
  readonly config?: SanityConfig;
};

/**
 * One gallery's page-level content by its stable identity, or `undefined`
 * when this language publishes none under that id — the normal bilingual
 * state, not an error. Mirrors `sanity-article.ts#readPublicArticlePage`;
 * reads `[0...2]` to detect two published documents claiming one identity.
 */
export async function readPublicGalleryPage(
  contentId: string,
  options: PublicGalleryReadOptions,
): Promise<GalleryContentPage | undefined> {
  const client = options.client ?? getSanityClient();
  const language = toLanguageSubtag(options.language);
  const config = options.config ?? getSanityConfig();

  const result = await client.query({
    query: `*[${GALLERY_FILTER} && contentId == $contentId][0...2]${GALLERY_DETAIL_PROJECTION}`,
    params: { language, contentId },
    tag: "gallery.detail",
  });

  const documents = readDocuments<RawGalleryDetailDocument>(result);
  if (documents.length === 0) return undefined;
  if (documents.length > 1) {
    throw new SanityGalleryError(
      "ambiguous-content-id",
      "two published documents claim one content identity in this language",
      contentId,
    );
  }

  return projectGalleryContentPage(documents[0], {
    language,
    fallbackLanguage: getFallbackLocale(),
    config,
  });
}

// ---------------------------------------------------------------------------
// Section catalog (bounded, structural only — not pagination)
// ---------------------------------------------------------------------------

export type RawGallerySectionSummary = {
  readonly sectionId?: unknown;
  readonly slug?: unknown;
  readonly label?: unknown;
};

/** Projects one raw section row into the bounded, `intro`-free catalog entry. */
export function projectGallerySectionSummary(
  raw: RawGallerySectionSummary,
  order: number,
  contentId: string,
): GallerySectionSummary {
  const sectionId = readString(raw.sectionId);
  const slug = readString(raw.slug);
  const label = readString(raw.label);
  if (sectionId === undefined || slug === undefined || label === undefined) {
    throw new SanityGalleryError(
      "malformed-section",
      "a gallery section is missing its id, slug, or label",
      contentId,
    );
  }
  return { sectionId, slug, label, order };
}

/**
 * The gallery's full section catalog — id/slug/label/order only, no `intro` —
 * for AB#105's "full section catalog exposed on every page" requirement. A
 * handful of strings per gallery, so this stays in scope for AB#113 (it is not
 * a windowed/bounded placement query).
 */
export async function readPublicGallerySectionCatalog(
  contentId: string,
  language: string,
  client?: SanityClient,
): Promise<readonly GallerySectionSummary[]> {
  const resolvedClient = client ?? getSanityClient();
  const resolvedLanguage = toLanguageSubtag(language);

  const result = await resolvedClient.query({
    query: `*[${GALLERY_FILTER} && contentId == $contentId][0].sections[]{sectionId, slug, label}`,
    params: { language: resolvedLanguage, contentId },
    tag: "gallery.sections",
  });

  if (result === null || result === undefined) return [];
  if (!Array.isArray(result) || !result.every(isRecord)) {
    throw new SanityGalleryError(
      "malformed-result",
      "the content store answered with something other than a list of gallery sections",
      contentId,
    );
  }

  return (result as readonly RawGallerySectionSummary[]).map((raw, index) =>
    projectGallerySectionSummary(raw, index, contentId),
  );
}

// ---------------------------------------------------------------------------
// Section intro: pure projector, no querying
// ---------------------------------------------------------------------------

const KNOWN_MARKS: ReadonlySet<string> = new Set(["emphasis"]);

export type RawGallerySectionInlineSpan = {
  readonly text?: unknown;
  readonly marks?: unknown;
  readonly href?: unknown;
};

export type RawGallerySectionIntroParagraph = {
  readonly _type: "gallerySectionIntroParagraphBlock";
  readonly _key?: unknown;
  readonly spans?: unknown;
};

export type RawGallerySectionIntroListItem = {
  readonly _key?: unknown;
  readonly spans?: unknown;
};

export type RawGallerySectionIntroList = {
  readonly _type: "gallerySectionIntroListBlock";
  readonly _key?: unknown;
  readonly ordered?: unknown;
  readonly items?: unknown;
};

export type RawGallerySectionIntroBlock =
  | RawGallerySectionIntroParagraph
  | RawGallerySectionIntroList;

function projectSpan(raw: RawGallerySectionInlineSpan): GallerySectionInlineSpan {
  // Not `readString`: it trims whitespace, which would silently swallow a
  // deliberate leading/trailing space between two adjacent spans (e.g. the
  // space before an emphasised run of text).
  const text = typeof raw.text === "string" && raw.text.length > 0 ? raw.text : undefined;
  if (text === undefined) {
    throw new SanityGalleryError(
      "malformed-section",
      "a gallery section intro span has no text",
    );
  }

  const marksRaw = raw.marks;
  const marks =
    Array.isArray(marksRaw) && marksRaw.length > 0
      ? marksRaw.flatMap((mark): readonly GallerySectionInlineMark[] => {
          if (typeof mark !== "string" || !KNOWN_MARKS.has(mark)) {
            throw new SanityGalleryError(
              "malformed-section",
              `a gallery section intro span has an unknown mark: ${String(mark)}`,
            );
          }
          return [mark as GallerySectionInlineMark];
        })
      : undefined;

  const href = readString(raw.href);

  return {
    text,
    ...(marks !== undefined ? { marks } : {}),
    ...(href !== undefined ? { href } : {}),
  };
}

function projectSpans(value: unknown): readonly GallerySectionInlineSpan[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new SanityGalleryError(
      "malformed-section",
      "a gallery section intro block has no spans",
    );
  }
  return value.map((entry) => projectSpan(entry as RawGallerySectionInlineSpan));
}

/**
 * Projects Sanity's `gallerySectionIntroParagraphBlock`/`gallerySectionIntroListBlock`
 * object array back onto `gallery-sections.ts`'s `GallerySectionIntroBlock`
 * union — a 1:1 structural projection, not a portable-text grouping problem:
 * each domain block (including a list's `items`) already corresponds to one
 * Sanity array/object, each carrying its own stable `_key` from Sanity
 * automatically. Pure and unit-tested independently of any query.
 */
export function projectGallerySectionIntro(
  raw: readonly RawGallerySectionIntroBlock[] | undefined,
): readonly GallerySectionIntroBlock[] {
  if (raw === undefined) return [];

  return raw.map((block) => {
    const key = readString((block as { readonly _key?: unknown })._key);
    if (block._type === "gallerySectionIntroParagraphBlock") {
      return {
        type: "paragraph" as const,
        spans: projectSpans(block.spans),
        ...(key !== undefined ? { key } : {}),
      };
    }
    if (block._type === "gallerySectionIntroListBlock") {
      const orderedRaw = block.ordered;
      if (typeof orderedRaw !== "boolean") {
        throw new SanityGalleryError(
          "malformed-section",
          "a gallery section intro list has a non-boolean ordered field",
        );
      }
      const itemsRaw = block.items;
      if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) {
        throw new SanityGalleryError(
          "malformed-section",
          "a gallery section intro list has no items",
        );
      }
      const items = itemsRaw.map((item) => {
        const raw = item as RawGallerySectionIntroListItem;
        const itemKey = readString(raw._key);
        return {
          spans: projectSpans(raw.spans),
          ...(itemKey !== undefined ? { key: itemKey } : {}),
        };
      });
      return {
        type: "list" as const,
        ordered: orderedRaw,
        items,
        ...(key !== undefined ? { key } : {}),
      };
    }
    throw new SanityGalleryError(
      "malformed-section",
      `a gallery section intro block has an unknown type: ${String((block as { readonly _type?: unknown })._type)}`,
    );
  });
}

// ---------------------------------------------------------------------------
// One curated placement: pure projector, no querying — AB#114's bounded query
// calls this per row it reads.
// ---------------------------------------------------------------------------

export type RawGalleryPlacementItem = {
  readonly placementId?: unknown;
  readonly media?: unknown;
  readonly sectionId?: unknown;
  readonly visible?: unknown;
  readonly altOverride?: unknown;
  readonly captionOverride?: unknown;
};

/**
 * Projects one raw placement row into `CuratedGalleryPlacement`, or `undefined`
 * when its referenced media is not publicly renderable — ADR-0002 §3's AND-
 * composition ("a placement can only subtract ... it can never make a
 * non-public media visible"), applied here as *exclusion* rather than a
 * `visible: false` placement carrying an unvalidated `Media`: `Media`'s own
 * fields (alt text, a checked public rendition, ...) are guarantees
 * `projectPublicMedia` enforces for public media specifically, and a
 * photograph that is not publicly renderable has no obligation to satisfy
 * them (it may be an incomplete draft). `undefined` here means exactly what an
 * already-filtered query would have returned: no candidate row at all — never
 * a thrown error that would abort reading the rest of the gallery. This never
 * throws for a media-visibility reason; it still throws (as
 * `SanityGalleryError`) for a genuinely malformed row — a missing
 * `placementId`, an unresolved media reference, or media claiming to be
 * public while failing `projectPublicMedia`'s own content checks, all of
 * which are content defects distinct from ADR-0002 §3's ordinary visibility
 * composition.
 *
 * `order` comes from the caller's own array index (matching
 * `mock-gallery.ts`'s "position is the manual order" convention). Pure and
 * unit-tested independently of any query — this is the function AB#114's
 * bounded query calls per row, not something AB#113 calls itself from an
 * eager "fetch everything" read.
 */
export function projectGalleryPlacement(
  raw: RawGalleryPlacementItem,
  order: number,
  options: PublicMediaLanguage & { readonly config: SanityConfig },
): CuratedGalleryPlacement | undefined {
  const placementId = readString(raw.placementId);
  if (placementId === undefined) {
    throw new SanityGalleryError("malformed-result", "a gallery placement has no placementId");
  }
  if (!isRecord(raw.media)) {
    throw new SanityGalleryError(
      "malformed-result",
      "a gallery placement's media did not resolve",
      placementId,
    );
  }

  const rawMedia = raw.media as RawPublicMediaDocument;
  if (!isPubliclyRenderable(rawMedia)) {
    return undefined;
  }

  const media = projectPublicMedia(rawMedia, options);
  const sectionId = readString(raw.sectionId);
  const altOverride = readString(raw.altOverride);
  const captionOverride = readString(raw.captionOverride);

  return {
    placementId,
    order,
    visible: raw.visible === true,
    media,
    ...(sectionId !== undefined ? { sectionId } : {}),
    ...(altOverride !== undefined ? { altOverride } : {}),
    ...(captionOverride !== undefined ? { captionOverride } : {}),
  };
}
