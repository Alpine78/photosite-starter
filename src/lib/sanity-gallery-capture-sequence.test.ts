import { describe, expect, it, vi } from "vitest";

import {
  CAPTURE_SEQUENCE_ORDERING_SCOPE,
  createHmacGalleryCursorCodec,
  GalleryCursorError,
} from "@/lib/gallery-pagination";
import type { CuratedGalleryResultItem } from "@/lib/gallery-result";
import { getSanityPublicCachePolicy } from "@/lib/sanity-cache";
import type { SanityClient, SanityQueryRequest } from "@/lib/sanity-client";
import type { SanityConfig } from "@/lib/sanity-config";
import {
  GALLERY_PAGE_SIZE,
  MEDIA_DOCUMENT_TYPE,
  readSanityCuratedGalleryPage,
  SanityGalleryError,
} from "@/lib/sanity-gallery";
import type { RawPublicMediaDocument } from "@/lib/sanity-media";
import {
  CAPTURE_SEQUENCE_MEDIA_TYPE,
  CAPTURE_SEQUENCE_ORDERING_RULE,
} from "../../sanity/schemas/capture-sequence";
import { MEDIA_TYPE_NAME } from "../../sanity/schemas/media";

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ localeRoutes: { defaultLocale: "fi-FI" } }),
}));

const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

const CONTENT_ID = "rally-example-2024";
const GALLERY_SIZE = 60;
const cursorCodec = createHmacGalleryCursorCodec("c".repeat(32));

type FixtureMedia = Omit<RawPublicMediaDocument, "mediaId"> & {
  readonly mediaId: string;
  readonly captureSequence?: {
    readonly galleryContentId: string;
    readonly sequence: number;
    readonly sectionId?: string;
  };
  readonly _updatedAt: string;
};

function assetOf() {
  const path = `images/${config.projectId}/${config.dataset}/Tb9Ew8CXIwaY6R1kjMvI0uRR-1600x1067.webp`;
  return {
    url: `https://cdn.sanity.io/${path}`,
    path,
    extension: "webp",
    mimeType: "image/webp",
    width: 1600,
    height: 1067,
  };
}

function mediaOf(
  mediaId: string,
  captureSequence: FixtureMedia["captureSequence"],
  overrides: Partial<FixtureMedia> = {},
): FixtureMedia {
  return {
    mediaId,
    mediaType: "image",
    publiclyRenderable: true,
    alt: [{ language: "en", value: `Photograph ${mediaId}` }],
    asset: assetOf(),
    _updatedAt: "2026-09-01T00:00:00.000Z",
    ...(captureSequence === undefined ? {} : { captureSequence }),
    ...overrides,
  };
}

/**
 * Sixty photographs in two sections, stored in scrambled order with opaque
 * `mediaId`s that do not sort like their sequence — so a walk that comes back
 * in sequence order proves the adapter ordered by `sequence`, not by identity
 * or storage position. Plus one photograph of another gallery, which must
 * never appear.
 */
function buildMedia(): readonly FixtureMedia[] {
  const rows = Array.from({ length: GALLERY_SIZE }, (_unused, index) => {
    const sequence = index + 1;
    return mediaOf(`photo-${((sequence * 37) % 101).toString(36)}-${sequence}`, {
      galleryContentId: CONTENT_ID,
      sequence,
      sectionId: sequence <= 35 ? "ss1" : "ss2",
    });
  });
  const scrambled = rows.toSorted((a, b) => (a.mediaId < b.mediaId ? -1 : 1));
  return [
    ...scrambled,
    mediaOf("other-gallery-photo", {
      galleryContentId: "another-rally",
      sequence: 1,
      sectionId: "ss1",
    }),
  ];
}

function expectedOrder(media: readonly FixtureMedia[], sectionId?: string): readonly string[] {
  return media
    .filter(
      (row) =>
        row.captureSequence?.galleryContentId === CONTENT_ID &&
        row.publiclyRenderable === true &&
        (row.privateOnly === undefined || row.privateOnly === false) &&
        (sectionId === undefined || row.captureSequence.sectionId === sectionId),
    )
    .toSorted(
      (a, b) =>
        (a.captureSequence?.sequence ?? 0) - (b.captureSequence?.sequence ?? 0) ||
        (a.mediaId < b.mediaId ? -1 : a.mediaId > b.mediaId ? 1 : 0),
    )
    .map((row) => row.mediaId as string);
}

/**
 * A fake Content Lake that answers the two query shapes the capture-sequence
 * read issues, dispatched by `request.tag` and computed from `request.params`:
 * the same filter (gallery `contentId`, publicly renderable, fail-closed
 * `privateOnly`, section) and `(sequence, mediaId)` keyset the GROQ expresses.
 * It records the requests so a test can assert the GROQ carries those clauses.
 */
function fakeStore(options: {
  readonly media: readonly FixtureMedia[];
  readonly hasPlacements?: boolean;
  readonly orderingRule?: string;
}): { readonly client: SanityClient; readonly requests: SanityQueryRequest[] } {
  const requests: SanityQueryRequest[] = [];
  const members = (contentId: unknown) =>
    options.media.filter((row) => row.captureSequence?.galleryContentId === contentId);

  const toRow = (row: FixtureMedia) => ({
    placementId: row.mediaId,
    order: row.captureSequence?.sequence,
    sectionId: row.captureSequence?.sectionId ?? null,
    visible: true,
    media: row,
  });

  const client: SanityClient = {
    async query(request) {
      requests.push(request);
      const params = (request.params ?? {}) as Record<string, unknown>;

      if (request.tag === "gallery.placements.basics") {
        if (params.contentId !== CONTENT_ID) return [];
        const newest = members(CONTENT_ID)
          .map((row) => row._updatedAt)
          .toSorted()
          .at(-1);
        return [
          {
            _id: `gallery-${CONTENT_ID}-en`,
            orderingRule: options.orderingRule ?? CAPTURE_SEQUENCE_ORDERING_RULE,
            sections: [
              { sectionId: "ss1", slug: "ss1-morning", label: "SS1" },
              { sectionId: "ss2", slug: "ss2-evening", label: "SS2" },
            ],
            latestPlacementUpdatedAt:
              options.hasPlacements === true ? "2026-01-01T00:00:00.000Z" : null,
            latestCaptureMediaUpdatedAt: newest ?? null,
            staleShuffledOrderCount: 0,
          },
        ];
      }

      if (request.tag === "gallery.capture-sequence.window") {
        const sectionId = params.sectionId as string | undefined;
        const candidateLimit = params.candidateLimit as number;
        const afterOrder = params.afterOrder as number | undefined;
        const afterId = params.afterPlacementId as string | undefined;
        const sorted = members(params.contentId)
          .filter(
            (row) =>
              row.publiclyRenderable === true &&
              (row.privateOnly === undefined || row.privateOnly === null || row.privateOnly === false) &&
              (sectionId === undefined || row.captureSequence?.sectionId === sectionId),
          )
          .toSorted(
            (a, b) =>
              (a.captureSequence?.sequence ?? 0) - (b.captureSequence?.sequence ?? 0) ||
              (a.mediaId < b.mediaId ? -1 : a.mediaId > b.mediaId ? 1 : 0),
          );
        if (afterId === undefined) {
          return sorted.slice(0, candidateLimit).map(toRow);
        }
        const boundary = sorted.find((row) => row.mediaId === afterId);
        const candidates = sorted.filter((row) => {
          const sequence = row.captureSequence?.sequence ?? 0;
          return (
            sequence > (afterOrder as number) ||
            (sequence === afterOrder && (row.mediaId as string) > afterId)
          );
        });
        return {
          boundary: boundary === undefined ? null : toRow(boundary),
          candidates: candidates.slice(0, candidateLimit).map(toRow),
        };
      }

      throw new Error(`no fixture behavior for tag "${request.tag}"`);
    },
  };
  return { client, requests };
}

async function readPage(
  client: SanityClient,
  options: { readonly cursor?: string; readonly sectionSlug?: string } = {},
) {
  return readSanityCuratedGalleryPage("en", CONTENT_ID, {
    client,
    config,
    cursorCodec,
    ...options,
  });
}

async function walk(
  client: SanityClient,
  sectionSlug?: string,
): Promise<readonly CuratedGalleryResultItem[]> {
  const collected: CuratedGalleryResultItem[] = [];
  let cursor: string | undefined;
  for (let pages = 0; pages < 20; pages += 1) {
    const page = await readPage(client, {
      ...(cursor === undefined ? {} : { cursor }),
      ...(sectionSlug === undefined ? {} : { sectionSlug }),
    });
    expect(page).toBeDefined();
    if (page === undefined) break;
    collected.push(...page.items);
    if (!page.page.hasNextPage) return collected;
    cursor = page.page.endCursor ?? undefined;
  }
  throw new Error("walk did not finish");
}

describe("capture-sequence restated names stay pinned", () => {
  it("names the same media type the schema and adapter use", () => {
    expect(CAPTURE_SEQUENCE_MEDIA_TYPE).toBe(MEDIA_TYPE_NAME);
    expect(MEDIA_DOCUMENT_TYPE).toBe(MEDIA_TYPE_NAME);
  });
});

describe("readSanityCuratedGalleryPage — capture-sequence (ADR-0022)", () => {
  it("walks every photograph once, in sequence order, with itemId = mediaId", async () => {
    const media = buildMedia();
    const { client } = fakeStore({ media });
    const items = await walk(client);
    expect(items.map((item) => item.itemId)).toEqual(expectedOrder(media));
    expect(items.map((item) => item.media.mediaId)).toEqual(expectedOrder(media));
    expect(new Set(items.map((item) => item.itemId)).size).toBe(GALLERY_SIZE);
  });

  it("walks a section across more than one page without the other section", async () => {
    const media = buildMedia();
    const { client } = fakeStore({ media });
    const items = await walk(client, "ss1-morning");
    expect(items.map((item) => item.itemId)).toEqual(expectedOrder(media, "ss1"));
    expect(items.length).toBe(35);
  });

  it("excludes media that is not publicly renderable or is private-only, without shortening a page", async () => {
    const media = buildMedia().map((row) =>
      row.captureSequence?.sequence === 3
        ? { ...row, publiclyRenderable: false }
        : row.captureSequence?.sequence === 4
          ? { ...row, privateOnly: true }
          : row,
    );
    const { client } = fakeStore({ media });
    const first = await readPage(client);
    expect(first?.items.length).toBe(first?.page.size);
    const items = await walk(client);
    expect(items.map((item) => item.itemId)).toEqual(expectedOrder(media));
    expect(items.length).toBe(GALLERY_SIZE - 2);
  });

  it("sends the gallery, visibility, and section clauses to the store with the capture-sequence tag", async () => {
    const { client, requests } = fakeStore({ media: buildMedia() });
    await readPage(client, { sectionSlug: "ss2-evening" });
    const window = requests.find((request) => request.tag === "gallery.capture-sequence.window");
    expect(window).toBeDefined();
    expect(window?.params).toMatchObject({ contentId: CONTENT_ID, sectionId: "ss2" });
    expect(window?.params).not.toHaveProperty("galleryDocumentId");
    expect(window?.query).toContain(`_type == "${MEDIA_DOCUMENT_TYPE}"`);
    expect(window?.query).toContain("captureSequence.galleryContentId == $contentId");
    expect(window?.query).toContain("publiclyRenderable == true");
    expect(window?.query).toContain("(privateOnly == false || !defined(privateOnly))");
    expect(window?.query).toContain("captureSequence.sectionId == $sectionId");
    expect(window?.query).toContain("order(captureSequence.sequence asc, mediaId asc)");
    expect(window?.query).not.toContain("galleryPlacement");
  });

  it("looks a continuation boundary up by mediaId and keysets on (sequence, mediaId)", async () => {
    const { client, requests } = fakeStore({ media: buildMedia() });
    const first = await readPage(client);
    await readPage(client, { cursor: first?.page.endCursor ?? undefined });
    const continuation = requests.filter(
      (request) => request.tag === "gallery.capture-sequence.window",
    )[1];
    expect(continuation?.query).toContain("mediaId == $afterPlacementId");
    expect(continuation?.query).toContain(
      "(captureSequence.sequence > $afterOrder || (captureSequence.sequence == $afterOrder && mediaId > $afterPlacementId))",
    );
  });

  it("caches the capture-sequence window under the gallery and media tags", () => {
    const policy = getSanityPublicCachePolicy("gallery.capture-sequence.window");
    expect(policy?.tags).toEqual(
      expect.arrayContaining(["sanity:galleries", "sanity:media"]),
    );
  });

  it("refuses a manual-scope cursor as wrong-scope", async () => {
    const media = buildMedia();
    // Everything in the scope matches this gallery except the ordering rule — a
    // token a placement-based version of the same gallery would have issued.
    const token = cursorCodec.encode(
      {
        sourceId: `${CONTENT_ID}@en`,
        normalizedFilter: "all",
        ordering: "manual-v1",
        visibilityVersion: "2026-09-01T00:00:00.000Z",
        pageSize: GALLERY_PAGE_SIZE,
      },
      { pinnedTier: 0, key: 5, placementId: expectedOrder(media)[4] as string },
    );
    const { client } = fakeStore({ media });
    const error = await readPage(client, { cursor: token }).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(GalleryCursorError);
    expect((error as GalleryCursorError).code).toBe("wrong-scope");
    expect(CAPTURE_SEQUENCE_ORDERING_SCOPE).toBe("capture-sequence-v1");
  });

  it("derives visibilityVersion from the newest member media", async () => {
    const media = buildMedia().map((row, index) =>
      index === 7 ? { ...row, _updatedAt: "2026-09-20T12:00:00.000Z" } : row,
    );
    const first = await readPage(fakeStore({ media }).client);
    const token = first?.page.endCursor ?? undefined;
    expect(token).toBeDefined();

    // A later caption fix bumps the newest `_updatedAt`, so the old token is stale.
    const edited = media.map((row, index) =>
      index === 3 ? { ...row, _updatedAt: "2026-09-21T08:00:00.000Z" } : row,
    );
    const error = await readPage(fakeStore({ media: edited }).client, { cursor: token }).catch(
      (cause: unknown) => cause,
    );
    expect(error).toBeInstanceOf(GalleryCursorError);
    expect((error as GalleryCursorError).code).toBe("stale");
  });

  it("refuses a capture-sequence gallery that also has placements", async () => {
    const { client } = fakeStore({ media: buildMedia(), hasPlacements: true });
    const error = await readPage(client).catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(SanityGalleryError);
    expect((error as SanityGalleryError).rejection).toBe("malformed-result");
  });

  it("answers a gallery with no member media as a valid empty page", async () => {
    const { client } = fakeStore({ media: [] });
    const page = await readPage(client);
    expect(page?.items).toEqual([]);
    expect(page?.page.hasNextPage).toBe(false);
  });
});
