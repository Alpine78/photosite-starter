import { describe, expect, it, vi } from "vitest";
import {
  readArticleEndGalleryPage,
  type ArticleEndGallerySource,
} from "@/lib/article-end-gallery-pagination";
import {
  createHmacGalleryCursorCodec,
  selectGalleryWindow,
  type CuratedGalleryPlacement,
} from "@/lib/gallery-pagination";
import { mockImages } from "@/lib/mock-media";

const codec = createHmacGalleryCursorCodec("a".repeat(32));
const placements: readonly CuratedGalleryPlacement[] = Array.from(
  { length: 7 },
  (_, index) => ({
    placementId: `end-${index + 1}`,
    order: index,
    visible: true,
    media: Object.values(mockImages)[index % Object.values(mockImages).length],
  }),
);

function read(
  overrides: Partial<{
    locale: string;
    contentId: string;
    endGalleryId: string;
    cursor: string;
  }> = {},
  source?: ArticleEndGallerySource,
) {
  return readArticleEndGalleryPage({
    query: {
      locale: overrides.locale ?? "en-GB",
      contentId: overrides.contentId ?? "article-one",
      endGalleryId: overrides.endGalleryId ?? "ending-one",
      pageSize: 3,
      ...(overrides.cursor === undefined ? {} : { cursor: overrides.cursor }),
    },
    cursorCodec: codec,
    source:
      source ??
      (async ({ window }) => selectGalleryWindow(placements, window)),
  });
}

describe("article end-gallery pagination", () => {
  it("reads one bounded window and continues in manual order", async () => {
    const source = vi.fn<ArticleEndGallerySource>(async ({ window }) =>
      selectGalleryWindow(placements, window),
    );
    const first = await read({}, source);
    expect(first?.items.map((item) => item.itemId)).toEqual([
      "end-1",
      "end-2",
      "end-3",
    ]);
    expect(source.mock.calls[0]?.[0].window).toEqual({ candidateLimit: 4 });
    expect(first?.page.hasNextPage).toBe(true);
    if (first?.page.hasNextPage !== true) throw new Error("expected cursor");

    const second = await read({ cursor: first.page.endCursor }, source);
    expect(second?.items.map((item) => item.itemId)).toEqual([
      "end-4",
      "end-5",
      "end-6",
    ]);
    expect(source.mock.calls[1]?.[0].window).toMatchObject({
      candidateLimit: 4,
      after: { pinnedTier: 0, key: 2, placementId: "end-3" },
    });
  });

  it.each([
    ["another article", { contentId: "article-two" }],
    ["another end gallery", { endGalleryId: "ending-two" }],
    ["another full locale", { locale: "en-US" }],
  ])("rejects a cursor replayed against %s", async (_label, scope) => {
    const first = await read();
    if (first?.page.hasNextPage !== true) throw new Error("expected cursor");
    await expect(read({ ...scope, cursor: first.page.endCursor })).rejects.toMatchObject({
      name: "GalleryCursorError",
      code: "wrong-scope",
    });
  });

  it("rejects a stale boundary and an oversized source window", async () => {
    const first = await read();
    if (first?.page.hasNextPage !== true) throw new Error("expected cursor");
    await expect(
      read({ cursor: first.page.endCursor }, async () => ({ candidates: [] })),
    ).rejects.toMatchObject({ code: "stale" });
    await expect(
      read({}, async () => ({ candidates: placements.slice(0, 5) })),
    ).rejects.toThrow("more candidates");
  });

  it("preserves the source's explicit absence", async () => {
    await expect(read({}, async () => undefined)).resolves.toBeUndefined();
  });
});

it("rejects a tampered token before reading any placement window", async () => {
  const first = await read();
  if (!first?.page.hasNextPage) throw new Error("missing continuation");
  const source = vi.fn<ArticleEndGallerySource>();
  await expect(read({ cursor: `${first.page.endCursor}x` }, source)).rejects.toThrow();
  expect(source).not.toHaveBeenCalled();
});
