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
 * later reference from needing a second media entity. `archiveLocator` is the
 * exception: it is here because AB#82 owns proving that a server-only field
 * cannot cross the public boundary, and a field that does not exist cannot be
 * proven stripped.
 *
 * **`indexable`.** Route-owned, not media-owned. The same photograph may appear
 * on an indexed page and an unlisted one, so it is a property of the public
 * route (ADR-0002 §4).
 */

import {
  LOCALIZED_TEXT_TYPE_NAME,
  uniqueLanguages,
} from "./localized-text";
import type { SchemaTypeDefinition } from "./schema-types";

export const MEDIA_TYPE_NAME = "media";

/**
 * `mediaId` is minted by hand and never derived from a filename, an asset id,
 * or a content hash — all three change when a photograph is re-exported, which
 * is precisely when its identity has to hold (ADR-0002 §1).
 */
const MEDIA_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const mediaType: SchemaTypeDefinition = {
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
        "Stable identity for this photograph: lowercase words separated by hyphens, e.g. coastal-landscape. Mint it once and never change it — re-exporting, re-uploading, or moving to another CDN must leave it alone, because links and enquiries may already point at it. It must be unique: if two published documents claim one identity the site refuses to serve either, because it cannot tell which photograph was meant.",
      validation: (rule) =>
        rule.required().custom<string>((value) =>
          value !== undefined && MEDIA_ID.test(value)
            ? true
            : "Use lowercase letters, digits, and single hyphens, e.g. coastal-landscape",
        ),
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
      description:
        "An exported delivery copy, at most 2048 pixels on its longest edge, as JPEG, PNG, WebP, or AVIF. Never the camera master: this file is served from a public URL. The site checks these limits when it reads the photograph and refuses to show one that breaks them, so an oversized or camera-format upload becomes a failed page rather than a published original.",
      // No hotspot, no crop UI. A cropped preview misrepresents the work.
      options: { hotspot: false },
      validation: (rule) =>
        rule.custom<{ readonly asset?: unknown }>((value, context) =>
          context.document?.mediaType !== "image" || value?.asset !== undefined
            ? true
            : "An image media needs an uploaded image",
        ),
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
      name: "archiveLocator",
      title: "Archive location",
      type: "string",
      description:
        "Where your master file lives — a folder path, a catalogue reference, a drive label. The website never reads this into a page. It is stored in your content dataset, so keep the dataset private if these locations are sensitive.",
    },
  ],
  preview: {
    select: { title: "mediaId", subtitle: "credit", media: "image" },
  },
};
