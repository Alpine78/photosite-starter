/** The optional, intro-free article-end catalog accepted in ADR-0036. */
import { MAX_GALLERY_SECTIONS, assertGallerySections, type GallerySectionSummary } from "@/lib/gallery-sections";

export const MAX_ARTICLE_END_SECTION_HEADING_LENGTH = 160;
const SECTION_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type ArticleEndGalleryCatalogFields = {
  readonly endGallerySections?: readonly GallerySectionSummary[];
  readonly endGallerySectionHeading?: string;
};

/** Keep payloads bounded even when a writer bypasses Studio validation. */
export const ARTICLE_END_CATALOG_PROJECTION = `
  "endGallerySections": select(
    !defined(endGallerySections) => null,
    defined(count(endGallerySections)) => endGallerySections[0...21]{sectionId, slug, label},
    {"invalid": true}
  ),
  endGallerySectionHeading`;

export function projectArticleEndGalleryCatalog(
  raw: unknown,
  heading: unknown,
  endGalleryId: unknown,
): ArticleEndGalleryCatalogFields {
  if (raw != null && !Array.isArray(raw)) {
    throw new TypeError("Invalid article-end section catalog");
  }
  const entries: readonly unknown[] = raw ?? [];
  if (entries.length > MAX_GALLERY_SECTIONS) throw new TypeError("Too many article-end sections");
  if (entries.length === 0) {
    if (heading != null) throw new TypeError("A section heading requires a catalog");
    return {};
  }
  if (typeof endGalleryId !== "string" || endGalleryId.length === 0 ||
      typeof heading !== "string" || heading.trim().length === 0 ||
      heading.length > MAX_ARTICLE_END_SECTION_HEADING_LENGTH) {
    throw new TypeError("An article-end catalog requires its gallery and bounded heading");
  }
  const sections = entries.map((entry, order): GallerySectionSummary => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new TypeError("Invalid article-end section entry");
    }
    const row = entry as Record<string, unknown>;
    if (typeof row.sectionId !== "string" || !SECTION_ID.test(row.sectionId) || typeof row.slug !== "string" ||
        typeof row.label !== "string" || row.label.trim().length === 0) throw new TypeError("Invalid article-end section entry");
    return { sectionId: row.sectionId, slug: row.slug, label: row.label, order };
  });
  assertGallerySections(sections);
  return { endGallerySections: sections, endGallerySectionHeading: heading };
}
