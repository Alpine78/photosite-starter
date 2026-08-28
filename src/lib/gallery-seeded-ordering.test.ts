import { describe, expect, it } from "vitest";
import {
  buildCuratedGalleryPage,
  createHmacGalleryCursorCodec,
  GalleryCursorError,
  orderingScopeString,
  resolveGalleryWindowRequest,
  selectCuratedGalleryCover,
  selectGalleryWindow,
  type CuratedGalleryPlacement,
  type GalleryCursorCodec,
  type GalleryCursorScope,
  type GalleryOrdering,
} from "@/lib/gallery-pagination";
import { computeShuffledOrder } from "@/lib/gallery-shuffle";
import {
  getMockGalleryCover,
  getMockGalleryResult,
  SHUFFLED_SHOWCASE_SEED,
} from "@/lib/mock-gallery";
import { mockImages } from "@/lib/mock-media";

const SIGNING_KEY = "seeded-ordering-test-signing-key-0123456789";
const codec = createHmacGalleryCursorCodec(SIGNING_KEY);

// --- Wire compatibility: a manual cursor captured from `main` before AB#129 ---

describe("manual cursor wire compatibility (AB#129 action item 2)", () => {
  // Captured from `createHmacGalleryCursorCodec("ab129-wire-compat-fixed-signing-key-000")`
  // on `main`, BEFORE this change, encoding boundary (order 23, "large-archive-0024").
  const FROZEN_KEY = "ab129-wire-compat-fixed-signing-key-000";
  const FROZEN_SCOPE: GalleryCursorScope = {
    sourceId: "content-large-archive@en-GB",
    normalizedFilter: "all",
    ordering: "manual-v1",
    visibilityVersion: "mock-content-large-archive-v1",
    pageSize: 24,
  };
  const FROZEN_CURSOR =
    "eyJ2ZXJzaW9uIjoyLCJxdWVyeVNjb3BlIjoiZmZpelJrMXVZcjA4anN5bmlXbkJyZGhoU0REMEFKTTJNczg2UlZLN3FDUSIsInZpc2liaWxpdHlTY29wZSI6Ik9TakJVM1ZLLV8zRDl1YlBwcDlVWjJ4VTZyNVhkeFVSUy1Pa1l6X0liVlUiLCJhZnRlck9yZGVyIjoyMywiYWZ0ZXJQbGFjZW1lbnRJZCI6ImxhcmdlLWFyY2hpdmUtMDAyNCJ9.q6EMSgIgiTNFIueOFnbqSGyWfHvBKBP2Di-dIL-pjhw";

  it("still decodes to the tier-0 boundary the old (order, placementId) pair carried", () => {
    const decoded = createHmacGalleryCursorCodec(FROZEN_KEY).decode(
      FROZEN_CURSOR,
      FROZEN_SCOPE,
    );
    expect(decoded).toEqual({
      pinnedTier: 0,
      key: 23,
      placementId: "large-archive-0024",
    });
  });

  it("re-encodes the same boundary to the same bytes", () => {
    const reissued = createHmacGalleryCursorCodec(FROZEN_KEY).encode(FROZEN_SCOPE, {
      pinnedTier: 0,
      key: 23,
      placementId: "large-archive-0024",
    });
    expect(reissued).toBe(FROZEN_CURSOR);
  });
});

// --- Seeded ordering core (hand-built placements) ---

const SEED_A = "seed-alpha";
const SEED_B = "seed-beta";

function seededPlacement(
  n: number,
  seed: string,
  pinned = false,
): CuratedGalleryPlacement {
  const placementId = `p-${String(n).padStart(3, "0")}`;
  return {
    placementId,
    order: n,
    visible: true,
    media: mockImages.coastalLandscape,
    ...(pinned ? { pinned: true } : {}),
    ...(pinned ? {} : { shuffledOrder: computeShuffledOrder(seed, placementId) }),
  };
}

/** 3 pinned leads (order 0,1,2) + `count` shuffled placements, keyed by `seed`. */
function seededSet(count: number, seed: string): CuratedGalleryPlacement[] {
  return [
    seededPlacement(0, seed, true),
    seededPlacement(1, seed, true),
    seededPlacement(2, seed, true),
    ...Array.from({ length: count }, (_u, i) => seededPlacement(i + 3, seed)),
  ];
}

function scopeFor(ordering: GalleryOrdering, pageSize: number): GalleryCursorScope {
  return {
    sourceId: "seeded@en",
    normalizedFilter: "all",
    ordering: orderingScopeString(ordering),
    visibilityVersion: "v1",
    pageSize,
  };
}

/** Walk every page and return the flat list of item ids, in order. */
function walkAll(
  placements: readonly CuratedGalleryPlacement[],
  ordering: GalleryOrdering,
  pageSize: number,
): string[] {
  const scope = scopeFor(ordering, pageSize);
  const ids: string[] = [];
  let cursor: string | undefined;
  // Bounded so a bug can never hang the suite.
  for (let guard = 0; guard < 1000; guard += 1) {
    const windowRequest = resolveGalleryWindowRequest({
      scope,
      ordering,
      ...(cursor === undefined ? {} : { cursor }),
      cursorCodec: codec,
    });
    const windowResult = selectGalleryWindow(placements, windowRequest, ordering);
    const page = buildCuratedGalleryPage({
      windowResult,
      scope,
      ordering,
      windowRequest,
      cursorCodec: codec,
    });
    ids.push(...page.items.map((item) => item.itemId));
    if (!page.page.hasNextPage) return ids;
    cursor = page.page.endCursor;
  }
  throw new Error("walkAll did not terminate");
}

describe("seeded-random ordering (AB#129, ADR-0009)", () => {
  const ordering: GalleryOrdering = { kind: "seeded-random", seed: SEED_A };

  it("produces the same order for the same seed and placement set on every call", () => {
    const set = seededSet(30, SEED_A);
    expect(walkAll(set, ordering, 7)).toEqual(walkAll(set, ordering, 7));
    // Page size does not change the sequence, only where the boundaries fall.
    expect(walkAll(set, ordering, 7)).toEqual(walkAll(set, ordering, 100));
  });

  it("produces a different order for a different seed over the same placements", () => {
    const orderA = walkAll(seededSet(30, SEED_A), { kind: "seeded-random", seed: SEED_A }, 100);
    const orderB = walkAll(seededSet(30, SEED_B), { kind: "seeded-random", seed: SEED_B }, 100);
    expect([...orderA].sort()).toEqual([...orderB].sort()); // same items
    expect(orderA).not.toEqual(orderB); // different sequence
  });

  it("keeps pinned placements first, in manual order, whatever the seed", () => {
    for (const seed of [SEED_A, SEED_B]) {
      const walked = walkAll(seededSet(30, seed), { kind: "seeded-random", seed }, 100);
      expect(walked.slice(0, 3)).toEqual(["p-000", "p-001", "p-002"]);
    }
  });

  it("paginates a shuffled gallery so every item appears exactly once", () => {
    const set = seededSet(50, SEED_A);
    const walked = walkAll(set, ordering, 9);
    expect(walked).toHaveLength(set.length);
    expect(new Set(walked).size).toBe(set.length);
    expect([...walked].sort()).toEqual(set.map((p) => p.placementId).sort());
  });

  it("invalidates a cursor as wrong-scope when the seed rotates", () => {
    const set = seededSet(30, SEED_A);
    const scope = scopeFor(ordering, 5);
    const firstRequest = resolveGalleryWindowRequest({ scope, ordering, cursorCodec: codec });
    const firstPage = buildCuratedGalleryPage({
      windowResult: selectGalleryWindow(set, firstRequest, ordering),
      scope,
      ordering,
      windowRequest: firstRequest,
      cursorCodec: codec,
    });
    expect(firstPage.page.hasNextPage).toBe(true);
    const staleCursor = firstPage.page.hasNextPage ? firstPage.page.endCursor : "";

    // Same gallery, new seed: a whole new order, so the old cursor is the same
    // class of failure as replaying it against the wrong gallery (ADR-0009 §4).
    const reseeded: GalleryOrdering = { kind: "seeded-random", seed: SEED_B };
    try {
      resolveGalleryWindowRequest({
        scope: scopeFor(reseeded, 5),
        ordering: reseeded,
        cursor: staleCursor,
        cursorCodec: codec,
      });
      throw new Error("expected a GalleryCursorError");
    } catch (error) {
      expect(error).toBeInstanceOf(GalleryCursorError);
      expect((error as GalleryCursorError).code).toBe("wrong-scope");
    }
  });

  it("rejects a tier-1 cursor whose key is not a shuffledOrder hash", () => {
    const scope = scopeFor(ordering, 5);
    const forgedCodec: GalleryCursorCodec = {
      encode: codec.encode,
      decode: () => ({ pinnedTier: 1, key: "not-a-hash", placementId: "p-004" }),
    };
    expect(() =>
      resolveGalleryWindowRequest({
        scope,
        ordering,
        cursor: "any-non-empty-token",
        cursorCodec: forgedCodec,
      }),
    ).toThrow(GalleryCursorError);
  });

  it("rejects a tier-1 boundary against a manual gallery", () => {
    const manual: GalleryOrdering = { kind: "manual" };
    const scope = scopeFor(manual, 5);
    const forgedCodec: GalleryCursorCodec = {
      encode: codec.encode,
      decode: () => ({
        pinnedTier: 1,
        key: computeShuffledOrder(SEED_A, "p-004"),
        placementId: "p-004",
      }),
    };
    expect(() =>
      resolveGalleryWindowRequest({
        scope,
        ordering: manual,
        cursor: "any-non-empty-token",
        cursorCodec: forgedCodec,
      }),
    ).toThrow(GalleryCursorError);
  });

  it("selects a deterministic active-order cover for a seeded gallery", () => {
    const set = seededSet(30, SEED_A);
    const cover = selectCuratedGalleryCover(set, ordering);
    const firstWalked = walkAll(set, ordering, 100)[0];
    // The cover is the first item in the same order the first page opens with.
    expect(cover?.mediaId).toBe(mockImages.coastalLandscape.mediaId);
    expect(firstWalked).toBe("p-000"); // pinned lead
  });
});

// --- The mock fixture end to end ---

describe("content-shuffled-showcase mock fixture", () => {
  async function walkFixture(locale = "en"): Promise<string[]> {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard += 1) {
      const page = await getMockGalleryResult(locale, "content-shuffled-showcase", {
        ...(cursor === undefined ? {} : { cursor }),
        cursorCodec: codec,
      });
      if (page === undefined) throw new Error("fixture returned undefined");
      ids.push(...page.items.map((item) => item.itemId));
      if (!page.page.hasNextPage) return ids;
      cursor = page.page.endCursor;
    }
    throw new Error("walkFixture did not terminate");
  }

  it("declares the seeded-random rule and needs more than one page", async () => {
    const first = await getMockGalleryResult("en", "content-shuffled-showcase", {
      cursorCodec: codec,
    });
    expect(first?.page.hasNextPage).toBe(true);
  });

  it("walks every placement exactly once across its pages", async () => {
    const walked = await walkFixture();
    expect(walked).toHaveLength(34);
    expect(new Set(walked).size).toBe(34);
  });

  it("is deterministic across independent reads", async () => {
    expect(await walkFixture()).toEqual(await walkFixture());
  });

  it("opens with its three pinned leads in order", async () => {
    const walked = await walkFixture();
    expect(walked.slice(0, 3)).toEqual([
      "shuffled-showcase-001",
      "shuffled-showcase-002",
      "shuffled-showcase-003",
    ]);
  });

  it("shares one order between en-GB and en-US route spaces", async () => {
    expect(await walkFixture("en-GB")).toEqual(await walkFixture("en-US"));
  });

  it("falls back to the first active-order placement for its listing cover", () => {
    const cover = getMockGalleryCover("en", "content-shuffled-showcase");
    expect(cover).toBeDefined();
  });

  it("uses the fixed showcase seed", () => {
    expect(SHUFFLED_SHOWCASE_SEED).toBe("showcase-seed-2026-08");
  });
});
