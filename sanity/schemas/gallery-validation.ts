/**
 * Sanity Studio's publication guard for one gallery document: the URL-identity
 * guard every content-page type shares (`content-placement-validation.ts`),
 * plus gallery-only structural checks no other document type needs — a
 * gallery is the only type that owns an embedded sections array.
 *
 * ## Placement identity moved to `gallery-placement.ts`
 *
 * `placementId` uniqueness, cross-language rebind rules, and immutability
 * (ADR-0002 §1) used to be checked here against this document's own embedded
 * `placements` array. AB#114 moved placements into their own `galleryPlacement`
 * documents (see that file's module comment), so those checks moved with
 * them — `validateGalleryPlacementPublication` there is the one-round-trip
 * restatement of what this file used to do against an in-document array.
 *
 * ## Section checks
 *
 * Restates `gallery-sections.ts`'s already-exported Studio-facing backstops:
 * `sectionId`/`slug` uniqueness, the reserved `all` slug, and
 * published-section-slug immutability (that module's own
 * `assertGallerySectionsSlugStable` doc comment already names this file as
 * its caller). A placement's `sectionId` resolving to a declared section is
 * now `gallery-placement.ts`'s own check, since it is the placement document
 * that names a section, not this one.
 */

import { CATEGORY_TYPE_NAME } from "./category";
import { CATEGORY_VALIDATION_QUERY } from "./category-validation";
import {
  changesPublishedUrlFields,
  indexProspectiveCategoryDocumentIds,
  parseProspectiveCategories,
  validateProspectivePlacement,
  type ProspectivePlacement,
  type ProspectivePlacementFields,
  type PublishedPlacementSnapshot,
} from "./content-placement-validation";
import type {
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

const RESERVED_ALL_SECTION_SLUG = "all";

function exactString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && !/\s/.test(value)
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type RawReference = { readonly _ref?: unknown };

function readReference(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const ref = (value as RawReference)._ref;
  return typeof ref === "string" ? ref : undefined;
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

const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/;

// ---------------------------------------------------------------------------
// Parsing the document being edited
// ---------------------------------------------------------------------------

type RawGallerySection = {
  readonly sectionId?: unknown;
  readonly slug?: unknown;
};

export type ParsedGallerySection = {
  readonly sectionId: string;
  readonly slug: string;
};

type ParsedGalleryDocument = {
  readonly documentId: string;
  readonly contentId: string;
  readonly language: string;
  readonly slug: string;
  readonly canonicalCategoryRef: string | null;
  readonly secondaryCategoryRefs: readonly string[];
  readonly sections: readonly ParsedGallerySection[];
};

function parseSections(raw: unknown): readonly ParsedGallerySection[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const item = entry as RawGallerySection;
    const sectionId = exactString(item.sectionId);
    const slug = exactString(item.slug);
    if (sectionId === undefined || slug === undefined) return [];
    return [{ sectionId, slug }];
  });
}

function parseCurrentGalleryDocument(
  document: Readonly<Record<string, unknown>>,
): ParsedGalleryDocument | undefined {
  const documentId = exactString(document._id);
  const contentId = exactString(document.contentId);
  const language = exactString(document.language);
  const slug = exactString(document.slug);
  if (
    documentId === undefined ||
    contentId === undefined ||
    language === undefined ||
    !LANGUAGE_SUBTAG.test(language) ||
    slug === undefined
  ) {
    return undefined;
  }

  const canonicalRef = readReference(document.canonicalCategory);
  const secondaryRaw = document.secondaryCategories;
  const secondaryCategoryRefs = Array.isArray(secondaryRaw)
    ? secondaryRaw.flatMap((entry) => {
        const ref = readReference(entry);
        return ref === undefined ? [] : [publishedIdOf(ref)];
      })
    : [];

  return {
    documentId,
    contentId,
    language,
    slug,
    canonicalCategoryRef: canonicalRef === undefined ? null : publishedIdOf(canonicalRef),
    secondaryCategoryRefs,
    sections: parseSections(document.sections),
  };
}

function resolveProspectiveGalleryFields(
  parsed: ParsedGalleryDocument,
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): ProspectivePlacementFields {
  const resolve = (ref: string) => resolveCategoryId(ref, categoryIdsByDocumentId);
  return {
    documentId: parsed.documentId,
    contentId: parsed.contentId,
    language: parsed.language,
    slug: parsed.slug,
    canonicalCategoryId:
      parsed.canonicalCategoryRef === null ? null : resolve(parsed.canonicalCategoryRef),
    secondaryCategoryIds: parsed.secondaryCategoryRefs.map(resolve),
  };
}

// ---------------------------------------------------------------------------
// Local structural checks: sections
// ---------------------------------------------------------------------------

/**
 * Restates `gallery-sections.ts#assertGallerySections`'s uniqueness/reserved-
 * slug checks and `assertPlacementSectionReferences`, as Studio-facing
 * messages rather than thrown errors. Purely local — no query needed.
 */
function validateSectionStructure(
  document: ParsedGalleryDocument,
): SchemaValidationResult {
  const ids = new Set<string>();
  const slugs = new Set<string>();
  for (const section of document.sections) {
    if (ids.has(section.sectionId)) {
      return `Duplicate gallery section id: ${section.sectionId}`;
    }
    ids.add(section.sectionId);

    if (section.slug === RESERVED_ALL_SECTION_SLUG) {
      return `Gallery section slug may not be the reserved token "${RESERVED_ALL_SECTION_SLUG}"`;
    }
    if (slugs.has(section.slug)) {
      return `Duplicate gallery section slug: ${section.slug}`;
    }
    slugs.add(section.slug);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Section slug immutability
// ---------------------------------------------------------------------------

function validateSectionSlugStability(
  document: ParsedGalleryDocument,
  publishedSections: readonly ParsedGallerySection[] | undefined,
): SchemaValidationResult {
  if (publishedSections === undefined) return true;
  const publishedBySectionId = new Map(
    publishedSections.map((section) => [section.sectionId, section]),
  );
  for (const section of document.sections) {
    const published = publishedBySectionId.get(section.sectionId);
    if (published !== undefined && published.slug !== section.slug) {
      return `Section "${section.sectionId}" already has a published slug ("${published.slug}"). A section's slug cannot be renamed once published; declare a new section instead.`;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The Studio entry point
// ---------------------------------------------------------------------------

type RawGalleryQueryResult = {
  readonly published: {
    readonly language?: unknown;
    readonly slug?: unknown;
    readonly canonicalCategoryRef?: unknown;
    readonly sections?: unknown;
  } | null;
  readonly categories: Parameters<typeof parseProspectiveCategories>[0];
  readonly siblings: readonly {
    readonly contentId?: unknown;
    readonly slug?: unknown;
    readonly canonicalCategoryRef?: unknown;
    readonly secondaryCategoryRefs?: unknown;
  }[];
};

function readSiblingPlacement(
  sibling: RawGalleryQueryResult["siblings"][number],
  categoryIdsByDocumentId: ReadonlyMap<string, string>,
): ProspectivePlacement | undefined {
  const contentId = exactString(sibling.contentId);
  const slug = exactString(sibling.slug);
  if (contentId === undefined || slug === undefined) return undefined;

  const resolve = (ref: string) => resolveCategoryId(ref, categoryIdsByDocumentId);
  const canonicalRef =
    typeof sibling.canonicalCategoryRef === "string" ? sibling.canonicalCategoryRef : undefined;
  const secondaryRefs = Array.isArray(sibling.secondaryCategoryRefs)
    ? sibling.secondaryCategoryRefs.filter(
        (ref): ref is string => typeof ref === "string",
      )
    : [];

  return {
    contentId,
    slug,
    canonicalCategoryId: canonicalRef === undefined ? null : resolve(publishedIdOf(canonicalRef)),
    secondaryCategoryIds: secondaryRefs.map((ref) => resolve(publishedIdOf(ref))),
  };
}

/** Document-level Studio validation; errors block the standard Publish action. */
export async function validateGalleryPublication(
  value: Readonly<Record<string, unknown>> | undefined,
  context: SchemaValidationContext,
  galleryType: string,
): Promise<SchemaValidationResult> {
  const document = value ?? context.document;
  if (document === undefined) return true;

  const parsed = parseCurrentGalleryDocument(document);
  if (parsed === undefined) return true;

  const structural = validateSectionStructure(parsed);
  if (structural !== true) return structural;

  const published = publishedIdOf(parsed.documentId);
  const result = await validationClientOf(context, "published").fetch<RawGalleryQueryResult>(
    `{
      "published": *[_id == $published][0]{
        language,
        slug,
        "canonicalCategoryRef": canonicalCategory._ref,
        sections[]{sectionId, slug}
      },
      "categories": ${CATEGORY_VALIDATION_QUERY},
      "siblings": *[
        _type in ["article", "gallery"] &&
        language == $language &&
        contentId != $contentId
      ]{
        contentId,
        slug,
        "canonicalCategoryRef": canonicalCategory._ref,
        "secondaryCategoryRefs": secondaryCategories[]._ref
      }
    }`,
    {
      published,
      type: CATEGORY_TYPE_NAME,
      galleryType,
      language: parsed.language,
      contentId: parsed.contentId,
    },
  );

  const categoryIdsByDocumentId = indexProspectiveCategoryDocumentIds(result.categories);
  const current = resolveProspectiveGalleryFields(parsed, categoryIdsByDocumentId);

  if (result.published !== null) {
    const publishedCanonicalRef =
      typeof result.published.canonicalCategoryRef === "string"
        ? publishedIdOf(result.published.canonicalCategoryRef)
        : null;
    const publishedSnapshot: PublishedPlacementSnapshot = {
      language: exactString(result.published.language) ?? "",
      slug: exactString(result.published.slug) ?? "",
      canonicalCategoryId:
        publishedCanonicalRef === null
          ? null
          : resolveCategoryId(publishedCanonicalRef, categoryIdsByDocumentId),
    };

    if (changesPublishedUrlFields(publishedSnapshot, current)) {
      return "This gallery already owns a published URL. Its language, slug, and canonical category cannot be changed in the ordinary editor because that would lose the impact preview and permanent redirect history required by ADR-0003. Use the project-owned URL-change workflow.";
    }
  }

  const publishedOwnSections =
    result.published === null ? undefined : parseSections(result.published.sections);

  const sectionSlugCheck = validateSectionSlugStability(parsed, publishedOwnSections);
  if (sectionSlugCheck !== true) return sectionSlugCheck;

  const categories = parseProspectiveCategories(result.categories, current.language);
  const siblings = result.siblings.flatMap((sibling) => {
    const placement = readSiblingPlacement(sibling, categoryIdsByDocumentId);
    return placement === undefined ? [] : [placement];
  });

  return validateProspectivePlacement(current, categories, siblings);
}
