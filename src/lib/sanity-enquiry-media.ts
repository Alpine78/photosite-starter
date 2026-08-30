/**
 * The Sanity content source's answer to "resolve this public enquiry
 * reference" (AB#60).
 *
 * `import "server-only"`: this module reads and returns `archiveLocator`, the
 * master-file locator ADR-0002 §1 keeps off every public surface. It is
 * reached only through `enquiry-media.ts`, which has already validated the
 * request shape and — for a curated request — authorized the container against
 * the public content tree. What is left here is a store read: find the
 * placement inside that gallery, read the media it points at, and compose the
 * photographer-facing facts an enquiry needs.
 *
 * ## Two round trips, both explicitly projected
 *
 * A `galleryPlacement` is one document per language (AB#114), and sibling
 * language versions may legitimately share one `placementId`. So the placement
 * cannot be looked up by `placementId` alone — that query would pick a language
 * nondeterministically. It is scoped instead by `gallery._ref`, the id of the
 * `gallery` document for this exact language, which the first query resolves.
 *
 * Neither query uses a GROQ spread. The projections name the handful of fields
 * this resolver consumes and nothing else, so a field added to the media or
 * placement schema later does not start arriving here (ADR-0002 §6). The media
 * projection is deliberately separate from `sanity-media.ts`'s public one —
 * that one must never mention `archiveLocator` or `enquiryEligible`, and a
 * shared projection could not keep both properties.
 *
 * ## Dynamic is refused, not half-authorized
 *
 * A dynamic result (`itemId === mediaId`, no placement) has no gallery or query
 * context in a Sanity deployment yet: AB#58 builds the dynamic query and AB#68
 * exposes `dynamicallyDiscoverable` in the model. Until both exist, a dynamic
 * enquiry against this source is refused (`dynamic-unsupported`) rather than
 * authorized on the two flags that do exist. AB#60 stays open for the wiring.
 *
 * ## Failure is loud
 *
 * The content tree already said this gallery is a supported public route, so a
 * gallery document that then cannot be found, two documents that answer to one
 * identity, a placement row that is not a record, or an `archiveLocator` that
 * is not a bounded non-empty string are all `malformed-source` — the store and
 * the tree disagree, or the store returned something this resolver cannot
 * trust. Only a placement that genuinely is not there is `unknown-item`.
 */

import "server-only";

import {
  assertEnquiryEligible,
  EnquiryResolutionError,
  type EnquiryTargetRequest,
  type ResolvedEnquiryTarget,
} from "@/lib/enquiry-media";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
import {
  isRecord,
  readString,
  selectLocalizedText,
  toLanguageSubtag,
} from "@/lib/sanity-values";

/**
 * Document type names, declared here rather than imported from `sanity/schemas`:
 * the Studio schema is content-store configuration, not application code
 * (ADR-0006). Tests pin these to the schema's own names.
 */
export const GALLERY_DOCUMENT_TYPE = "gallery";
export const GALLERY_PLACEMENT_DOCUMENT_TYPE = "galleryPlacement";
export const MEDIA_DOCUMENT_TYPE = "media";

/**
 * Longest an archive locator this resolver will trust. Declared independently
 * of the Studio schema's own `MAX_ARCHIVE_LOCATOR_LENGTH` — the schema is
 * content-store configuration a clone's Studio consumes and nothing under
 * `src/` imports it — and pinned equal to it by a test, the same way
 * `MAX_ITEM_ID_LENGTH` is pinned to the schema's placement-id bound.
 */
export const MAX_ARCHIVE_LOCATOR_LENGTH = 512;

/** The identity form the schemas enforce, enforced again at this boundary. */
const PUBLIC_IDENTITY = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * The media fields an enquiry needs. Separate from `PUBLIC_MEDIA_PROJECTION`
 * on purpose — this one carries `archiveLocator` and `enquiryEligible`, which
 * the public projection must never mention.
 *
 * `privateOnly` is read even though no schema defines it yet (AB#122): ADR-0002
 * §4 makes it a hard exclusion that is *never inferred from another flag*, so an
 * import or a future schema that sets it must fail closed here rather than be
 * accepted because `publiclyRenderable` and `enquiryEligible` happen to be true.
 */
export const ENQUIRY_MEDIA_PROJECTION = `{
  mediaId,
  publiclyRenderable,
  enquiryEligible,
  privateOnly,
  archiveLocator,
  credit,
  caption[]{language, value}
}`;

const GALLERY_ID_QUERY = `*[_type == "${GALLERY_DOCUMENT_TYPE}" && contentId == $contentId && language == $language][0...2]{ _id }`;

const PLACEMENT_QUERY = `*[_type == "${GALLERY_PLACEMENT_DOCUMENT_TYPE}" && gallery._ref == $galleryId && placementId == $itemId][0...2]{
  placementId,
  visible,
  sectionId,
  captionOverride,
  "media": media->${ENQUIRY_MEDIA_PROJECTION}
}`;

type RawEnquiryMedia = {
  readonly mediaId?: unknown;
  readonly publiclyRenderable?: unknown;
  readonly enquiryEligible?: unknown;
  readonly privateOnly?: unknown;
  readonly archiveLocator?: unknown;
  readonly credit?: unknown;
  readonly caption?: unknown;
};

type RawEnquiryPlacement = {
  readonly placementId?: unknown;
  readonly visible?: unknown;
  readonly sectionId?: unknown;
  readonly captionOverride?: unknown;
  readonly media?: unknown;
};

export type SanityEnquiryReadOptions = {
  /** Injected in tests; production resolves the deployment's own client. */
  readonly client?: SanityClient;
};

function readRows(result: unknown): readonly unknown[] {
  if (!Array.isArray(result)) {
    throw new EnquiryResolutionError("malformed-source");
  }
  return result;
}

/**
 * An archive locator is optional, but a value that is present must be a bounded
 * non-empty string — it is on its way into a photographer-facing email, so a
 * number, a blank, or a pasted document is a defect, not "no locator".
 */
function readArchiveLocator(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > MAX_ARCHIVE_LOCATOR_LENGTH
  ) {
    throw new EnquiryResolutionError("malformed-source");
  }
  return value;
}

async function resolveGalleryDocumentId(
  client: SanityClient,
  contentId: string,
  language: string,
): Promise<string> {
  const rows = readRows(
    await client.query({
      query: GALLERY_ID_QUERY,
      params: { contentId, language },
      tag: "enquiry.gallery",
    }),
  );

  // The tree already authorized this container, so zero rows or an ambiguous
  // result is the store contradicting the tree, not a 404.
  if (rows.length !== 1 || !isRecord(rows[0])) {
    throw new EnquiryResolutionError("malformed-source");
  }
  const id = readString(rows[0]._id);
  if (id === undefined) {
    throw new EnquiryResolutionError("malformed-source");
  }
  return id;
}

function projectEnquiryMedia(raw: unknown): {
  mediaId: string;
  archiveLocator?: string;
  credit?: string;
  captionEntries: unknown;
} {
  if (!isRecord(raw)) {
    throw new EnquiryResolutionError("malformed-source");
  }
  const media = raw as RawEnquiryMedia;

  const mediaId = readString(media.mediaId);
  if (mediaId === undefined || !PUBLIC_IDENTITY.test(mediaId)) {
    throw new EnquiryResolutionError("malformed-source");
  }

  // Only a curated enquiry reaches this projection — a dynamic one is refused
  // before any query — so the dynamic-discoverability conjunct never applies here.
  assertEnquiryEligible(
    {
      publiclyRenderable: media.publiclyRenderable === true,
      enquiryEligible: media.enquiryEligible === true,
      privateOnly: media.privateOnly === true,
    },
    "curated",
  );

  const archiveLocator = readArchiveLocator(media.archiveLocator);
  const credit = readString(media.credit);

  return {
    mediaId,
    ...(archiveLocator === undefined ? {} : { archiveLocator }),
    ...(credit === undefined ? {} : { credit }),
    captionEntries: media.caption,
  };
}

export async function resolveSanityEnquiryTarget(
  request: EnquiryTargetRequest,
  language: string,
  options: SanityEnquiryReadOptions = {},
): Promise<ResolvedEnquiryTarget> {
  if (request.kind === "dynamic") {
    // No query: a Sanity deployment cannot yet authorize a dynamic enquiry
    // (AB#58 result context, AB#68 `dynamicallyDiscoverable`).
    throw new EnquiryResolutionError("dynamic-unsupported");
  }

  const client = options.client ?? getSanityClient();
  const subtag = toLanguageSubtag(language);

  const galleryId = await resolveGalleryDocumentId(
    client,
    request.contentId,
    subtag,
  );

  const rows = readRows(
    await client.query({
      query: PLACEMENT_QUERY,
      params: { galleryId, itemId: request.itemId },
      tag: "enquiry.placement",
    }),
  );

  if (rows.length === 0) {
    throw new EnquiryResolutionError("unknown-item");
  }
  if (rows.length > 1 || !isRecord(rows[0])) {
    throw new EnquiryResolutionError("malformed-source");
  }

  const placement = rows[0] as RawEnquiryPlacement;
  const placementId = readString(placement.placementId);
  if (placementId === undefined || placementId !== request.itemId) {
    throw new EnquiryResolutionError("malformed-source");
  }
  if (placement.visible !== true) {
    throw new EnquiryResolutionError("container-unavailable");
  }

  const media = projectEnquiryMedia(placement.media);
  const sectionId = readString(placement.sectionId);
  const caption =
    readString(placement.captionOverride) ??
    selectLocalizedText(media.captionEntries, subtag);

  return {
    kind: "curated",
    mediaId: media.mediaId,
    placementId,
    contentId: request.contentId,
    ...(sectionId === undefined ? {} : { sectionId }),
    ...(media.archiveLocator === undefined
      ? {}
      : { archiveLocator: media.archiveLocator }),
    ...(caption === undefined ? {} : { caption }),
    ...(media.credit === undefined ? {} : { credit: media.credit }),
  };
}
