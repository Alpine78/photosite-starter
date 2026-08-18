/**
 * One curated gallery placement, as its own document.
 *
 * AB#113 originally modeled a gallery's placements as one array field embedded
 * on the `gallery` document itself. AB#114 found that shape incompatible with
 * its own first acceptance criterion — Sanity's Content Lake filters and
 * projects whole documents (no sub-document indexing of an array field), a
 * single document is capped at 5MB and 1,000 attributes on the Free/Growth
 * plan (verified against Sanity's own technical-limits documentation), and a
 * roughly 400-placement gallery at ~7 fields each already approaches that
 * ceiling — so a bounded, keyset-paginated read of a large gallery's
 * placements is only possible if each placement is its own document, the same
 * pattern `content-listing.ts` already uses for articles under one category.
 * This file is that correction: `placements` no longer exists on `gallery.ts`,
 * and this document carries exactly the fields that array's object members
 * used to.
 *
 * ## What stays the same
 *
 * `placementId`'s site-wide uniqueness, immutable media/container binding,
 * and cross-language-sibling-rebind rules (ADR-0002 §1) are unchanged in
 * substance — `validateGalleryPlacementPublication` below is the document-
 * per-placement restatement of what `gallery-validation.ts`'s
 * `validateGalleryPlacementIdentity` checked against an embedded array.
 * `sectionId` still resolves against the *gallery's* declared `sections`
 * (still embedded there — a gallery has at most `MAX_GALLERY_SECTIONS` (20),
 * never the pagination bottleneck). Repeating a photograph within one gallery
 * is still allowed with a non-blocking warning (ADR-0002 §2). Unlike the old
 * embedded array — where a placement's `sectionId` was checked against
 * `context.document`'s own live, possibly-unpublished `sections` — a
 * placement is now a separate document from its gallery, so validating it
 * means fetching the gallery's *current* state across that reference. That
 * lookup prefers the gallery's own unpublished draft over its published copy
 * (see `validateGalleryPlacementPublication`'s query), so a section added in
 * the same still-unpublished editing session as a placement referencing it is
 * already visible — an exact `_id == $galleryRef` lookup would only ever see
 * the published copy, since a draft lives under a different literal `_id`.
 *
 * ## What is new
 *
 * `order` is now an authored field rather than array position — splitting
 * placements into documents has no array for a position to be. This is a
 * real authoring-experience cost (no more "drag to reorder"; an author enters
 * a number) traded for the bounded-query property AB#114 needs. `gallery`
 * points at one specific language's `gallery` document (matching that
 * document's existing one-per-language model, ADR-0008): the same photograph
 * placed in two languages of one gallery is two `galleryPlacement` documents
 * sharing one `placementId`, exactly mirroring how the embedded array used to
 * duplicate per language document.
 */

import { GALLERY_TYPE_NAME } from "./gallery";
import { MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaFieldDefinition,
  SchemaTypeDefinition,
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

export const GALLERY_PLACEMENT_TYPE_NAME = "galleryPlacement";

/** Same shape as `gallery.ts`'s (removed) embedded placement id field. */
const PLACEMENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function exactString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readRefField(
  document: Readonly<Record<string, unknown>>,
  field: string,
): string | undefined {
  const value = document[field];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const ref = (value as { readonly _ref?: unknown })._ref;
  return typeof ref === "string" ? ref : undefined;
}

// ---------------------------------------------------------------------------
// placementId: syntax, site-wide uniqueness, cross-language rebind, and
// immutable media/gallery binding once published — one round trip.
// ---------------------------------------------------------------------------

type RawPublicationQueryResult = {
  readonly published: {
    readonly galleryRef: string | null;
    readonly mediaRef: string | null;
  } | null;
  readonly conflicting: readonly {
    readonly _id: string;
    readonly mediaRef: string | null;
    readonly sectionId: string | null;
    readonly galleryContentId: string | null;
  }[];
  readonly galleryVersions: readonly {
    readonly _id: string;
    readonly contentId: string | null;
    readonly sections: readonly { readonly sectionId?: string | null }[] | null;
  }[];
};

/**
 * Field-level validator on `placementId` itself, mirroring `media.ts`'s
 * `validateMediaIdentity`: `value` is the field's own string, and everything
 * else this needs — `_id`, `gallery`, `media`, `sectionId` — comes from
 * `context.document`, the whole document being edited.
 */
async function validateGalleryPlacementPublication(
  value: string | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (value === undefined || !PLACEMENT_ID.test(value)) {
    return "Use lowercase letters, digits, and single hyphens, e.g. northern-coast-2026-01";
  }
  const placementId = value;

  const document = context.document;
  if (document === undefined) return true;

  const documentId = exactString(document._id);
  if (documentId === undefined) return true;

  const galleryRef = readRefField(document, "gallery");
  const mediaRef = readRefField(document, "media");
  // Same reasoning: `gallery`/`media` report their own `required()` failures.
  if (galleryRef === undefined || mediaRef === undefined) return true;

  const sectionId = exactString(document.sectionId);
  const published = publishedIdOf(documentId);
  const publishedGalleryRef = publishedIdOf(galleryRef);
  const draftGalleryRef = `drafts.${publishedGalleryRef}`;

  const result = await validationClientOf(context).fetch<RawPublicationQueryResult>(
    `{
      "published": *[_id == $published][0]{
        "galleryRef": gallery._ref,
        "mediaRef": media._ref
      },
      "conflicting": *[
        _type == $type &&
        placementId == $placementId &&
        !sanity::versionOf($published)
      ]{
        _id,
        "mediaRef": media._ref,
        sectionId,
        "galleryContentId": gallery->contentId
      },
      "galleryVersions": *[_id in [$galleryRef, $draftGalleryRef]]{
        _id,
        contentId,
        sections[]{sectionId}
      }
    }`,
    {
      type: GALLERY_PLACEMENT_TYPE_NAME,
      placementId,
      published,
      galleryRef: publishedGalleryRef,
      draftGalleryRef,
    },
  );

  // Prefers the gallery's own current draft over its published copy, so a
  // section added in the same, still-unpublished editing session as this
  // placement is already visible here — matching how a broad, unfiltered
  // query (e.g. `content-placement-validation.ts`'s category read) already
  // sees every draft under the raw perspective this client uses. A single
  // `_id == $galleryRef` lookup would not: the draft lives under a different
  // literal `_id` (`drafts.<id>`) and an exact-id filter does not fall back
  // to it.
  const gallery =
    result.galleryVersions.find((version) => version._id === draftGalleryRef) ??
    result.galleryVersions.find((version) => version._id === publishedGalleryRef);

  if (gallery === undefined) {
    return "This placement's gallery reference does not resolve to a gallery document.";
  }

  const declaredSections = (gallery.sections ?? []).flatMap((section) => {
    const id = exactString(section?.sectionId ?? undefined);
    return id === undefined ? [] : [id];
  });
  if (sectionId !== undefined && !declaredSections.includes(sectionId)) {
    return `This placement references a section ("${sectionId}") that gallery does not declare.`;
  }

  const ownGalleryContentId = exactString(gallery.contentId ?? undefined);
  for (const conflict of result.conflicting) {
    if (conflict._id === documentId) continue;

    const conflictGalleryContentId = exactString(conflict.galleryContentId ?? undefined);
    const sameLogicalGallery =
      ownGalleryContentId !== undefined &&
      conflictGalleryContentId === ownGalleryContentId;

    if (!sameLogicalGallery) {
      return `Placement id "${placementId}" is already used by a different gallery. Placement ids are unique site-wide (ADR-0002 §1).`;
    }

    // Same contentId, a different document: a sibling language version of
    // this same gallery. Allowed only when it names the same photograph and
    // section — otherwise it is an illegal rebind under a shared identity.
    const conflictMediaRef = exactString(conflict.mediaRef ?? undefined);
    const conflictSectionId = exactString(conflict.sectionId ?? undefined);
    if (conflictMediaRef !== mediaRef || conflictSectionId !== sectionId) {
      return `Placement "${placementId}" already names a different photograph or section in another language version of this gallery. Use a new placement id, or make them match.`;
    }
  }

  if (result.published !== null) {
    if (result.published.mediaRef !== null && result.published.mediaRef !== mediaRef) {
      return `Placement "${placementId}" was already published against a different photograph. Replacing the media requires a new placement id (ADR-0002 §1).`;
    }
    if (
      result.published.galleryRef !== null &&
      result.published.galleryRef !== publishedGalleryRef
    ) {
      return `Placement "${placementId}" was already published under a different gallery. Moving a placement requires a new placement id (ADR-0002 §1).`;
    }
  }

  return true;
}

// ---------------------------------------------------------------------------
// Repeated media within one gallery: allowed, but flagged (ADR-0002 §2) —
// non-blocking, so kept separate from the blocking checks above.
// ---------------------------------------------------------------------------

type RawSiblingQueryResult = {
  readonly siblings: readonly { readonly _id: string; readonly mediaRef: string | null }[];
};

async function warnsAboutRepeatedMediaInGallery(
  value: { readonly _ref?: unknown } | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  const document = context.document;
  if (document === undefined) return true;

  const documentId = exactString(document._id);
  const mediaRef = typeof value?._ref === "string" ? value._ref : undefined;
  const galleryRef = readRefField(document, "gallery");
  if (documentId === undefined || mediaRef === undefined || galleryRef === undefined) {
    return true;
  }

  const published = publishedIdOf(documentId);
  const result = await validationClientOf(context).fetch<RawSiblingQueryResult>(
    `{
      "siblings": *[
        _type == $type &&
        gallery._ref == $galleryRef &&
        !sanity::versionOf($published)
      ]{ _id, "mediaRef": media._ref }
    }`,
    { type: GALLERY_PLACEMENT_TYPE_NAME, galleryRef, published },
  );

  const repeated = result.siblings.some(
    (sibling) => sibling._id !== documentId && sibling.mediaRef === mediaRef,
  );

  return repeated
    ? "This gallery already places this photograph elsewhere. Allowed (ADR-0002 §2), but confirm it is intentional — an accidental repeat is otherwise easy to miss in a large gallery."
    : true;
}

// ---------------------------------------------------------------------------
// order: authored, not positional (see module comment). Non-negative
// integer, checked locally — no query needed.
// ---------------------------------------------------------------------------

function isNonNegativeInteger(value: number | undefined): SchemaValidationResult {
  return value !== undefined && Number.isInteger(value) && value >= 0
    ? true
    : "Enter a whole number, 0 or greater";
}

const fields: readonly SchemaFieldDefinition[] = [
  {
    name: "gallery",
    title: "Gallery",
    type: "reference",
    to: [{ type: GALLERY_TYPE_NAME }],
    description: "The one language version of the gallery this placement belongs to.",
    validation: (rule) => rule.required(),
  },
  {
    name: "placementId",
    title: "Placement ID",
    type: "string",
    description:
      "Site-wide unique occurrence identity (ADR-0002 §1). Replacing the media or moving this placement to another gallery requires a new placement id.",
    validation: (rule) => rule.required().custom(validateGalleryPlacementPublication),
  },
  {
    name: "order",
    title: "Order",
    type: "number",
    description:
      "This placement's position in the gallery's manual order. Two placements sharing a number sort by placement id, which is rarely what you want — give each a distinct value.",
    validation: (rule) => rule.required().custom<number>(isNonNegativeInteger),
  },
  {
    name: "sectionId",
    title: "Section",
    type: "string",
    description:
      "This gallery's own section id, if any (AB#105). Validated against the sections declared on the gallery.",
  },
  {
    name: "visible",
    title: "Visible",
    type: "boolean",
    description:
      "This placement's own visibility. Can only subtract from a publicly renderable photograph's visibility, never add to it (ADR-0002 §3).",
    initialValue: true,
    validation: (rule) => rule.required(),
  },
  {
    name: "pinned",
    title: "Pinned lead",
    type: "boolean",
    description:
      "Keeps this placement first when a seeded-random ordering rule is active (ADR-0009). Not yet consumed by any ordering logic.",
    initialValue: false,
  },
  {
    name: "media",
    title: "Media",
    type: "reference",
    to: [{ type: MEDIA_TYPE_NAME }],
    validation: (rule) => rule.required().warning(warnsAboutRepeatedMediaInGallery),
  },
  {
    name: "altOverride",
    title: "Alt text override",
    type: "string",
    description:
      "Optional, exceptional context override. May be left empty when this occurrence is decorative or redundant here.",
  },
  {
    name: "captionOverride",
    title: "Caption override",
    type: "string",
    description: "Optional. Falls back to the photograph's own caption.",
  },
];

export const galleryPlacementType: SchemaTypeDefinition = {
  name: GALLERY_PLACEMENT_TYPE_NAME,
  title: "Gallery placement",
  type: "document",
  description:
    "One occurrence of one photograph in one gallery, in one language (AB#114). Position in the gallery's grid is this document's own order field, not array position.",
  fields,
  preview: {
    select: { title: "placementId", subtitle: "sectionId", media: "media" },
  },
};
