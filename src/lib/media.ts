/**
 * Project-owned public media contract.
 *
 * Provider documents, archive locators, master files, and private or sales
 * assets stop before this boundary. Public adapters construct these values
 * property by property instead of returning provider records.
 */

export const MAX_PUBLIC_IMAGE_DIMENSION = 8192;

declare const publicImageSourceBrand: unique symbol;
declare const publicImageVersionBrand: unique symbol;
declare const publicImageDimensionBrand: unique symbol;

type ValidatedPublicImageSource = string & {
  readonly [publicImageSourceBrand]: true;
};

type ValidatedPublicImageVersion = string & {
  readonly [publicImageVersionBrand]: true;
};

type ValidatedPublicImageDimension = number & {
  readonly [publicImageDimensionBrand]: true;
};

type MediaMetadata = {
  /** Stable project identity; independent of provider ids and delivery URLs. */
  readonly mediaId: string;
  readonly caption?: string;
  readonly credit?: string;
};

export type PublicImageRendition = {
  /**
   * Versioned URL of a public web-delivery derivative. The URL must change
   * whenever its bytes change; it must never identify an archive master.
   */
  readonly src: ValidatedPublicImageSource;
  /**
   * Opaque byte version that also appears in `src`. It changes with the
   * source bytes and is never an authorization token.
   */
  readonly version: ValidatedPublicImageVersion;
  /** Intrinsic pixel dimensions of the derivative at `src`. */
  readonly width: ValidatedPublicImageDimension;
  readonly height: ValidatedPublicImageDimension;
};

export type ImageMedia = MediaMetadata & {
  readonly type: "image";
  readonly rendition: PublicImageRendition;
  /** Descriptive alt text; empty only when the image is decorative. */
  readonly alt: string;
};

export type VideoMedia = MediaMetadata & {
  readonly type: "video";
  readonly src: string;
  /** Accessible title for a future video renderer. */
  readonly title: string;
  /** Intrinsic dimensions for preserving the video's native ratio. */
  readonly width: number;
  readonly height: number;
};

export type Media = ImageMedia | VideoMedia;

/** Words about an image, which are authored per locale. */
export type LocalizedMediaText = {
  /** Required so the source locale's alternative text cannot leak through. */
  readonly alt: string;
  /** Omission means this locale publishes no caption. */
  readonly caption?: string;
  /** Omission preserves a language-neutral name or attribution line. */
  readonly credit?: string;
};

/**
 * The same public rendition, described in another language.
 *
 * A photograph's bytes are language-neutral; the sentences about it are not. A
 * localized page must not repeat the source locale's alt text — a screen reader
 * would announce it in the wrong language inside a page that declares another —
 * and must not ship a second derivative just to carry different words. So text
 * is projected over the identical rendition: identity, `src`, version, and
 * dimensions are untouched, and nothing here can widen what the browser
 * receives.
 *
 * Alternative text is mandatory. An omitted caption is removed rather than
 * inherited from the source language; an omitted credit keeps the value it
 * already had, because a credit is usually a name rather than a sentence.
 */
export function withLocalizedText(
  image: ImageMedia,
  text: LocalizedMediaText,
): ImageMedia {
  const localized = {
    ...image,
    alt: text.alt,
    ...(text.credit === undefined ? {} : { credit: text.credit }),
  };

  if (text.caption === undefined) {
    delete localized.caption;
  } else {
    localized.caption = text.caption;
  }

  return localized;
}

export type PublicImageMediaInput = {
  readonly mediaId: string;
  /** Effective server-side visibility; non-public media fails closed. */
  readonly publiclyRenderable: boolean;
  readonly rendition: {
    readonly src: string;
    readonly version: string;
    readonly width: number;
    readonly height: number;
    /** Classification assigned at ingest, before the public projection. */
    readonly sourceKind: "public-web-derivative" | "non-public";
  };
  readonly alt: string;
  readonly caption?: string;
  readonly credit?: string;
};

function assertNonEmpty(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(`${field} must not be empty`);
  }
}

function assertText(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string") {
    throw new TypeError(`${field} must be a string`);
  }
}

function assertMetadataText(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throw new TypeError(`${field} must be a string when provided`);
  }
}

const LOCAL_VERSIONED_IMAGE_PATH =
  /^\/gallery\/[a-z0-9]+(?:-[a-z0-9]+)*\.([a-f0-9]{12})\.(?:avif|jpe?g|png|webp)$/;

/**
 * Byte version embedded in a local public gallery path, or `undefined` when the
 * source is not one. Only the local path convention carries its version in the
 * filename; a remote derivative declares it alongside the URL.
 *
 * Exposed so a caller holding just a configured URL can satisfy the rendition
 * contract without restating the path convention.
 */
export function readLocalPublicImageVersion(src: string): string | undefined {
  return src.match(LOCAL_VERSIONED_IMAGE_PATH)?.[1];
}

function assertVersion(
  version: unknown,
): asserts version is ValidatedPublicImageVersion {
  if (
    typeof version !== "string" ||
    !/^[A-Za-z0-9_-]{6,128}$/.test(version)
  ) {
    throw new TypeError(
      "rendition.version must be a 6-128 character immutable source identifier",
    );
  }
}

function assertPublicSource(
  src: string,
  version: string,
): asserts src is ValidatedPublicImageSource {
  assertNonEmpty(src, "rendition.src");

  if (src.startsWith("/")) {
    const localMatch = src.match(LOCAL_VERSIONED_IMAGE_PATH);
    if (!localMatch || localMatch[1] !== version) {
      throw new TypeError(
        "local rendition.src must be a content-versioned public gallery image path",
      );
    }
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(src);
  } catch {
    throw new TypeError(
      "rendition.src must be a root-relative path or an HTTPS URL",
    );
  }

  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.hash
  ) {
    throw new TypeError(
      "rendition.src must be a versioned local path or an HTTPS URL without credentials or fragments",
    );
  }

  const versionedRequestTarget = `${parsed.pathname}${parsed.search}`;
  if (
    !versionedRequestTarget.includes(version) &&
    !versionedRequestTarget.includes(encodeURIComponent(version))
  ) {
    throw new TypeError("rendition.version must appear in rendition.src");
  }
}

function assertDimension(
  value: number,
  field: string,
): asserts value is ValidatedPublicImageDimension {
  if (
    !Number.isInteger(value) ||
    value <= 0 ||
    value > MAX_PUBLIC_IMAGE_DIMENSION
  ) {
    throw new RangeError(
      `${field} must be an integer between 1 and ${MAX_PUBLIC_IMAGE_DIMENSION}`,
    );
  }
}

/**
 * Validates and allow-lists one public image DTO.
 *
 * The explicit projection is intentional: extra properties on a provider
 * record are not copied into browser-facing data at runtime. The returned
 * scalar delivery fields carry compile-time provenance that their validation
 * ran. Callers must keep the projected descriptor intact; source classification
 * itself remains the trusted adapter's responsibility.
 */
export function projectPublicImageMedia(
  input: PublicImageMediaInput,
): ImageMedia {
  assertNonEmpty(input.mediaId, "mediaId");
  assertText(input.alt, "alt");
  assertMetadataText(input.caption, "caption");
  assertMetadataText(input.credit, "credit");
  if (
    input.publiclyRenderable !== true ||
    input.rendition.sourceKind !== "public-web-derivative"
  ) {
    throw new TypeError(
      "only a publicly renderable web derivative can cross the public media boundary",
    );
  }
  assertVersion(input.rendition.version);
  assertPublicSource(input.rendition.src, input.rendition.version);
  assertDimension(input.rendition.width, "rendition.width");
  assertDimension(input.rendition.height, "rendition.height");

  return {
    type: "image",
    mediaId: input.mediaId,
    alt: input.alt,
    rendition: {
      src: input.rendition.src,
      version: input.rendition.version,
      width: input.rendition.width,
      height: input.rendition.height,
    },
    ...(input.caption === undefined ? {} : { caption: input.caption }),
    ...(input.credit === undefined ? {} : { credit: input.credit }),
  };
}
