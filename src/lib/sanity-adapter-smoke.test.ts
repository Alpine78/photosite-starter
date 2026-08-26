import { describe, expect, it } from "vitest";

import {
  assertPrivateDatasetHasUsableReadToken,
  assertRouteConfigIsSelfContained,
  type GalleryPaginationPage,
  SanityAdapterSmokeConfigError,
  selectRepresentativePlacement,
  selectRepresentativePlacements,
  walkGalleryPagination,
} from "./sanity-adapter-smoke";

function fetcherFromPages(pages: readonly GalleryPaginationPage[]) {
  const byCursor = new Map<string | undefined, GalleryPaginationPage>();
  let cursor: string | undefined;
  for (const page of pages) {
    byCursor.set(cursor, page);
    cursor = page.endCursor ?? undefined;
  }
  return async (requestedCursor: string | undefined) => byCursor.get(requestedCursor);
}

describe("walkGalleryPagination", () => {
  it("reports a single-page gallery as completed with sawMultiPage false", async () => {
    const fetcher = fetcherFromPages([
      { items: [{ placementId: "a" }, { placementId: "b" }], hasNextPage: false, endCursor: null },
    ]);
    const outcome = await walkGalleryPagination(fetcher, { maxPages: 10 });
    expect(outcome).toEqual({ status: "completed", pageCount: 1, itemCount: 2, sawMultiPage: false });
  });

  it("reports a multi-page gallery as completed with sawMultiPage true, counting every item once", async () => {
    const fetcher = fetcherFromPages([
      { items: [{ placementId: "a" }], hasNextPage: true, endCursor: "cursor-1" },
      { items: [{ placementId: "b" }], hasNextPage: true, endCursor: "cursor-2" },
      { items: [{ placementId: "c" }], hasNextPage: false, endCursor: null },
    ]);
    const outcome = await walkGalleryPagination(fetcher, { maxPages: 10 });
    expect(outcome).toEqual({ status: "completed", pageCount: 3, itemCount: 3, sawMultiPage: true });
  });

  it("detects a placement id repeated across two pages", async () => {
    const fetcher = fetcherFromPages([
      { items: [{ placementId: "a" }], hasNextPage: true, endCursor: "cursor-1" },
      { items: [{ placementId: "a" }], hasNextPage: false, endCursor: null },
    ]);
    const outcome = await walkGalleryPagination(fetcher, { maxPages: 10 });
    expect(outcome).toEqual({ status: "duplicate-placement", placementId: "a", pageCount: 2 });
  });

  it("detects a cursor repeated across two pages", async () => {
    // A pathological fetcher that always hands back the same cursor, so the
    // walk must detect the repeat itself rather than looping forever.
    let calls = 0;
    const fetcher = async (): Promise<GalleryPaginationPage> => {
      calls += 1;
      return { items: [{ placementId: `item-${calls}` }], hasNextPage: true, endCursor: "same-cursor" };
    };
    const outcome = await walkGalleryPagination(fetcher, { maxPages: 10 });
    expect(outcome).toEqual({ status: "repeated-cursor", cursor: "same-cursor", pageCount: 2 });
  });

  it("stops at the hard cap rather than looping forever, and reports it as a distinct failure", async () => {
    let calls = 0;
    const fetcher = async (): Promise<GalleryPaginationPage> => {
      calls += 1;
      return { items: [{ placementId: `item-${calls}` }], hasNextPage: true, endCursor: `cursor-${calls}` };
    };
    const outcome = await walkGalleryPagination(fetcher, { maxPages: 3 });
    expect(outcome).toEqual({ status: "hard-cap-reached", pageCount: 3 });
  });

  it("reports a gallery that vanishes mid-walk distinctly from completion", async () => {
    const fetcher = async () => undefined;
    const outcome = await walkGalleryPagination(fetcher, { maxPages: 10 });
    expect(outcome).toEqual({ status: "vanished" });
  });

  it("throws if a page claims hasNextPage without an endCursor, rather than silently stopping", async () => {
    const fetcher = fetcherFromPages([{ items: [], hasNextPage: true, endCursor: null }]);
    await expect(walkGalleryPagination(fetcher, { maxPages: 10 })).rejects.toThrow(/endCursor/);
  });
});

describe("selectRepresentativePlacement", () => {
  it("picks the lexicographically smallest published contentId, deterministically", () => {
    const placements = [
      { contentId: "zebra", published: true },
      { contentId: "apple", published: true },
      { contentId: "mango", published: true },
    ];
    expect(selectRepresentativePlacement(placements)?.contentId).toBe("apple");
  });

  it("ignores unpublished placements", () => {
    const placements = [
      { contentId: "apple", published: false },
      { contentId: "mango", published: true },
    ];
    expect(selectRepresentativePlacement(placements)?.contentId).toBe("mango");
  });

  it("returns undefined when nothing is published", () => {
    expect(selectRepresentativePlacement([{ contentId: "apple", published: false }])).toBeUndefined();
  });

  it("returns undefined for an empty list", () => {
    expect(selectRepresentativePlacement([])).toBeUndefined();
  });
});

describe("selectRepresentativePlacements", () => {
  it("returns every published placement, sorted ascending by contentId", () => {
    const placements = [
      { contentId: "zebra", published: true },
      { contentId: "apple", published: false },
      { contentId: "mango", published: true },
    ];
    expect(selectRepresentativePlacements(placements).map((p) => p.contentId)).toEqual([
      "mango",
      "zebra",
    ]);
  });

  it("returns an empty array when nothing is published", () => {
    expect(selectRepresentativePlacements([{ contentId: "apple", published: false }])).toEqual([]);
  });
});

describe("assertRouteConfigIsSelfContained", () => {
  it("passes when both route config keys are present", () => {
    expect(() =>
      assertRouteConfigIsSelfContained(
        { SITE_LOCALE: "fi-FI", SITE_LOCALE_ROUTES: "fi-FI,en-GB" },
        "/env/file",
      ),
    ).not.toThrow();
  });

  it("throws naming every missing key when both are absent", () => {
    expect(() => assertRouteConfigIsSelfContained({}, "/env/file")).toThrow(
      SanityAdapterSmokeConfigError,
    );
  });

  it("throws when only one of the two keys is present", () => {
    expect(() =>
      assertRouteConfigIsSelfContained({ SITE_LOCALE: "fi-FI" }, "/env/file"),
    ).toThrow(/SITE_LOCALE_ROUTES/);
  });
});

describe("assertPrivateDatasetHasUsableReadToken", () => {
  it("does nothing for a public dataset regardless of token presence", () => {
    expect(() => assertPrivateDatasetHasUsableReadToken({}, "public", "/env/file")).not.toThrow();
  });

  it("throws when private and the token is missing", () => {
    expect(() => assertPrivateDatasetHasUsableReadToken({}, "private", "/env/file")).toThrow(
      SanityAdapterSmokeConfigError,
    );
  });

  it("throws when private and the token is blank", () => {
    expect(() =>
      assertPrivateDatasetHasUsableReadToken({ SANITY_READ_TOKEN: "   " }, "private", "/env/file"),
    ).toThrow(SanityAdapterSmokeConfigError);
  });

  it("throws when private and the token is Vercel's redacted placeholder", () => {
    expect(() =>
      assertPrivateDatasetHasUsableReadToken(
        { SANITY_READ_TOKEN: "[SENSITIVE]" },
        "private",
        "/env/file",
      ),
    ).toThrow(SanityAdapterSmokeConfigError);
  });

  it("passes when private and a real token is present", () => {
    expect(() =>
      assertPrivateDatasetHasUsableReadToken({ SANITY_READ_TOKEN: "sk_real_token" }, "private", "/env/file"),
    ).not.toThrow();
  });
});
