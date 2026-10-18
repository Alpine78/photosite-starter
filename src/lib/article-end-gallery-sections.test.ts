import { describe, expect, it, vi } from "vitest";
import {
  readArticleEndGalleryPage,
  type ArticleEndGalleryQuery,
  type ArticleEndGallerySource,
} from "./article-end-gallery-pagination";
import { createHmacGalleryCursorCodec, selectGalleryWindow, type CuratedGalleryPlacement } from "./gallery-pagination";
import { MAX_SECTION_ID_LENGTH } from "./gallery-sections";
import { mockImages } from "./mock-media";

const codec = createHmacGalleryCursorCodec("a".repeat(32));
const images = Object.values(mockImages);
const groups = [["group-a", 2], ["group-b", 6], ["group-c", 7], ["group-d", 16], ["group-e", 10]] as const;
const placements: CuratedGalleryPlacement[] = groups.flatMap(([sectionId, count]) =>
  Array.from({ length: count }, () => sectionId)).map((sectionId, index) => ({
  placementId: `item-${String(index + 1).padStart(2, "0")}`,
  order: index,
  sectionId,
  visible: true,
  media: images[index % images.length],
}));

/** Conforming reference: filter the collection BEFORE candidates and boundary. */
function sourceFor(rows: readonly CuratedGalleryPlacement[] = placements) {
  return vi.fn<ArticleEndGallerySource>(async ({ window, sectionId }) => ({
    ...selectGalleryWindow(sectionId === undefined ? rows : rows.filter((row) => row.sectionId === sectionId), window),
    ...(sectionId === undefined ? {} : { appliedSectionId: sectionId }),
  }));
}

function read(query: Partial<ArticleEndGalleryQuery> = {}, source = sourceFor(), selectedCodec = codec) {
  return readArticleEndGalleryPage({ query: {
    locale: "en-GB", contentId: "article-one", endGalleryId: "ending-one", ...query,
  }, source, cursorCodec: selectedCodec });
}

describe("resolved generic article-end sections", () => {
  it("retains All24+17 bounded windows and exact legacy source request shape", async () => {
    const source = sourceFor();
    const first = await read({}, source);
    expect(first?.items.map((item) => item.itemId)).toEqual(placements.slice(0, 24).map((row) => row.placementId));
    expect(source.mock.calls[0]?.[0]).toStrictEqual({
      locale: "en-GB", contentId: "article-one", endGalleryId: "ending-one", window: { candidateLimit: 25 },
    });
    if (!first?.page.hasNextPage) throw new Error("missing continuation");
    const next = await read({ cursor: first.page.endCursor }, source);
    expect(next?.items.map((item) => item.itemId)).toEqual(placements.slice(24).map((row) => row.placementId));
    expect(next?.page.hasNextPage).toBe(false);
  });

  it.each(groups)("reads the entire %s group of %d before pagination", async (sectionId, count) => {
    const source = sourceFor();
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await read({ sectionId, pageSize: 3, ...(cursor === undefined ? {} : { cursor }) }, source);
      if (!page) throw new Error("missing page");
      ids.push(...page.items.map((item) => item.itemId));
      cursor = page.page.hasNextPage ? page.page.endCursor : undefined;
    } while (cursor !== undefined);
    expect(ids).toHaveLength(count);
    expect(ids).toEqual(placements.filter((row) => row.sectionId === sectionId).map((row) => row.placementId));
    expect(new Set(ids).size).toBe(count);
    expect(source.mock.calls).toHaveLength(Math.ceil(count / 3));
    for (const [request] of source.mock.calls) {
      expect(request.sectionId).toBe(sectionId);
      expect(request.window.candidateLimit).toBe(4);
    }
  });

  it("keeps unassigned placements in All and out of selected views", async () => {
    const unassigned: CuratedGalleryPlacement = { ...placements[0], placementId: "unassigned", order: 0, sectionId: undefined };
    const source = sourceFor([unassigned, ...placements]);
    expect((await read({}, source))?.items.map((item) => item.itemId)).toContain("unassigned");
    expect((await read({ sectionId: "group-a" }, source))?.items.map((item) => item.itemId)).toEqual(["item-01", "item-02"]);
  });

  it("returns a declared empty section without widening to All", async () => {
    const page = await read({ sectionId: "empty" });
    expect(page?.items).toEqual([]);
    expect(page?.page).toMatchObject({ hasNextPage: false, endCursor: null });
  });

  it.each([
    ["another section", { sectionId: "group-e" }], ["All", { sectionId: undefined }],
    ["another article", { sectionId: "group-d", contentId: "article-two" }],
    ["another locale", { sectionId: "group-d", locale: "en-US" }],
    ["another gallery", { sectionId: "group-d", endGalleryId: "ending-two" }],
  ] as const)("rejects a selected cursor replay into %s before a source read", async (_name, override) => {
    const first = await read({ sectionId: "group-d", pageSize: 3 });
    if (!first?.page.hasNextPage) throw new Error("missing continuation");
    const source = sourceFor();
    await expect(read({ pageSize: 3, cursor: first.page.endCursor, ...override }, source))
      .rejects.toMatchObject({ name: "GalleryCursorError", code: "wrong-scope" });
    expect(source).not.toHaveBeenCalled();
  });

  it("rejects an All token used for a selected view before a source read", async () => {
    const first = await read();
    if (!first?.page.hasNextPage) throw new Error("missing continuation");
    const source = sourceFor();
    await expect(read({ sectionId: "group-d", cursor: first.page.endCursor }, source))
      .rejects.toMatchObject({ code: "wrong-scope" });
    expect(source).not.toHaveBeenCalled();
  });

  it("rejects a boundary reassigned to another section", async () => {
    const first = await read({ sectionId: "group-d", pageSize: 3 });
    if (!first?.page.hasNextPage) throw new Error("missing continuation");
    const boundary = first.items.at(-1)!.itemId;
    const source = sourceFor(placements.map((row) => row.placementId === boundary ? { ...row, sectionId: "group-e" } : row));
    await expect(read({ sectionId: "group-d", pageSize: 3, cursor: first.page.endCursor }, source))
      .rejects.toMatchObject({ code: "stale" });
    expect(source).toHaveBeenCalledOnce();
  });

  it("permits unrelated removals and later appends while retaining manual tie order", async () => {
    const rows = placements.map((row) => ({ ...row, order: Math.floor(row.order / 2) }));
    const first = await read({ sectionId: "group-d", pageSize: 3 }, sourceFor(rows));
    if (!first?.page.hasNextPage) throw new Error("missing continuation");
    const expected = rows.filter((row) => row.sectionId === "group-d").slice(3, 6);
    const source = sourceFor([...rows.filter((row) => row.placementId !== "item-01"),
      { ...rows[0], placementId: "appended", order: 100, sectionId: "group-d" }]);
    const page = await read({ sectionId: "group-d", pageSize: 3, cursor: first.page.endCursor }, source);
    expect(page?.items.map((item) => item.itemId)).toEqual(expected.map((row) => row.placementId));
  });

  it.each([undefined, "group-e"])("refuses missing/mismatched source acknowledgement %s", async (appliedSectionId) => {
    const source = vi.fn<ArticleEndGallerySource>(async ({ window }) => ({
      ...selectGalleryWindow(placements, window),
      ...(appliedSectionId === undefined ? {} : { appliedSectionId }),
    }));
    await expect(read({ sectionId: "group-d" }, source)).rejects.toThrow(TypeError);
    expect(source).toHaveBeenCalledOnce();
  });

  it("refuses a selected source result passed to All", async () => {
    const source = vi.fn<ArticleEndGallerySource>(async ({ window }) => ({
      ...selectGalleryWindow(placements, window), appliedSectionId: "group-d",
    }));
    await expect(read({}, source)).rejects.toThrow("did not acknowledge");
  });

  it("refuses out-of-section candidates even when the source acknowledges the selection", async () => {
    const source = vi.fn<ArticleEndGallerySource>(async ({ window }) => ({
      ...selectGalleryWindow(placements, window), appliedSectionId: "group-d",
    }));
    await expect(read({ sectionId: "group-d" }, source)).rejects.toThrow("row outside");
  });

  it("refuses an out-of-section boundary acknowledged as selected", async () => {
    const first = await read({ sectionId: "group-d", pageSize: 3 });
    if (!first?.page.hasNextPage) throw new Error("missing continuation");
    const source = vi.fn<ArticleEndGallerySource>(async ({ window }) => ({
      ...selectGalleryWindow(placements.filter((row) => row.sectionId === "group-d"), window),
      boundary: { ...placements[17], sectionId: "group-e" }, appliedSectionId: "group-d",
    }));
    await expect(read({ sectionId: "group-d", pageSize: 3, cursor: first.page.endCursor }, source))
      .rejects.toThrow("row outside");
  });

  it("preserves explicit source absence for selected queries", async () => {
    await expect(read({ sectionId: "group-d" }, vi.fn(async () => undefined))).resolves.toBeUndefined();
  });

  it.each(["", "a".repeat(MAX_SECTION_ID_LENGTH + 1), null, 1])(
    "rejects invalid resolved section case %# before a source read", async (sectionId) => {
      const source = sourceFor();
      await expect(read({ sectionId: sectionId as string }, source)).rejects.toThrow(TypeError);
      expect(source).not.toHaveBeenCalled();
    },
  );

  it("uses the full allowed generic identity rather than treating it as a slug", async () => {
    const sectionId = "s".repeat(MAX_SECTION_ID_LENGTH);
    const rows = placements.map((row) => ({ ...row, sectionId }));
    const source = sourceFor(rows);
    // sourceId is limited to 256, including the separator and locale.
    const query = { contentId: "c".repeat(190), locale: "l".repeat(65), endGalleryId: "e".repeat(128), sectionId };
    const first = await read(query, source);
    if (!first?.page.hasNextPage) throw new Error("missing continuation");
    expect((await read({ ...query, cursor: first.page.endCursor }, source))?.items).toHaveLength(17);
    const generic = "a:b";
    await expect(read({ sectionId: generic })).resolves.toMatchObject({ items: [] });
  });

  it.each(["", "e".repeat(129), null])("rejects an invalid selected gallery identity case %#", async (endGalleryId) => {
    const source = sourceFor();
    await expect(read({ sectionId: "group-d", endGalleryId: endGalleryId as string }, source)).rejects.toThrow(TypeError);
    expect(source).not.toHaveBeenCalled();
  });

  it("pins a literal selected digest and prevents ambiguous tuple concatenation", async () => {
    const capturing = { encode: vi.fn(codec.encode), decode: codec.decode };
    await read({ sectionId: "group-d", pageSize: 3 }, sourceFor(), capturing);
    expect(capturing.encode.mock.calls[0]?.[0].normalizedFilter)
      .toBe("article-end-section:3ccc6fb944066fb8cc5db9bef3c4a7fd5cc6b980367ed651fb2e7244b2927514");
    for (const [endGalleryId, sectionId, digest] of [
      ["a:b", "c", "358764dfbc5efad2c64674a46b3583737a21e87b1dd69ec6232d898e9f81ec27"],
      ["a", "b:c", "86182bd4092aab21f1101cdd6ee595dc53aa8cd52fc53aa0040221eed96ba549"],
    ]) {
      const rows = placements.map((row) => ({ ...row, sectionId }));
      capturing.encode.mockClear();
      await read({ endGalleryId, sectionId }, sourceFor(rows), capturing);
      expect(capturing.encode.mock.calls[0]?.[0].normalizedFilter).toBe(`article-end-section:${digest}`);
    }
  });

  it("accepts a literal legacy All token from the unchanged v2 payload/HMAC-v1 contract", async () => {
    // Independent Python HMAC fixture, no clock/expiry field, key = 32 lowercase a's.
    const token = "eyJ2ZXJzaW9uIjoyLCJxdWVyeVNjb3BlIjoiM2NUYkpwS2hBMGsyNHBYYVJON2FyTkUwMC1IQVUwR3RlZjFZSEFjTmY5USIsInZpc2liaWxpdHlTY29wZSI6Imc2XzlXNjlPOXlnUEVuVTNqb2c2V2VXbnNFZjBMaWNwM2VpbVF2VlpYcXciLCJhZnRlck9yZGVyIjoyMywiYWZ0ZXJQbGFjZW1lbnRJZCI6Iml0ZW0tMjQifQ.fktRTPtTmwLftQ0ecoZTJvvWDiI4pq6vs75qMiMPgnk";
    expect((await read({ cursor: token }))?.items.map((item) => item.itemId))
      .toEqual(placements.slice(24).map((row) => row.placementId));
    const first = await read();
    if (!first?.page.hasNextPage) throw new Error("missing continuation");
    expect(first.page.endCursor).toBe(token);
  });
});
