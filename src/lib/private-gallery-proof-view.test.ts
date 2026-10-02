import { describe, expect, it } from "vitest";

import type { PrivateGallery, PrivateGalleryProofPlacement } from "@/lib/private-gallery";
import { summarizePrivateGalleryProofSelection } from "@/lib/private-gallery-proof";
import type { PrivateGalleryProofStoredState } from "@/lib/private-gallery-proof-store";
import {
  PrivateGalleryProofViewError,
  projectPrivateGalleryProofView,
} from "@/lib/private-gallery-proof-view";

const NOW = new Date("2026-09-30T10:00:00.000Z");
const PRICING = { includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR" };

function placement(index: number): PrivateGalleryProofPlacement {
  return {
    galleryId: "gallery-a",
    placementId: `placement-${index}`,
    mediaId: `media-${index}`,
    filename: `IMG_${String(index).padStart(4, "0")}.JPG`,
    reference: String(index).padStart(3, "0"),
    objectKey: `private/gallery-a/${index}`,
    derivativeKind: "watermarked-proof",
    order: index,
    nominalBytes: 1000,
    width: 1200,
    height: 800,
  };
}

function state(count = 2): PrivateGalleryProofStoredState {
  const gallery: PrivateGallery = {
    galleryId: "gallery-a",
    galleryHandle: "private-handle",
    kind: "proof",
    state: "published",
    capabilityGeneration: 1,
    createdAt: new Date("2026-09-29T10:00:00.000Z"),
    publishedAt: new Date("2026-09-29T10:00:00.000Z"),
    accessExpiresAt: new Date("2027-03-30T10:00:00.000Z"),
  };
  return {
    gallery,
    pricingSnapshot: PRICING,
    placements: Array.from({ length: count }, (_, index) => placement(index + 1)),
    draft: { galleryId: gallery.galleryId, revision: 2, selectedReferences: ["002", "001"], confirmed: false },
    latestConfirmationVersion: 0,
  };
}

function confirmedState(): PrivateGalleryProofStoredState {
  const original = state();
  return {
    ...original,
    draft: { ...original.draft, confirmed: true },
    latestConfirmationVersion: 1,
    currentConfirmation: {
      galleryId: original.gallery.galleryId,
      version: 1,
      confirmedAt: NOW,
      selectedImages: [
        { reference: "002", filename: "IMG_0002.JPG", mediaId: "media-2" },
        { reference: "001", filename: "IMG_0001.JPG", mediaId: "media-1" },
      ],
      summary: summarizePrivateGalleryProofSelection(PRICING, 2),
    },
  };
}

function expectRedactedFailure(stateToRead: PrivateGalleryProofStoredState): void {
  try {
    projectPrivateGalleryProofView(stateToRead, 0);
    throw new Error("expected projection failure");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateGalleryProofViewError);
    expect((error as PrivateGalleryProofViewError).reason).toBe("malformed-record");
    expect((error as Error).message).not.toMatch(/gallery-a|IMG_|media-|private\/gallery/);
  }
}

describe("AB#130 browser-safe proof view", () => {
  it("shows the current draft and frozen pricing without server-only fields", () => {
    const view = projectPrivateGalleryProofView(state(), 0);

    expect(view).toMatchObject({
      revision: 2,
      confirmed: false,
      pageIndex: 0,
      totalCount: 2,
      hasNextPage: false,
      summary: { includedCount: 1, selectedCount: 2, extraCount: 1,
        extraUnitPriceMinor: 1250, extraTotalMinor: 1250, currency: "EUR" },
      selectedImages: [
        { reference: "002", filename: "IMG_0002.JPG" },
        { reference: "001", filename: "IMG_0001.JPG" },
      ],
    });
    expect(view.items).toEqual([
      { itemId: "placement-1", derivativeKind: "watermarked-proof", width: 1200, height: 800,
        reference: "001", filename: "IMG_0001.JPG", selected: true },
      { itemId: "placement-2", derivativeKind: "watermarked-proof", width: 1200, height: 800,
        reference: "002", filename: "IMG_0002.JPG", selected: true },
    ]);
    expect(JSON.stringify(view)).not.toMatch(/objectKey|private\/gallery|mediaId|nominalBytes|galleryId|private-handle/);
  });

  it("pages at 100 while checking every raw row before returning any page", () => {
    const many = { ...state(101), draft: { galleryId: "gallery-a", revision: 0,
      selectedReferences: [], confirmed: false } };
    const first = projectPrivateGalleryProofView(many, 0);
    const second = projectPrivateGalleryProofView(many, 1);
    expect(first.items).toHaveLength(100);
    expect(first.hasNextPage).toBe(true);
    expect(second.items).toHaveLength(1);
    expect(second.hasNextPage).toBe(false);
    expect(() => projectPrivateGalleryProofView(many, 2)).toThrow(PrivateGalleryProofViewError);
    expectRedactedFailure({ ...many, placements: [
      ...many.placements.slice(0, 100), { ...many.placements[100], width: 3000 },
    ] });
  });

  it("reviews an immutable confirmation after a selected current placement is removed", () => {
    const confirmed = confirmedState();
    const view = projectPrivateGalleryProofView({
      ...confirmed,
      placements: [placement(2)],
    }, 0);

    expect(view).toMatchObject({
      confirmed: true,
      confirmationVersion: 1,
      confirmedAt: NOW.toISOString(),
      totalCount: 1,
      selectedImages: [
        { reference: "002", filename: "IMG_0002.JPG" },
        { reference: "001", filename: "IMG_0001.JPG" },
      ],
      summary: { selectedCount: 2, extraCount: 1, extraTotalMinor: 1250 },
    });
    expect(view.items[0]).toMatchObject({ reference: "002", selected: true });
  });

  it("refuses missing or inconsistent confirmation snapshots", () => {
    const confirmed = confirmedState();
    expectRedactedFailure({ ...confirmed, currentConfirmation: undefined });
    expectRedactedFailure({ ...confirmed, currentConfirmation: {
      ...confirmed.currentConfirmation!,
      summary: { ...confirmed.currentConfirmation!.summary, extraTotalMinor: 0 },
    } });
    expectRedactedFailure({ ...confirmed, currentConfirmation: {
      ...confirmed.currentConfirmation!,
      selectedImages: [confirmed.currentConfirmation!.selectedImages[1], confirmed.currentConfirmation!.selectedImages[0]],
    } });
  });

  it("refuses inconsistent draft references and unexpected confirmation data", () => {
    const open = state();
    expectRedactedFailure({ ...open, draft: { ...open.draft, selectedReferences: ["999"] } });
    expectRedactedFailure({ ...open, draft: { ...open.draft, selectedReferences: ["001", "001"] } });
    expectRedactedFailure({ ...open, currentConfirmation: confirmedState().currentConfirmation });
    expectRedactedFailure({ ...open, placements: [
      open.placements[0], { ...open.placements[1], reference: "001" },
    ] });
  });
});
