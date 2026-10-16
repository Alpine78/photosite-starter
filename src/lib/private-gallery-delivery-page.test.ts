import { describe, expect, it } from "vitest";
import { projectPrivateGalleryDeliveryPage } from "@/lib/private-gallery-delivery-page";
import { parsePrivateGalleryDeliveryResponse } from "@/lib/private-gallery-delivery-response";
import type { PrivateGalleryPlacement } from "@/lib/private-gallery";

const row = (index: number): PrivateGalleryPlacement => ({
  galleryId: "gallery", placementId: `item-${index}`, objectKey: `private/preview/${index}`,
  order: index, derivativeKind: "delivery-preview", nominalBytes: 1200, width: 1200, height: 1800,
});
function snapshot(totalCount: number, pageIndex: number) {
  return { totalCount, placements: Array.from({ length: Math.max(0, Math.min(100, totalCount - pageIndex * 100)) }, (_, i) => row(pageIndex * 100 + i)) };
}

describe("bounded delivery page projection", () => {
  it.each([[0, 0, 0, false], [205, 0, 100, true], [205, 1, 100, true], [205, 2, 5, false], [200, 1, 100, false], [1000, 9, 100, false]])(
    "projects count %i page %i without truncation", (count, index, length, hasNextPage) => {
      const page = projectPrivateGalleryDeliveryPage("gallery", index, snapshot(count, index));
      expect(page).toMatchObject({ pageIndex: index, totalCount: count, hasNextPage });
      expect(page?.items).toHaveLength(length);
      expect(JSON.stringify(page)).not.toMatch(/objectKey|private\/preview|galleryId|nominalBytes|order/);
      expect(parsePrivateGalleryDeliveryResponse({ ok: true, view: page }, index)).toEqual(page);
    },
  );
  it.each([[-1, 100], [1, 100], [10, 1000], [0.5, 200], [0, 1001], [0, -1], [0, 1.5]])(
    "refuses page %i count %i", (index, count) => {
      expect(projectPrivateGalleryDeliveryPage("gallery", index, snapshot(count, index))).toBeUndefined();
    },
  );
  it("refuses inconsistent counts, foreign rows and overlong windows", () => {
    expect(projectPrivateGalleryDeliveryPage("gallery", 0, undefined)).toBeUndefined();
    expect(projectPrivateGalleryDeliveryPage("gallery", 0, { totalCount: 2, placements: [row(0)] })).toBeUndefined();
    expect(projectPrivateGalleryDeliveryPage("gallery", 0, { totalCount: 1, placements: [{ ...row(0), galleryId: "other" }] })).toBeUndefined();
    expect(projectPrivateGalleryDeliveryPage("gallery", 0, { totalCount: 101, placements: Array.from({ length: 101 }, (_, i) => row(i)) })).toBeUndefined();
  });
  it("refuses malformed derivatives and duplicate identities instead of omitting photographs", () => {
    expect(() => projectPrivateGalleryDeliveryPage("gallery", 0, { totalCount: 1, placements: [{ ...row(0), width: 2049 }] })).toThrow();
    expect(() => projectPrivateGalleryDeliveryPage("gallery", 0, { totalCount: 2, placements: [row(0), row(0)] })).toThrow();
  });
});

describe("delivery response validation", () => {
  const valid = projectPrivateGalleryDeliveryPage("gallery", 0, snapshot(205, 0))!;
  it.each([null, {}, { ok: false }, { ok: true, view: null }])("refuses a non-success response %j", (value) => {
    expect(parsePrivateGalleryDeliveryResponse(value, 0)).toBeUndefined();
  });
  it.each([
    { pageIndex: 1 }, { totalCount: 1001 }, { hasNextPage: false }, { hasNextPage: "true" },
    { items: [] }, { items: Array.from({ length: 101 }, () => valid.items[0]) },
    { items: [null, ...valid.items.slice(1)] },
    { items: [{ ...valid.items[0], width: 2049 }, ...valid.items.slice(1)] },
    { items: [{ ...valid.items[0], alt: 123 }, ...valid.items.slice(1)] },
    { items: [valid.items[0], valid.items[0], ...valid.items.slice(2)] },
  ])("refuses malformed page data %j", (change) => {
    expect(parsePrivateGalleryDeliveryResponse({ ok: true, view: { ...valid, ...change } }, 0)).toBeUndefined();
  });
  it("projects known fields even from an unexpectedly extended JSON response", () => {
    const value = { ok: true, view: { ...valid, internal: "hidden", items: valid.items.map((item) => ({ ...item, objectKey: "hidden" })) } };
    expect(parsePrivateGalleryDeliveryResponse(value, 0)).toEqual(valid);
  });
});
