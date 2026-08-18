/**
 * Sanity Studio's publication guard for one gallery document: the URL-identity
 * guard every content-page type shares (`content-placement-validation.ts`),
 * plus gallery-only structural checks no other document type needs — a
 * gallery is the only type that owns an embedded placements/sections array.
 *
 * ## Placement identity (ADR-0002 §1)
 *
 * `placementId` is public and site-wide unique, with an immutable media/
 * container binding. This module decides, and enforces, what was left open by
 * the ADR's MVP text: the same occurrence (same photograph, same section) in
 * two language versions of one gallery shares one `placementId` — the
 * translation-companion relationship `contentId` already gives the page
 * itself — while a `placementId` reused by a *different* `contentId`, or
 * rebound to a different `mediaId`/`sectionId` under the same `contentId`, is
 * rejected as a collision or an illegal rebind. Once this exact document
 * (`contentId` + `language`) has itself been published, an existing
 * placement's `mediaId` may not change on a later edit either — replacing the
 * media must mint a new `placementId` (ADR-0002 §1: "replacing the media ...
 * creates a new placement").
 *
 * ## Section checks
 *
 * Restates `gallery-sections.ts`'s already-exported Studio-facing backstops:
 * `sectionId`/`slug` uniqueness, the reserved `all` slug, every placement's
 * `sectionId` resolving to a declared section, and published-section-slug
 * immutability (that module's own `assertGallerySectionsSlugStable` doc
 * comment already names this file as its caller).
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

type RawGalleryPlacement = {
  readonly placementId?: unknown;
  readonly media?: { readonly _ref?: unknown };
  readonly sectionId?: unknown;
};

type RawGallerySection = {
  readonly sectionId?: unknown;
  readonly slug?: unknown;
};

export type ParsedGalleryPlacement = {
  readonly placementId: string;
  readonly mediaId: string;
  readonly sectionId?: string;
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
  readonly placements: readonly ParsedGalleryPlacement[];
  readonly sections: readonly ParsedGallerySection[];
};

function parsePlacements(raw: unknown): readonly ParsedGalleryPlacement[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    const item = entry as RawGalleryPlacement;
    const placementId = exactString(item.placementId);
    const mediaId = typeof item.media?._ref === "string" ? item.media._ref : undefined;
    if (placementId === undefined || mediaId === undefined) return [];
    const sectionId = exactString(item.sectionId);
    return [{ placementId, mediaId, ...(sectionId === undefined ? {} : { sectionId }) }];
  });
}

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
    placements: parsePlacements(document.placements),
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

  for (const placement of document.placements) {
    if (placement.sectionId !== undefined && !ids.has(placement.sectionId)) {
      return `Placement "${placement.placementId}" references an unknown gallery section: ${placement.sectionId}`;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Placement identity (ADR-0002 §1): local uniqueness, site-wide uniqueness,
// cross-language reuse, and immutability against this document's own
// previously-published version.
// ---------------------------------------------------------------------------

export type PlacementOwner = {
  readonly contentId: string;
  readonly placements: readonly ParsedGalleryPlacement[];
};

export function validateGalleryPlacementIdentity(
  document: ParsedGalleryDocument,
  otherOwners: readonly PlacementOwner[],
  publishedOwnPlacements: readonly ParsedGalleryPlacement[] | undefined,
): SchemaValidationResult {
  const seenLocally = new Set<string>();
  for (const placement of document.placements) {
    if (seenLocally.has(placement.placementId)) {
      return `Duplicate placement id in this gallery: ${placement.placementId}`;
    }
    seenLocally.add(placement.placementId);
  }

  const publishedByPlacementId = new Map(
    (publishedOwnPlacements ?? []).map((placement) => [placement.placementId, placement]),
  );

  for (const placement of document.placements) {
    for (const owner of otherOwners) {
      const match = owner.placements.find(
        (candidate) => candidate.placementId === placement.placementId,
      );
      if (match === undefined) continue;

      if (owner.contentId !== document.contentId) {
        return `Placement id "${placement.placementId}" is already used by a different gallery (content id "${owner.contentId}"). Placement ids are unique site-wide (ADR-0002 §1).`;
      }

      // Same contentId, a different document: a sibling language version of
      // this same gallery. Allowed only when it names the same photograph and
      // section — otherwise it is an illegal rebind under a shared identity.
      if (match.mediaId !== placement.mediaId || match.sectionId !== placement.sectionId) {
        return `Placement "${placement.placementId}" already names a different photograph or section in another language version of this gallery. Use a new placement id, or make them match.`;
      }
    }

    const published = publishedByPlacementId.get(placement.placementId);
    if (published !== undefined && published.mediaId !== placement.mediaId) {
      return `Placement "${placement.placementId}" was already published against a different photograph. Replacing the media requires a new placement id (ADR-0002 §1).`;
    }
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
    readonly placements?: unknown;
    readonly sections?: unknown;
  } | null;
  readonly categories: Parameters<typeof parseProspectiveCategories>[0];
  readonly siblings: readonly {
    readonly contentId?: unknown;
    readonly slug?: unknown;
    readonly canonicalCategoryRef?: unknown;
    readonly secondaryCategoryRefs?: unknown;
  }[];
  readonly placementOwners: readonly {
    readonly contentId?: unknown;
    readonly placements?: unknown;
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
        placements[]{placementId, "mediaId": media._ref, sectionId},
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
      },
      "placementOwners": *[
        _type == $galleryType &&
        !sanity::versionOf($published)
      ]{
        contentId,
        placements[]{placementId, "mediaId": media._ref, sectionId}
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

  const publishedOwnPlacements =
    result.published === null ? undefined : parsePlacements(result.published.placements);
  const publishedOwnSections =
    result.published === null ? undefined : parseSections(result.published.sections);

  const sectionSlugCheck = validateSectionSlugStability(parsed, publishedOwnSections);
  if (sectionSlugCheck !== true) return sectionSlugCheck;

  const otherOwners: readonly PlacementOwner[] = result.placementOwners.flatMap((owner) => {
    const contentId = exactString(owner.contentId);
    if (contentId === undefined) return [];
    return [{ contentId, placements: parsePlacements(owner.placements) }];
  });

  const placementCheck = validateGalleryPlacementIdentity(
    parsed,
    otherOwners,
    publishedOwnPlacements,
  );
  if (placementCheck !== true) return placementCheck;

  const categories = parseProspectiveCategories(result.categories, current.language);
  const siblings = result.siblings.flatMap((sibling) => {
    const placement = readSiblingPlacement(sibling, categoryIdsByDocumentId);
    return placement === undefined ? [] : [placement];
  });

  return validateProspectivePlacement(current, categories, siblings);
}
