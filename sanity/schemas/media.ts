/**
 * The shared media document: one photograph, once, wherever it appears.
 *
 * ADR-0002 split four things that a single field used to carry — which
 * photograph this is, where it sits in a container, how the CMS refers to the
 * asset, and where the master lives. This document is the first of those and
 * only that. A curated gallery placing it, an article illustrating with it, and
 * a later dynamic result finding it all reference this document; none of them
 * copies its alternative text, credit, or dimensions.
 *
 * ## The Studio is where these rules have to hold
 *
 * The site's adapter refuses a photograph it cannot publish safely, but a
 * refusal at read time is late for two of these rules. An asset is on a public
 * CDN the moment it is uploaded, and a duplicate identity is already breaking
 * references by the time a page asks for one. So the checks that matter run
 * here, asynchronously, against the dataset:
 *
 * - the uploaded image is measured and its format checked, so a camera master
 *   cannot be published;
 * - `mediaId` is checked for uniqueness across the dataset and for having not
 *   changed since the document was last published.
 *
 * Neither can undo an upload — see the asset cleanup note in
 * `docs/sanity-setup.md`. They stop the publish, which is what keeps the bytes
 * out of a page and out of a public cache key.
 *
 * ## What is deliberately not here
 *
 * **Placement fields.** Manual order, gallery section membership, a
 * placement-level caption override, and the placement identity itself belong to
 * the container that places the photograph, not to the photograph (ADR-0002 §3).
 * AB#113 adds them to the gallery document. Putting an `order` on a media
 * document would mean a photograph could only ever sit in one gallery.
 *
 * **Publication state.** ADR-0002 named it as a media-owned axis before the CMS
 * was chosen; Sanity answers it natively. A document is editorially finished
 * when an editor publishes it, and `sanity-client.ts` asks only for the
 * published perspective — so an unfinished photograph never reaches the site at
 * all. A second `publicationState` field would mean two switches for one
 * question, and the invisible failure is the one where the document is
 * published but the field still says draft.
 *
 * **Dimensions.** Read from the uploaded bytes by Sanity, never typed in. The
 * no-crop rule needs the true intrinsic ratio, and a hand-entered number is a
 * ratio that can be wrong.
 *
 * **`dynamicallyDiscoverable`, `privateOnly`, `canonicalPlacementId`, and
 * keywords.** Named by ADR-0002 and added by the stories that build their
 * features — AB#58, AB#122, AB#113, AB#68 — so this schema does not ship fields
 * nothing reads. Each is media-owned when it arrives, which is what keeps a
 * later reference from needing a second media entity.
 *
 * **`indexable`.** Route-owned, not media-owned. The same photograph may appear
 * on an indexed page and an unlisted one, so it is a property of the public
 * route (ADR-0002 §4).
 */

import { LOCALIZED_TEXT_TYPE_NAME, uniqueLanguages } from "./localized-text";
import type {
  SchemaTypeDefinition,
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";
import { publishedIdOf, validationClientOf } from "./validation";

export const MEDIA_TYPE_NAME = "media";

/**
 * How this Studio's dataset can be read.
 *
 * Stated by whoever wires the Studio, because it decides whether a field may
 * exist at all. A **public** dataset is world-readable: anyone holding the
 * project id can query every published document in it, so nothing private may
 * be stored there, and the archive-location field is not offered. A **private**
 * dataset restricts document reads to a credential — which is what makes
 * recording a master's location defensible (ADR-0002 §1).
 *
 * Neither setting makes an *asset* secret. Uploaded files are served from a
 * public CDN URL in both cases, which is why the image field below refuses
 * anything that is not an exported web copy.
 */
export type DatasetVisibility = "public" | "private";

export type MediaSchemaOptions = {
  readonly datasetVisibility: DatasetVisibility;
};

/**
 * Longest edge a public web derivative may have.
 *
 * Restated from `src/lib/image-delivery.ts`, which owns it: these schemas are
 * exported to a Studio that does not have this repository's application code on
 * its import path. A test pins the two numbers together.
 */
export const MAX_PUBLIC_DELIVERY_DIMENSION = 2048;

/** Web delivery formats, and the media type each must declare. */
export const PUBLIC_DELIVERY_FORMATS: Readonly<Record<string, string>> = {
  avif: "image/avif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/**
 * API version for the queries these validation rules run.
 *
 * A Studio's own pin, unrelated to the site's `SANITY_API_VERSION`: it fixes
 * the Content Lake behavior the *validation* was written against, and the two
 * move independently.
 *
 * Exported so another document's identity check — `category.ts`'s
 * `categoryId` is the first — pins the same verified behavior rather than a
 * second, independently drifting date.
 */
/**
 * `mediaId` is minted by hand and never derived from a filename, an asset id,
 * or a content hash — all three change when a photograph is re-exported, which
 * is precisely when its identity has to hold (ADR-0002 §1).
 */
const MEDIA_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The id a document has when published, whatever version is being edited.
 *
 * A Studio edits one logical document under several ids: `abc` published,
 * `drafts.abc` while unpublished, and `versions.<release>.abc` inside a content
 * release. All three are the same photograph, so a uniqueness check has to
 * compare on this rather than on `_id`, or a document would collide with
 * itself the moment anyone edited or scheduled it.
 */
/**
 * The client a validation rule asks its questions with.
 *
 * `raw` is chosen deliberately. A client's default perspective is `published`,
 * so a uniqueness check made with one would see only published documents — and
 * the collision that matters most is two *unpublished* drafts quietly claiming
 * one identity, which would then both be published and break every reference at
 * once. A non-published perspective also requires the uncached client, so both
 * are stated together.
 *
 * Exported for reuse by another document's own identity check: the reasoning
 * is about Studio validation in general, not about photographs.
 */
/**
 * Syntax, uniqueness, and immutability, in one round trip.
 *
 * Uniqueness is site-wide rather than per document type, because `mediaId` is
 * the identity a gallery placement, an enquiry, and a later sale all reference:
 * two documents answering to one is an ambiguity no reader can resolve. The
 * draft and published versions of the *same* document are excluded, or a
 * document would collide with itself the moment it was edited.
 *
 * Immutability is checked against what was last published. Editing the
 * identifier of a draft that has never been published is a correction; editing
 * it afterwards silently breaks every reference already pointing at it.
 */
async function validateMediaIdentity(
  value: string | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (value === undefined || !MEDIA_ID.test(value)) {
    return "Use lowercase letters, digits, and single hyphens, e.g. coastal-landscape";
  }

  const documentId = context.document?._id;
  if (typeof documentId !== "string") return true;

  const published = publishedIdOf(documentId);
  const { taken, publishedMediaId } = await validationClientOf(context).fetch<{
    taken: boolean;
    publishedMediaId: string | null;
  }>(
    `{
      "taken": defined(*[
        _type == $type &&
        mediaId == $mediaId &&
        !sanity::versionOf($published)
      ][0]._id),
      "publishedMediaId": *[_id == $published][0].mediaId
    }`,
    { type: MEDIA_TYPE_NAME, mediaId: value, published },
  );

  if (taken) {
    return `Another media document already uses "${value}", published or not. A media ID identifies one photograph across the whole site.`;
  }

  if (publishedMediaId !== null && publishedMediaId !== value) {
    return `This photograph was published as "${publishedMediaId}". Changing a media ID breaks every reference already pointing at it — create a new document instead.`;
  }

  return true;
}

type UploadedAsset = {
  readonly width: number | null;
  readonly height: number | null;
  readonly extension: string | null;
  readonly mimeType: string | null;
};

/**
 * Refuses to publish anything but an exported web copy.
 *
 * The measurements live on the asset document rather than in the field being
 * edited, so this rule reads them. That is the whole reason it is asynchronous:
 * a synchronous rule can see that *an* image was chosen and nothing about what
 * it is.
 *
 * What it cannot do is un-upload. By the time this runs, the file is already
 * addressable on the asset CDN; blocking the publish keeps it out of the site
 * and out of a page's cache, and removing the bytes is a separate, deliberate
 * deletion (`docs/sanity-setup.md`).
 */
async function validatePublicDerivative(
  value: { readonly asset?: { readonly _ref?: unknown } } | undefined,
  context: SchemaValidationContext,
): Promise<SchemaValidationResult> {
  if (context.document?.mediaType !== "image") return true;

  const reference = value?.asset?._ref;
  if (typeof reference !== "string") return "An image media needs an uploaded image";

  const asset = await validationClientOf(context).fetch<UploadedAsset | null>(
    `*[_id == $id][0]{
      "width": metadata.dimensions.width,
      "height": metadata.dimensions.height,
      extension,
      mimeType
    }`,
    { id: reference },
  );

  if (asset === null) {
    return "The uploaded image could not be read. Try uploading it again.";
  }

  const { width, height, extension, mimeType } = asset;
  if (typeof width !== "number" || typeof height !== "number") {
    return "The uploaded file has no measurable image dimensions, so it is not a web image";
  }

  if (
    extension === null ||
    PUBLIC_DELIVERY_FORMATS[extension] === undefined ||
    PUBLIC_DELIVERY_FORMATS[extension] !== mimeType
  ) {
    return `Upload a web image — ${Object.keys(PUBLIC_DELIVERY_FORMATS).join(", ")} — rather than a camera or print format`;
  }

  if (Math.max(width, height) > MAX_PUBLIC_DELIVERY_DIMENSION) {
    return `This file is ${width}×${height}. Upload an exported copy no larger than ${MAX_PUBLIC_DELIVERY_DIMENSION}px on its longest edge — a camera master must not be published. Delete the uploaded file from the media browser as well.`;
  }

  return true;
}

/**
 * Longest an archive locator may be. It is a folder path, a catalogue
 * reference, or a drive label — never a document — so a generous single-line
 * ceiling both keeps an accidental paste bounded and lets the AB#60 enquiry
 * resolver treat anything past it as a malformed value rather than trusted
 * data on its way into a photographer-facing email. Restated as
 * `MAX_ARCHIVE_LOCATOR_LENGTH` in `src/lib/sanity-enquiry-media.ts` and pinned
 * equal by a test, the same way the placement-id bound is.
 */
export const MAX_ARCHIVE_LOCATOR_LENGTH = 512;

const archiveLocatorField = {
  name: "archiveLocator",
  title: "Archive location",
  type: "string",
  description:
    "Where your master file lives — a folder path, a catalogue reference, a drive label. The website never reads it into a page. It is stored in this dataset, which is private, so it is readable only with a credential.",
  validation: (rule: SchemaValidationRule) => rule.max(MAX_ARCHIVE_LOCATOR_LENGTH),
} as const;

/**
 * Builds the media document type for one Studio.
 *
 * A factory rather than a constant because one field's *existence* depends on
 * the dataset: the archive location is offered only when documents are not
 * world-readable. A public dataset therefore cannot be given a place to put a
 * master's location by accident, which is a stronger guarantee than a warning
 * an editor is free to read past.
 */
export function defineMediaType(
  options: MediaSchemaOptions,
): SchemaTypeDefinition {
  return {
    name: MEDIA_TYPE_NAME,
    title: "Media",
    type: "document",
    description:
      "One photograph or video, described once and reused wherever it appears.",
    fields: [
      {
        name: "mediaId",
        title: "Media ID",
        type: "string",
        description:
          "Stable identity for this photograph: lowercase words separated by hyphens, e.g. coastal-landscape. Mint it once and never change it — re-exporting, re-uploading, or moving to another CDN must leave it alone, because links and enquiries may already point at it.",
        validation: (rule) => rule.required().custom(validateMediaIdentity),
      },
      {
        name: "mediaType",
        title: "Kind",
        type: "string",
        description:
          "Video is part of the model so nothing here assumes photographs, but the site does not deliver video yet: a published video will be refused rather than shown.",
        initialValue: "image",
        options: {
          list: [
            { title: "Image", value: "image" },
            { title: "Video", value: "video" },
          ],
          layout: "radio",
        },
        validation: (rule) => rule.required(),
      },
      {
        name: "image",
        title: "Public web image",
        type: "image",
        description: `An exported delivery copy, at most ${MAX_PUBLIC_DELIVERY_DIMENSION} pixels on its longest edge, as ${Object.keys(PUBLIC_DELIVERY_FORMATS).join(", ")}. Never the camera master: this file is served from a public URL the moment it is uploaded.`,
        options: {
          // No hotspot, no crop UI. A cropped preview misrepresents the work.
          hotspot: false,
          // Sanity keeps the uploaded file's own name by default and warns that
          // filenames carry sensitive information. A working title or a
          // client's name on an asset document is readable by anyone in a
          // public dataset, whether or not this site ever projects it.
          storeOriginalFilename: false,
          // A first guardrail in the file picker. The rule below is the
          // control; this only keeps an editor from picking a raw file and
          // waiting for a validation message to explain why.
          accept: [...new Set(Object.values(PUBLIC_DELIVERY_FORMATS))].join(","),
        },
        validation: (rule) => rule.custom(validatePublicDerivative),
      },
      {
        name: "alt",
        title: "Alternative text",
        type: "array",
        of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
        description:
          "What the photograph shows, for a visitor who cannot see it. Always author the site's own language: every other language falls back to it, because an image described in the wrong language is still better than one not described at all. A photograph described in neither the language being viewed nor the site's own is refused rather than shown undescribed.",
        validation: (rule) => uniqueLanguages(rule.required().min(1)),
      },
      {
        name: "caption",
        title: "Caption",
        type: "array",
        of: [{ type: LOCALIZED_TEXT_TYPE_NAME }],
        description:
          "Optional words shown with the image. Unlike alternative text, a language with no entry shows no caption rather than one written in another language.",
        validation: uniqueLanguages,
      },
      {
        name: "credit",
        title: "Credit",
        type: "string",
        description:
          "Attribution line, when one is owed. Language-neutral — usually a name, so it is not translated.",
      },
      {
        name: "capturedAt",
        title: "Captured",
        type: "datetime",
        description:
          "When the photograph was taken. The only ordering input the photograph itself owns; a curated gallery's order is authored on the gallery. Photographs with no capture date sort last.",
      },
      {
        name: "publiclyRenderable",
        title: "May be shown publicly",
        type: "boolean",
        description:
          "Turn this off to keep a published photograph out of every public page without unpublishing the document. Off also wins over anything that places it: a gallery can hide a photograph, never reveal a hidden one.",
        initialValue: true,
      },
      {
        name: "enquiryEligible",
        title: "May receive enquiries",
        type: "boolean",
        description:
          "Turn this on to let a visitor start an enquiry about buying or licensing this photograph from a gallery. Off by default and never assumed from publication — an image can be public without being for sale.",
        initialValue: false,
      },
      ...(options.datasetVisibility === "private" ? [archiveLocatorField] : []),
    ],
    preview: {
      select: { title: "mediaId", subtitle: "credit", media: "image" },
    },
  };
}
