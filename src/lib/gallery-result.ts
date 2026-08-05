import { createHash, timingSafeEqual } from "node:crypto";
import type { Media } from "@/lib/media";

export type GalleryResultItem = {
  /** Result identity: placementId for curated results, mediaId for dynamic ones. */
  readonly itemId: string;
  /** Stable identity of the underlying photograph or video. */
  readonly mediaId: string;
  /** Curated placement identity; dynamic adapters omit it. */
  readonly placementId?: string;
  readonly media: Media;
  readonly sectionId?: string;
};

export type GallerySection = {
  readonly sectionId: string;
  readonly title: string;
};

export type GalleryPage = {
  readonly items: readonly GalleryResultItem[];
  readonly page: {
    readonly size: number;
    readonly hasNextPage: boolean;
    /** Opaque adapter cursor; absent at the end of the result set. */
    readonly endCursor?: string;
  };
  /** Optional now so sections can land without changing the core item/page shape. */
  readonly sections?: readonly GallerySection[];
};

export type GalleryCursorScope = {
  readonly sourceId: string;
  readonly normalizedFilter: string;
  readonly ordering: string;
  readonly visibilityVersion: string;
  readonly pageSize: number;
};

export type GalleryCursorErrorCode =
  | "malformed"
  | "tampered"
  | "wrong-scope"
  | "stale";

export class GalleryCursorError extends Error {
  readonly code: GalleryCursorErrorCode;

  constructor(code: GalleryCursorErrorCode) {
    super(`Gallery cursor is ${code}`);
    this.name = "GalleryCursorError";
    this.code = code;
  }
}

export type CuratedGalleryPlacement = {
  readonly placementId: string;
  readonly order: number;
  readonly visible: boolean;
  readonly media: Media;
  readonly sectionId?: string;
  readonly altOverride?: string;
  readonly captionOverride?: string;
};

type CursorPayload = GalleryCursorScope & {
  readonly version: 1;
  readonly offset: number;
};

const CURSOR_INTEGRITY_NAMESPACE = "photosite-gallery-cursor-v1";

function cursorDigest(payload: string): string {
  return createHash("sha256")
    .update(CURSOR_INTEGRITY_NAMESPACE)
    .update("\0")
    .update(payload)
    .digest("base64url");
}

function encodeCursor(scope: GalleryCursorScope, offset: number): string {
  const payload = Buffer.from(
    JSON.stringify({ version: 1, ...scope, offset } satisfies CursorPayload),
  ).toString("base64url");

  return `${payload}.${cursorDigest(payload)}`;
}

function parseCursor(cursor: string, scope: GalleryCursorScope): number {
  const parts = cursor.split(".");
  if (parts.length !== 2 || parts.some((part) => part.length === 0)) {
    throw new GalleryCursorError("malformed");
  }

  const [encodedPayload, suppliedDigest] = parts;
  const expectedDigest = cursorDigest(encodedPayload);
  const suppliedBytes = Buffer.from(suppliedDigest);
  const expectedBytes = Buffer.from(expectedDigest);
  if (
    suppliedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(suppliedBytes, expectedBytes)
  ) {
    throw new GalleryCursorError("tampered");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString());
  } catch {
    throw new GalleryCursorError("malformed");
  }

  if (!isCursorPayload(payload)) {
    throw new GalleryCursorError("malformed");
  }
  if (payload.visibilityVersion !== scope.visibilityVersion) {
    throw new GalleryCursorError("stale");
  }
  if (
    payload.sourceId !== scope.sourceId ||
    payload.normalizedFilter !== scope.normalizedFilter ||
    payload.ordering !== scope.ordering ||
    payload.pageSize !== scope.pageSize
  ) {
    throw new GalleryCursorError("wrong-scope");
  }

  return payload.offset;
}

function isCursorPayload(value: unknown): value is CursorPayload {
  if (typeof value !== "object" || value === null) return false;
  const payload = value as Record<string, unknown>;
  return (
    payload.version === 1 &&
    typeof payload.sourceId === "string" &&
    typeof payload.normalizedFilter === "string" &&
    typeof payload.ordering === "string" &&
    typeof payload.visibilityVersion === "string" &&
    Number.isInteger(payload.pageSize) &&
    Number.isInteger(payload.offset) &&
    (payload.pageSize as number) > 0 &&
    (payload.offset as number) >= 0
  );
}

function assertUniquePlacementIds(
  placements: readonly CuratedGalleryPlacement[],
): void {
  const ids = new Set<string>();
  for (const placement of placements) {
    if (ids.has(placement.placementId)) {
      throw new TypeError(`Duplicate placementId: ${placement.placementId}`);
    }
    ids.add(placement.placementId);
  }
}

function projectCuratedItem(
  placement: CuratedGalleryPlacement,
): GalleryResultItem {
  if (placement.media.type !== "image") {
    throw new TypeError(
      `Unsupported public gallery media type: ${placement.media.type}`,
    );
  }

  const media = {
    ...placement.media,
    ...(Object.hasOwn(placement, "altOverride")
      ? { alt: placement.altOverride as string }
      : {}),
    ...(Object.hasOwn(placement, "captionOverride")
      ? { caption: placement.captionOverride as string }
      : {}),
  };

  return {
    itemId: placement.placementId,
    mediaId: media.mediaId,
    placementId: placement.placementId,
    media,
    ...(placement.sectionId === undefined
      ? {}
      : { sectionId: placement.sectionId }),
  };
}

export function buildCuratedGalleryPage({
  placements,
  scope,
  cursor,
}: {
  readonly placements: readonly CuratedGalleryPlacement[];
  readonly scope: GalleryCursorScope;
  readonly cursor?: string;
}): GalleryPage {
  if (!Number.isInteger(scope.pageSize) || scope.pageSize <= 0) {
    throw new RangeError("Gallery page size must be a positive integer");
  }

  assertUniquePlacementIds(placements);
  const orderedItems = placements
    .filter((placement) => placement.visible)
    .toSorted(
      (left, right) =>
        left.order - right.order ||
        left.placementId.localeCompare(right.placementId),
    )
    .map(projectCuratedItem);

  const offset = cursor === undefined ? 0 : parseCursor(cursor, scope);
  if (offset > orderedItems.length) {
    throw new GalleryCursorError("stale");
  }

  const items = orderedItems.slice(offset, offset + scope.pageSize);
  const nextOffset = offset + items.length;
  const hasNextPage = nextOffset < orderedItems.length;

  return {
    items,
    page: {
      size: scope.pageSize,
      hasNextPage,
      ...(hasNextPage ? { endCursor: encodeCursor(scope, nextOffset) } : {}),
    },
  };
}
