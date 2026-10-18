/** Studio guards, not a transaction or authorization boundary (ADR-0036). */
import { MAX_GALLERY_SECTIONS, MAX_SECTION_ID_LENGTH, MAX_SECTION_SLUG_LENGTH,
  MAX_SECTION_LABEL_LENGTH, sectionsField } from "./gallery";
import type { SchemaFieldDefinition, SchemaValidationContext, SchemaValidationResult } from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

export const MAX_ARTICLE_END_SECTION_HEADING_LENGTH = 160;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INVALID = "The article-end section data is invalid. Check the catalog, heading, and gallery ID.";
const UNAVAILABLE = "The published section consistency check could not be completed. Retry before publishing.";
type Row = Readonly<Record<string, unknown>>;
type Section = { readonly sectionId: string; readonly slug: string; readonly label: string; readonly _key: string };
const record = (x: unknown): x is Row => typeof x === "object" && x !== null && !Array.isArray(x);
const text = (x: unknown): x is string => typeof x === "string" && x.length > 0;
const witness = (x: unknown) => x === null || (record(x) && text(x._id));

/** Exported so a future checked batch can reuse the same structural rules. */
export function readArticleEndSectionCatalog(document: Row): readonly Section[] {
  const raw = document.endGallerySections;
  if (raw != null && !Array.isArray(raw)) throw new TypeError(INVALID);
  const rows: readonly unknown[] = raw ?? [];
  if (rows.length > MAX_GALLERY_SECTIONS) throw new TypeError(INVALID);
  const heading = document.endGallerySectionHeading;
  if (rows.length === 0) {
    if (heading != null) throw new TypeError(INVALID);
    return [];
  }
  if (!text(document.endGalleryId) || !text(heading) || !heading.trim() ||
      heading.length > MAX_ARTICLE_END_SECTION_HEADING_LENGTH) throw new TypeError(INVALID);
  const ids = new Set<string>(), slugs = new Set<string>(), keys = new Set<string>();
  return rows.map((row) => {
    if (!record(row) || !text(row._key) || keys.has(row._key) ||
        !text(row.sectionId) || !ID.test(row.sectionId) || row.sectionId.length > MAX_SECTION_ID_LENGTH || ids.has(row.sectionId) ||
        !text(row.slug) || !ID.test(row.slug) || row.slug.length > MAX_SECTION_SLUG_LENGTH || row.slug === "all" || slugs.has(row.slug) ||
        !text(row.label) || !row.label.trim() || row.label.length > MAX_SECTION_LABEL_LENGTH || row.intro != null || row.hasUnsupportedIntro === true) {
      throw new TypeError(INVALID);
    }
    keys.add(row._key); ids.add(row.sectionId); slugs.add(row.slug);
    return { _key: row._key, sectionId: row.sectionId, slug: row.slug, label: row.label };
  });
}

export const articleEndGallerySectionsField: SchemaFieldDefinition = {
  ...sectionsField,
  name: "endGallerySections",
  title: "End-gallery sections",
  description: "Optional ordered sections of the end gallery. Publish the catalog before assigning placements; coordinate shared multilingual changes in a checked batch.",
  of: [{ type: "object", fields: sectionsField.of?.[0]?.fields?.filter((field) =>
    ["sectionId", "slug", "label"].includes(field.name)) }],
};

// A declared non-array is a conflict, never the no-catalog locale exemption.
const PEER_CATALOG_CONFLICT = `*[_type == "article" && $hasCatalog && contentId == $contentId && endGalleryId == $endGalleryId && _id != $article && defined(endGallerySections) && coalesce(count(endGallerySections), -1) != 0 && !coalesce(
    count(endGallerySections) == $sectionCount && count(array::unique(endGallerySections[].sectionId)) == $sectionCount && count(endGallerySections[!(sectionId in $sectionIds)]) == 0,
    false
  )][0]{_id}`;

export const ARTICLE_END_SECTION_VALIDATION_QUERY = `{
  "published": *[_id == $published][0]{
    endGalleryId, endGallerySectionHeading,
    "endGallerySections": select(
      !defined(endGallerySections) => null,
      defined(count(endGallerySections)) => endGallerySections[0...21]{_key, sectionId, slug, label, "hasUnsupportedIntro": defined(intro)},
      {"invalid": true}
    )
  },
  "dangling": *[_type == "articleEndGalleryPlacement" && article._ref == $published && defined(sectionId) && !(sectionId in $sectionIds)][0]{_id},
  "catalogConflict": ${PEER_CATALOG_CONFLICT},
  "membershipConflict": *[_type == "articleEndGalleryPlacement" && $hasCatalog && article._ref == $published && defined(*[
    _type == "articleEndGalleryPlacement" && placementId == ^.placementId && article._ref != $published && article->contentId == $contentId && article->endGalleryId == $endGalleryId && count(article->endGallerySections) > 0 && coalesce(sectionId, "") != coalesce(^.sectionId, "")
  ][0]._id)][0]{_id}
}`;

/** Prospective article + bounded published witnesses. Includes hidden placements. */
export async function validateArticleEndSections(
  document: Row | undefined, context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (!document) return true;
  let sections: readonly Section[];
  try { sections = readArticleEndSectionCatalog(document); } catch { return INVALID; }
  if (!text(document._id) || !text(document.contentId)) return true;
  try {
    const result = await validationClientOf(context, "published").fetch<unknown>(ARTICLE_END_SECTION_VALIDATION_QUERY, {
      published: publishedIdOf(document._id), article: publishedIdOf(document._id), contentId: document.contentId,
      endGalleryId: document.endGalleryId ?? "", hasCatalog: sections.length > 0,
      sectionIds: sections.map((section) => section.sectionId), sectionCount: sections.length,
    });
    if (!record(result) || !["dangling", "catalogConflict", "membershipConflict"].every((key) => witness(result[key])) ||
        !(result.published === null || record(result.published))) return UNAVAILABLE;
    if (result.published !== null) {
      const previous = readArticleEndSectionCatalog(result.published);
      for (const old of previous) {
        const keyed = sections.find((section) => section._key === old._key);
        const sameId = sections.find((section) => section.sectionId === old.sectionId);
        const sameSlug = sections.find((section) => section.slug === old.slug);
        if ((keyed && keyed.sectionId !== old.sectionId) || (sameId && sameId.slug !== old.slug) ||
            (sameSlug && sameSlug.sectionId !== old.sectionId)) {
          return "Published section IDs and path segments cannot be changed in place. Create a new section instead.";
        }
      }
    }
    if (result.dangling !== null) return "Clear or reassign every referencing placement before removing a section, including hidden placements.";
    if (result.catalogConflict !== null) return "Catalogued language versions must declare the same section IDs. Use a checked batch for coordinated changes.";
    if (result.membershipConflict !== null) return "Shared placements must have matching sections in catalogued language versions. Use a checked batch for adoption.";
    return true;
  } catch { return UNAVAILABLE; }
}

export const ARTICLE_END_MEMBERSHIP_VALIDATION_QUERY = `{
  "article": *[_type == "article" && _id == $article][0]{
    contentId, endGalleryId, endGallerySectionHeading,
    "endGallerySections": select(
      !defined(endGallerySections) => null,
      defined(count(endGallerySections)) => endGallerySections[0...21]{_key, sectionId, slug, label, "hasUnsupportedIntro": defined(intro)},
      {"invalid": true}
    )
  },
  "conflict": *[_type == "articleEndGalleryPlacement" && !sanity::versionOf($published) && placementId == $placementId && article._ref != $article && article->contentId == $contentId && article->endGalleryId == $endGalleryId && count(article->endGallerySections) > 0 && coalesce(sectionId, "") != $sectionId][0]{_id},
  "catalogConflict": ${PEER_CATALOG_CONFLICT}
}`;

/** A draft-only catalog cannot authorize publication of a classified placement. */
export async function validateArticleEndMembership(
  document: Row | undefined, context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (!document) return true;
  const sectionId = document.sectionId;
  if (sectionId != null && (!text(sectionId) || !ID.test(sectionId) || sectionId.length > MAX_SECTION_ID_LENGTH)) return INVALID;
  const article = record(document.article) ? document.article._ref : undefined;
  if (!text(article) || !text(document._id) || !text(document.placementId)) return true;
  try {
    const client = validationClientOf(context, "published");
    // Resolve the exact reference first; placements carry no duplicated language.
    const own = await client.fetch<unknown>(`*[_type == "article" && _id == $article][0]{contentId, endGalleryId, endGallerySectionHeading,
      "endGallerySections": select(!defined(endGallerySections) => null, defined(count(endGallerySections)) => endGallerySections[0...21]{_key, sectionId, slug, label, "hasUnsupportedIntro": defined(intro)}, {"invalid": true})}`, { article: publishedIdOf(article) });
    if (!record(own) || !text(own.contentId) || !text(own.endGalleryId)) return "The containing article and its catalog must be published before assigning a section.";
    const sections = readArticleEndSectionCatalog(own);
    if (sectionId != null && !sections.some((section) => section.sectionId === sectionId)) return "Select a section declared by the published containing article.";
    if (sections.length === 0) return true; // No-catalog locales remain unassigned and exempt.
    const result = await client.fetch<unknown>(ARTICLE_END_MEMBERSHIP_VALIDATION_QUERY, {
      article: publishedIdOf(article), published: publishedIdOf(document._id),
      placementId: document.placementId, contentId: own.contentId,
      endGalleryId: own.endGalleryId, sectionId: sectionId ?? "",
      hasCatalog: true, sectionIds: sections.map((section) => section.sectionId), sectionCount: sections.length,
    });
    if (!record(result) || !record(result.article) || !witness(result.conflict) || !witness(result.catalogConflict) ||
        result.article.contentId !== own.contentId || result.article.endGalleryId !== own.endGalleryId) return UNAVAILABLE;
    const currentSections = readArticleEndSectionCatalog(result.article);
    if (currentSections.length === 0 || (sectionId != null && !currentSections.some((section) => section.sectionId === sectionId))) return UNAVAILABLE;
    if (result.catalogConflict !== null) return "Catalogued language versions must declare the same section IDs. Use a checked batch for coordinated changes.";
    return result.conflict === null ? true : "Shared placements must have matching sections in catalogued language versions.";
  } catch { return UNAVAILABLE; }
}
