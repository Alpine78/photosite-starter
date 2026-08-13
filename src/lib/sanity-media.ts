/**
 * The public media adapter: one Sanity document in, one validated public
 * photograph out.
 *
 * This is the boundary ADR-0005 §5 asked for. Everything a provider knows about
 * an asset — its document id, its type, its reference objects, the archive
 * location the photographer recorded beside it — stops here. What leaves is the
 * project's own `ImageMedia`, built property by property by
 * `projectPublicImageMedia`, which is the same validator the fixture layer
 * passes through. A route that later renders a Sanity photograph and one that
 * renders a mock photograph therefore receive values of the same shape,
 * validated by the same code, and neither can tell which store it came from.
 *
 * Nothing here fetches a whole document. The projection below is an allow-list:
 * the query asks for the fields it is going to use and no others, so a field
 * added to the schema tomorrow does not silently start arriving in a browser
 * payload today. There is no spread — `...` in a GROQ projection is exactly the
 * "return the record and hope the type annotation removes something" mistake
 * that ADR-0002 §6 forbids, and a type annotation removes nothing at runtime.
 *
 * ## What makes an asset publishable
 *
 * Sanity serves every uploaded asset from a public URL. So "is this file
 * allowed to be on the open web" cannot be answered by the CMS; it is answered
 * here, mechanically, before the URL can reach a page:
 *
 * - the URL is this deployment's own project and dataset on the asset CDN,
 * - the asset is a web delivery format, and its declared MIME type agrees,
 * - the dimensions in the URL agree with the dimensions Sanity measured,
 * - the longest edge is within `MAX_PUBLIC_DELIVERY_DIMENSION`, which a camera
 *   master is not.
 *
 * The check runs when the site reads the document, not when an editor saves it:
 * a Studio rule cannot see an asset's dimensions, which live on the asset
 * document rather than in the field being edited. So a master upload can be
 * published and is then refused here, with a message naming the limit — the
 * page fails rather than the CDN serving a 6000-pixel original. That is the
 * property worth having: bytes delivered publicly cannot be made secret again.
 *
 * ## Failure is loud
 *
 * A document that cannot be projected raises. It is never partially trusted,
 * never replaced with a placeholder, and never quietly dropped from a result
 * somebody is counting (ADR-0005 §4). The three interesting cases — a video, a
 * master-sized upload, a photograph with no alternative text — are content
 * defects an editor can fix, and they are much cheaper to see at publish time
 * than to discover in a visitor's browser.
 */

import "server-only";

import { getDeploymentConfig } from "@/lib/deployment-config";
import { MAX_PUBLIC_DELIVERY_DIMENSION } from "@/lib/image-delivery";
import { projectPublicImageMedia, type ImageMedia } from "@/lib/media";
import { getSanityClient, type SanityClient } from "@/lib/sanity-client";
import {
  buildSanityImagePathPrefix,
  getSanityConfig,
  SANITY_ASSET_CDN_HOST,
  type SanityConfig,
} from "@/lib/sanity-config";

/**
 * The document type this adapter reads. Declared here rather than imported from
 * `sanity/schemas`: the Studio schema is content-store configuration, not
 * application code, and the application does not depend on the directory a
 * clone's Studio happens to consume. A test pins the two names together.
 */
export const MEDIA_DOCUMENT_TYPE = "media";

/**
 * Fields the query reads. The list exists as data so a test can check it
 * against the schema — a projection asking for a field nobody declared returns
 * `null` forever and looks like missing content.
 */
export const PROJECTED_MEDIA_FIELDS = [
  "mediaId",
  "mediaType",
  "publiclyRenderable",
  "alt",
  "caption",
  "credit",
  "image",
] as const;

/** Fields the query sorts by. Read, never projected — see `PUBLIC_MEDIA_ORDER`. */
export const ORDERED_MEDIA_FIELDS = ["capturedAt", "mediaId"] as const;

/**
 * Effective public renderability, as a GROQ predicate.
 *
 * Two conditions, and Sanity supplies the third: `sanity-client.ts` asks only
 * for the published perspective, so an unpublished document is not merely
 * filtered out, it is not in the data the query runs against. ADR-0002 §4 keeps
 * these as separate decisions rather than one `published` boolean, and this is
 * the single place they are combined — `isPubliclyRenderable` below applies the
 * same rule to a document already in hand.
 *
 * `publiclyRenderable` is compared to `true` rather than tested for truthiness,
 * so a document created before the field existed is excluded rather than
 * assumed public.
 */
export const PUBLIC_MEDIA_FILTER = `_type == "${MEDIA_DOCUMENT_TYPE}" && publiclyRenderable == true`;

/**
 * The order any public media listing uses, and the reasoning it rests on.
 *
 * - **Null behavior.** GROQ places nulls first in a descending sort, which
 *   would open every listing with the photographs nobody dated.
 *   `coalesce(capturedAt, "")` turns the absent date into a value that sorts
 *   below every real one, so undated work sorts last.
 * - **Timezone.** A Studio `datetime` is an ISO-8601 instant in UTC, so the
 *   comparison is between two Z-normalized strings and reads as chronological.
 *   Two instants that differ only in sub-second precision are the one case
 *   string comparison cannot separate reliably, which the tie-break below makes
 *   harmless rather than arbitrary.
 * - **Fallback.** `mediaId` is required, so appending it makes the order total
 *   as long as it is also unique: two photographs captured in the same second,
 *   or neither dated, still come back in the same sequence on every request. A
 *   listing whose order is not total is a listing that can duplicate and skip
 *   items across page boundaries, which is what AB#114 inherits this clause to
 *   avoid. Uniqueness is an editorial rule the Studio cannot check on its own —
 *   a synchronous validation rule sees one document — so it is enforced where a
 *   violation would do damage: `readPublicMediaById` refuses an identity two
 *   documents claim rather than silently answering with one of them.
 */
export const PUBLIC_MEDIA_ORDER = `order(coalesce(capturedAt, "") desc, mediaId asc)`;

/**
 * The allow-listed projection.
 *
 * Exported because the gallery and article adapters embed it in their own
 * queries rather than restating the field list. One projection means one place
 * where a photograph's public shape is decided, and an item that arrives inside
 * a gallery page carries exactly the fields an item read on its own would.
 *
 * `image.asset->` dereferences the asset document; `metadata.dimensions` is
 * what Sanity measured from the uploaded bytes, which is why this adapter never
 * accepts hand-entered dimensions.
 */
export const PUBLIC_MEDIA_PROJECTION = `{
  mediaId,
  mediaType,
  publiclyRenderable,
  alt[]{language, value},
  caption[]{language, value},
  credit,
  "asset": image.asset->{
    url,
    sha1hash,
    extension,
    mimeType,
    "width": metadata.dimensions.width,
    "height": metadata.dimensions.height
  }
}`;

/** Web delivery formats, and the MIME type each must declare. */
const PUBLIC_DELIVERY_FORMATS: Readonly<Record<string, string>> = {
  avif: "image/avif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Why a document could not become a public photograph. */
export type SanityMediaRejection =
  /** Required identity, kind, or alternative text is missing or unusable. */
  | "incomplete-document"
  /** The document is a kind this site does not deliver — today, video. */
  | "undeliverable-media-type"
  /** Publication, renderability, or both refuse it. */
  | "not-public"
  /** The asset is missing, foreign, oversized, or not a web delivery copy. */
  | "unpublishable-asset"
  /** Two published documents claim one `mediaId`. */
  | "ambiguous-media-id";

/**
 * Raised instead of returning something half-trusted.
 *
 * The message names the `mediaId` when there is one, because that identity is
 * minted by this project and describes no visitor and no provider internal —
 * it is exactly what an editor needs in order to find the document and fix it.
 */
export class SanityMediaError extends Error {
  readonly rejection: SanityMediaRejection;
  readonly mediaId: string | undefined;

  constructor(
    rejection: SanityMediaRejection,
    detail: string,
    mediaId?: string,
  ) {
    super(
      `[sanity-media] ${detail}${mediaId === undefined ? "" : ` (mediaId "${mediaId}")`}`,
    );
    this.name = "SanityMediaError";
    this.rejection = rejection;
    this.mediaId = mediaId;
  }
}

type RawLocalizedText = {
  readonly language?: unknown;
  readonly value?: unknown;
};

type RawAsset = {
  readonly url?: unknown;
  readonly sha1hash?: unknown;
  readonly extension?: unknown;
  readonly mimeType?: unknown;
  readonly width?: unknown;
  readonly height?: unknown;
};

/**
 * One document as the projection above returns it. Every field is `unknown`:
 * this is data that arrived over the network, and typing it as what it should
 * be is a promise the network never made.
 */
export type RawPublicMediaDocument = {
  readonly mediaId?: unknown;
  readonly mediaType?: unknown;
  readonly publiclyRenderable?: unknown;
  readonly alt?: unknown;
  readonly caption?: unknown;
  readonly credit?: unknown;
  readonly asset?: unknown;
};

export type PublicMediaLanguage = {
  /** Language subtag the page is rendered in, e.g. `fi`. */
  readonly language: string;
  /**
   * The deployment's own language, used when a photograph has no text in the
   * requested one. Alternative text falls back to it; a caption does not.
   */
  readonly fallbackLanguage: string;
};

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * The photograph's words in one language.
 *
 * An entry whose text is blank counts as absent rather than as an authored
 * empty string: at the media level the text is required, and a placement that
 * genuinely wants no alternative text says so on the placement (ADR-0002 §3).
 */
function selectLocalizedText(
  entries: unknown,
  language: string,
): string | undefined {
  if (!Array.isArray(entries)) return undefined;

  for (const entry of entries as readonly RawLocalizedText[]) {
    if (isRecord(entry) && entry.language === language) {
      return readString(entry.value);
    }
  }

  return undefined;
}

/**
 * Effective public renderability for a document already in hand.
 *
 * The same rule `PUBLIC_MEDIA_FILTER` applies in the query, applied again after
 * the fetch. Not redundancy for its own sake: this projection is embedded in
 * other adapters' queries, and one of them will eventually join media through a
 * reference whose filter someone forgot to repeat. Fail closed there rather
 * than publish something the photographer switched off.
 */
export function isPubliclyRenderable(
  document: RawPublicMediaDocument,
): boolean {
  return document.publiclyRenderable === true;
}

/**
 * Turns the asset Sanity measured into a validated public rendition source.
 *
 * The URL is checked against the shape Sanity documents rather than trusted for
 * being an HTTPS string: this value ends up in a browser and in an optimizer
 * allow-list, so "it came from the CMS" is not evidence about what it points
 * at. The asset id in the path is the content hash of the bytes, which is what
 * makes the URL byte-versioned — re-export a photograph and both the hash and
 * the URL change, while `mediaId` does not (ADR-0002 §1).
 */
function selectPublicRendition(
  asset: RawAsset,
  config: SanityConfig,
  mediaId: string,
): {
  readonly src: string;
  readonly version: string;
  readonly width: number;
  readonly height: number;
} {
  // Annotated on the variable, not just the arrow, so TypeScript treats each
  // call as terminating control flow and the checks below need no casts.
  const reject: (detail: string) => never = (detail) => {
    throw new SanityMediaError("unpublishable-asset", detail, mediaId);
  };

  const url = readString(asset.url);
  const sha1hash = readString(asset.sha1hash);
  if (url === undefined || sha1hash === undefined) {
    reject("the asset has no delivery URL or no content hash");
  }

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    reject("the asset delivery URL is not a URL");
  }

  const prefix = buildSanityImagePathPrefix(config);
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname !== SANITY_ASSET_CDN_HOST ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.search !== "" ||
    parsed.hash !== "" ||
    !parsed.pathname.startsWith(prefix)
  ) {
    reject(
      `the asset is not served from this deployment's own images at https://${SANITY_ASSET_CDN_HOST}${prefix}`,
    );
  }

  // `<assetId>-<width>x<height>.<extension>`, the layout Sanity's asset URLs
  // are documented to have. Parsed rather than assumed, so the dimensions the
  // browser is told to reserve can be checked against the ones Sanity measured,
  // and so the content hash in the path can be checked against the asset's own.
  const filename = parsed.pathname.slice(prefix.length);
  const match = /^([a-f0-9]{40})-(\d+)x(\d+)\.([a-z0-9]+)$/.exec(filename);
  if (match === null) {
    reject("the asset delivery URL is not a content-addressed image path");
  }

  const [, assetId, urlWidth, urlHeight, extension] = match;
  if (assetId !== sha1hash) {
    reject("the asset delivery URL does not match the asset's content hash");
  }

  const expectedMimeType = PUBLIC_DELIVERY_FORMATS[extension];
  if (
    expectedMimeType === undefined ||
    readString(asset.extension) !== extension ||
    readString(asset.mimeType) !== expectedMimeType
  ) {
    reject(
      `the asset is not a web delivery image: expected one of ${Object.keys(PUBLIC_DELIVERY_FORMATS).join(", ")} with a matching media type`,
    );
  }

  const { width, height } = asset;
  if (
    typeof width !== "number" ||
    typeof height !== "number" ||
    width !== Number(urlWidth) ||
    height !== Number(urlHeight)
  ) {
    reject(
      "the dimensions measured from the asset disagree with the ones in its delivery URL",
    );
  }

  if (Math.max(width, height) > MAX_PUBLIC_DELIVERY_DIMENSION) {
    reject(
      `the asset is ${width}\u00d7${height}, past the ${MAX_PUBLIC_DELIVERY_DIMENSION}px public delivery limit. Upload an exported web copy, not a master.`,
    );
  }

  return { src: url, version: sha1hash, width, height };
}

/**
 * Projects one document into the public contract, in one language.
 *
 * Pure: the caller supplies the languages and the connection settings, so this
 * is testable without an environment and reusable from any adapter that
 * embedded `PUBLIC_MEDIA_PROJECTION` in its own query.
 */
export function projectPublicMedia(
  document: RawPublicMediaDocument,
  options: PublicMediaLanguage & { readonly config: SanityConfig },
): ImageMedia {
  const mediaId = readString(document.mediaId);
  if (mediaId === undefined) {
    throw new SanityMediaError(
      "incomplete-document",
      "a media document has no mediaId, so nothing can reference it",
    );
  }

  if (document.mediaType === "video") {
    throw new SanityMediaError(
      "undeliverable-media-type",
      "this site does not deliver video yet, so a video media cannot be published",
      mediaId,
    );
  }

  if (document.mediaType !== "image") {
    throw new SanityMediaError(
      "incomplete-document",
      "the media kind is missing or unrecognized",
      mediaId,
    );
  }

  if (!isPubliclyRenderable(document)) {
    throw new SanityMediaError(
      "not-public",
      "the photograph is not marked as publicly renderable",
      mediaId,
    );
  }

  // Alternative text falls back to the deployment's own language, because an
  // image announced in the wrong language is still usable and an image with no
  // announcement at all is not. A caption does not fall back: it is editorial
  // prose, and publishing it under a page written in another language is the
  // same mistake the page description already refuses to make.
  const alt =
    selectLocalizedText(document.alt, options.language) ??
    selectLocalizedText(document.alt, options.fallbackLanguage);
  if (alt === undefined) {
    throw new SanityMediaError(
      "incomplete-document",
      `the photograph has no alternative text in "${options.language}" or "${options.fallbackLanguage}"`,
      mediaId,
    );
  }

  if (!isRecord(document.asset)) {
    throw new SanityMediaError(
      "unpublishable-asset",
      "the photograph has no uploaded image",
      mediaId,
    );
  }

  const rendition = selectPublicRendition(document.asset, options.config, mediaId);
  const caption = selectLocalizedText(document.caption, options.language);
  const credit = readString(document.credit);

  return projectPublicImageMedia({
    mediaId,
    publiclyRenderable: true,
    rendition: { ...rendition, sourceKind: "public-web-derivative" },
    alt,
    ...(caption === undefined ? {} : { caption }),
    ...(credit === undefined ? {} : { credit }),
  });
}

/**
 * The deployment's own language subtag — the one alternative text falls back
 * to. Taken from the locale that owns the unprefixed routes, so it is the
 * language the site is authored in rather than a constant written down twice.
 */
function getFallbackLanguage(): string {
  const { defaultLocale } = getDeploymentConfig().localeRoutes;
  return new Intl.Locale(defaultLocale).language;
}

/** How many documents one listing may return. */
export const MAX_PUBLIC_MEDIA_PAGE_SIZE = 100;

export type PublicMediaReadOptions = {
  readonly language: string;
  /** Injected in tests; production resolves the deployment's own client. */
  readonly client?: SanityClient;
  readonly config?: SanityConfig;
};

function resolveRead(options: PublicMediaReadOptions): {
  client: SanityClient;
  config: SanityConfig;
  languages: PublicMediaLanguage;
} {
  return {
    client: options.client ?? getSanityClient(),
    config: options.config ?? getSanityConfig(),
    languages: {
      language: options.language,
      fallbackLanguage: getFallbackLanguage(),
    },
  };
}

/**
 * One photograph by its stable identity, or `undefined` when this deployment
 * publishes none under that id.
 *
 * Reads two documents where it needs one. A second row can only mean two
 * published documents claim the same `mediaId`, which breaks the assumption
 * every later feature rests on — an enquiry, a canonical link, a dynamic
 * result's deduplication — so it is reported rather than resolved by taking
 * whichever came first.
 */
export async function readPublicMediaById(
  mediaId: string,
  options: PublicMediaReadOptions,
): Promise<ImageMedia | undefined> {
  const { client, config, languages } = resolveRead(options);

  const result = await client.query({
    query: `*[${PUBLIC_MEDIA_FILTER} && mediaId == $mediaId][0...2]${PUBLIC_MEDIA_PROJECTION}`,
    params: { mediaId },
    tag: "media.detail",
  });

  if (!Array.isArray(result) || result.length === 0) return undefined;
  if (result.length > 1) {
    throw new SanityMediaError(
      "ambiguous-media-id",
      "two published documents claim one media identity",
      mediaId,
    );
  }

  return projectPublicMedia(result[0] as RawPublicMediaDocument, {
    ...languages,
    config,
  });
}

/**
 * A bounded listing of the deployment's publishable photographs, newest capture
 * first.
 *
 * Bounded on purpose: an archive of several thousand photographs must never
 * become one response. Curated galleries do not read this — their order is
 * authored on the gallery and their pagination is AB#114's — so this exists for
 * the reads that legitimately want the media library itself.
 */
export async function readPublicMedia(
  options: PublicMediaReadOptions & { readonly limit: number },
): Promise<readonly ImageMedia[]> {
  const { client, config, languages } = resolveRead(options);
  // `Math.min`/`Math.max` propagate NaN rather than clamping it, and a NaN
  // parameter serializes as `null` — a bounded read would quietly become a
  // rejected query. Anything that is not a finite number asks for nothing.
  const requested = Number.isFinite(options.limit)
    ? Math.trunc(options.limit)
    : 0;
  const limit = Math.min(
    Math.max(requested, 0),
    MAX_PUBLIC_MEDIA_PAGE_SIZE,
  );

  if (limit <= 0) return [];

  const result = await client.query({
    query: `*[${PUBLIC_MEDIA_FILTER} && mediaType == "image"] | ${PUBLIC_MEDIA_ORDER} [0...$limit]${PUBLIC_MEDIA_PROJECTION}`,
    params: { limit },
    tag: "media.list",
  });

  if (!Array.isArray(result)) return [];

  return result.map((document) =>
    projectPublicMedia(document as RawPublicMediaDocument, {
      ...languages,
      config,
    }),
  );
}
