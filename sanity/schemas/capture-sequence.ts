/**
 * A photograph's membership in one capture-sequence gallery (ADR-0022 §1).
 *
 * A capture-sequence gallery has no `galleryPlacement` documents: its items are
 * the `media` documents whose `captureSequence.galleryContentId` names it,
 * ordered by the owner's filename `sequence` and filtered by `sectionId`. The
 * field lives on `media.ts`; the ordering-rule value lives on `gallery.ts`.
 * Both import it from here, because `gallery.ts` already imports `media.ts` and
 * the reverse import would be a cycle.
 */

import type {
  SchemaFieldDefinition,
  SchemaValidationContext,
  SchemaValidationResult,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

/** The `gallery.orderingRule` value this field belongs to. */
export const CAPTURE_SEQUENCE_ORDERING_RULE = "capture-sequence";

/**
 * Restates `gallery.ts`'s `GALLERY_TYPE_NAME` and `media.ts`'s
 * `MEDIA_TYPE_NAME` as literals — this module may import neither (see above) —
 * pinned equal by `capture-sequence.test.ts`.
 */
export const CAPTURE_SEQUENCE_GALLERY_TYPE = "gallery";
export const CAPTURE_SEQUENCE_MEDIA_TYPE = "media";

/** Same shape as a gallery's `contentId`. */
const CONTENT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

type CaptureSequenceValue = {
  readonly galleryContentId?: unknown;
  readonly sequence?: unknown;
  readonly sectionId?: unknown;
};

type RawCaptureSequenceQueryResult = {
  readonly galleries: readonly {
    readonly _id: string;
    readonly orderingRule: string | null;
    readonly sections: readonly { readonly sectionId?: string | null }[] | null;
  }[];
  readonly sequenceTaken: boolean;
};

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * One round trip, under the `raw` perspective so drafts count:
 *
 * - every version of the named gallery (both languages, published or draft) is
 *   `capture-sequence` — membership in a manual or seeded gallery would be
 *   silently ignored by the public read, so it is refused here instead;
 * - the section, when given, is declared by every one of those versions, since
 *   FI and EN share section ids (ADR-0022 §4);
 * - no other photograph in the gallery holds the same `sequence`. The public
 *   order would still be total (`mediaId` breaks the tie), but a duplicate
 *   number means two files claimed one position.
 */
export async function validateCaptureSequence(
  value: CaptureSequenceValue | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (value === undefined) return true;

  const galleryContentId = nonEmptyString(value.galleryContentId);
  if (galleryContentId === undefined || !CONTENT_ID.test(galleryContentId)) {
    return "Name the gallery by its content ID: lowercase words separated by hyphens, e.g. rally-finland-2024.";
  }
  const sequence = value.sequence;
  if (typeof sequence !== "number" || !Number.isSafeInteger(sequence) || sequence < 1) {
    return "Sequence is the file name's running number: a whole number from 1 upwards.";
  }
  if (value.sectionId !== undefined && nonEmptyString(value.sectionId) === undefined) {
    return "Leave the section empty or name one the gallery declares.";
  }
  const sectionId = nonEmptyString(value.sectionId);

  const documentId = context.document?._id;
  if (typeof documentId !== "string") return true;
  const published = publishedIdOf(documentId);

  const result = await validationClientOf(context).fetch<RawCaptureSequenceQueryResult>(
    `{
      "galleries": *[_type == $galleryType && contentId == $galleryContentId]{
        _id,
        orderingRule,
        sections[]{sectionId}
      },
      "sequenceTaken": defined(*[
        _type == $mediaType &&
        captureSequence.galleryContentId == $galleryContentId &&
        captureSequence.sequence == $sequence &&
        !sanity::versionOf($published)
      ][0]._id)
    }`,
    {
      galleryType: CAPTURE_SEQUENCE_GALLERY_TYPE,
      mediaType: CAPTURE_SEQUENCE_MEDIA_TYPE,
      galleryContentId,
      sequence,
      published,
    },
  );

  if (result.galleries.length === 0) {
    return `No gallery has the content ID "${galleryContentId}".`;
  }
  if (
    result.galleries.some(
      (gallery) => gallery.orderingRule !== CAPTURE_SEQUENCE_ORDERING_RULE,
    )
  ) {
    return `Gallery "${galleryContentId}" is not ordered by capture sequence. Set its ordering to capture sequence first, or place this photograph in it with a gallery placement instead.`;
  }
  if (sectionId !== undefined) {
    const undeclared = result.galleries.some(
      (gallery) =>
        !(gallery.sections ?? []).some((section) => section?.sectionId === sectionId),
    );
    if (undeclared) {
      return `Gallery "${galleryContentId}" does not declare section "${sectionId}" in every language.`;
    }
  }
  if (result.sequenceTaken) {
    return `Another photograph in "${galleryContentId}" already has sequence ${sequence}. Each running number belongs to one file.`;
  }
  return true;
}

export const captureSequenceField: SchemaFieldDefinition = {
  name: "captureSequence",
  title: "Capture-sequence gallery",
  type: "object",
  description:
    "Only for a gallery ordered by capture sequence (ADR-0022). The photograph appears in that gallery at its file name's running number, in the given section. Leave empty for photographs placed in galleries by hand. The folder importer fills this in.",
  fields: [
    {
      name: "galleryContentId",
      title: "Gallery content ID",
      type: "string",
      description: "The gallery's content ID, shared by its language versions.",
    },
    {
      name: "sequence",
      title: "Sequence",
      type: "number",
      description: "The file name's running number, e.g. 327 for …_0327_SS2_Milzkalne_1.jpg.",
    },
    {
      name: "sectionId",
      title: "Section ID",
      type: "string",
      description: "The gallery section this photograph belongs to, as the gallery declares it.",
    },
  ],
  validation: (rule) => rule.custom(validateCaptureSequence),
};
