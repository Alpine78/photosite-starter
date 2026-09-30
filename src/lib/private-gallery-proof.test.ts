import { describe, expect, it } from "vitest";

import type { PrivateGalleryProofPlacement } from "@/lib/private-gallery";
import {
  assignAddedProofReferences,
  assignInitialProofReferences,
  compareProofFilenames,
  confirmPrivateGalleryProofSelection,
  editPrivateGalleryProofDraft,
  PrivateGalleryProofError,
  planPrivateGalleryProofResend,
  reopenPrivateGalleryProofSelection,
  summarizePrivateGalleryProofSelection,
  validatePrivateGalleryProofPricing,
} from "@/lib/private-gallery-proof";

function proof(
  placementId: string,
  filename: string,
  mediaId = placementId,
  reference?: string,
): PrivateGalleryProofPlacement {
  return {
    galleryId: "gallery-a",
    placementId,
    filename,
    mediaId,
    reference,
    objectKey: "opaque/" + placementId,
    derivativeKind: "watermarked-proof",
    order: 0,
    nominalBytes: 1000,
    width: 1200,
    height: 800,
  };
}

const pricing = {
  includedCount: 2,
  extraUnitPriceMinor: 1250,
  currency: "EUR",
} as const;

function reason(fn: () => unknown, expected: string) {
  try {
    fn();
    throw new Error("expected refusal");
  } catch (error) {
    expect(error).toBeInstanceOf(PrivateGalleryProofError);
    expect((error as PrivateGalleryProofError).reason).toBe(expected);
    expect((error as Error).message).not.toMatch(/IMG|DSC|gallery-a/);
  }
}

describe("AB#130 proof references", () => {
  it("uses natural ascending complete filenames, including mixed camera prefixes", () => {
    const input = [
      proof("c", "IMG_0010.JPG"),
      proof("a", "DSC_0002.JPG"),
      proof("e", "IMG_2.JPG"),
      proof("b", "DSC_0010.JPG"),
      proof("d", "IMG_0002.JPG"),
      proof("f", "IMG_10.JPG"),
    ];
    const assigned = assignInitialProofReferences(input);
    expect(assigned.map((item) => item.reference)).toEqual([
      "005", "001", "004", "002", "003", "006",
    ]);
    expect(input.every((item) => item.reference === undefined)).toBe(true);
    expect(compareProofFilenames("IMG_2.JPG", "IMG_10.JPG")).toBeLessThan(0);
  });

  it("breaks duplicate filenames by stable media identity", () => {
    const assigned = assignInitialProofReferences([
      proof("first", "IMG_0001.JPG", "media-z"),
      proof("second", "IMG_0001.JPG", "media-a"),
    ]);
    expect(assigned.map((item) => item.reference)).toEqual(["002", "001"]);
  });

  it("never renumbers on reordering, deletion or later addition", () => {
    const initial = assignInitialProofReferences([
      proof("p1", "IMG_0001.JPG"),
      proof("p2", "IMG_0002.JPG"),
      proof("p3", "IMG_0003.JPG"),
    ]);
    const added = assignAddedProofReferences({
      existing: [initial[2], initial[0]],
      additions: [proof("p5", "IMG_0000.JPG"), proof("p4", "IMG_0010.JPG")],
      lastAssignedOrdinal: 3,
    });
    expect(initial.map((item) => item.reference)).toEqual(["001", "002", "003"]);
    expect(added.map((item) => item.reference)).toEqual(["004", "005"]);
    expect(initial[0].reference).toBe("001");
    expect(initial[2].reference).toBe("003");
  });

  it("rejects collisions, stale high-water marks and oversized sets", () => {
    reason(() => assignInitialProofReferences([
      proof("a", "a.jpg", "same"),
      proof("b", "b.jpg", "same"),
    ]), "duplicate-identity");
    reason(() => assignAddedProofReferences({
      existing: [proof("a", "a.jpg", "a", "003")],
      additions: [proof("b", "b.jpg")],
      lastAssignedOrdinal: 2,
    }), "invalid-input");
    reason(() => assignInitialProofReferences(
      Array.from({ length: 1001 }, (_, i) => proof(String(i), String(i))),
    ), "too-many-files");
  });
});

describe("AB#130 proof pricing and confirmation", () => {
  const placements = assignInitialProofReferences([
    proof("a", "IMG_0001.JPG", "media-a"),
    proof("b", "IMG_0002.JPG", "media-b"),
    proof("c", "IMG_0003.JPG", "media-c"),
  ]);

  it("snapshots non-negative terms and computes extras in integer minor units", () => {
    expect(validatePrivateGalleryProofPricing(pricing)).toEqual(pricing);
    expect(summarizePrivateGalleryProofSelection(pricing, 3)).toEqual({
      ...pricing,
      selectedCount: 3,
      extraCount: 1,
      extraTotalMinor: 1250,
    });
    expect(summarizePrivateGalleryProofSelection(pricing, 0).extraTotalMinor).toBe(0);
    expect(summarizePrivateGalleryProofSelection({
      includedCount: 10,
      extraUnitPriceMinor: 0,
      currency: "EUR",
    }, 3).extraCount).toBe(0);
    reason(() => validatePrivateGalleryProofPricing({ ...pricing, includedCount: -1 }), "invalid-input");
    reason(() => validatePrivateGalleryProofPricing({ ...pricing, extraUnitPriceMinor: -1 }), "invalid-input");
    reason(() => validatePrivateGalleryProofPricing({ ...pricing, currency: "eur" }), "invalid-input");
    reason(() => summarizePrivateGalleryProofSelection({
      ...pricing,
      extraUnitPriceMinor: Number.MAX_SAFE_INTEGER,
    }, 4), "overflow");
  });

  it("rejects stale edits, duplicate or foreign references and confirmed edits", () => {
    const draft = { galleryId: "gallery-a", revision: 2, selectedReferences: ["001"], confirmed: false };
    reason(() => editPrivateGalleryProofDraft({
      galleryId: "gallery-a",
      draft, expectedRevision: 1, selectedReferences: ["001"], placements,
    }), "stale-revision");
    reason(() => editPrivateGalleryProofDraft({
      galleryId: "gallery-a",
      draft, expectedRevision: 2, selectedReferences: ["001", "001"], placements,
    }), "duplicate-reference");
    reason(() => editPrivateGalleryProofDraft({
      galleryId: "gallery-a",
      draft, expectedRevision: 2, selectedReferences: ["999"], placements,
    }), "unknown-reference");
    reason(() => editPrivateGalleryProofDraft({
      galleryId: "gallery-a",
      draft,
      expectedRevision: 2,
      selectedReferences: [123 as never],
      placements,
    }), "invalid-input");
    reason(() => editPrivateGalleryProofDraft({
      galleryId: "gallery-b",
      draft,
      expectedRevision: 2,
      selectedReferences: ["001"],
      placements,
    }), "invalid-input");
    reason(() => editPrivateGalleryProofDraft({
      galleryId: "gallery-a",
      draft: { ...draft, galleryId: "gallery-b" },
      expectedRevision: 2,
      selectedReferences: ["001"],
      placements,
    }), "invalid-input");
    reason(() => editPrivateGalleryProofDraft({
      galleryId: "gallery-a",
      draft: { ...draft, confirmed: true },
      expectedRevision: 2, selectedReferences: [], placements,
    }), "already-confirmed");
    expect(editPrivateGalleryProofDraft({
      galleryId: "gallery-a",
      draft, expectedRevision: 2, selectedReferences: ["003", "001"], placements,
    })).toEqual({
      galleryId: "gallery-a", revision: 3,
      selectedReferences: ["003", "001"], confirmed: false,
    });
  });

  it("captures a versioned immutable-content snapshot and one initial outbox identity", () => {
    const original = { galleryId: "gallery-a", revision: 4, selectedReferences: ["003", "001"], confirmed: false };
    const now = new Date("2026-09-30T10:00:00.000Z");
    const result = confirmPrivateGalleryProofSelection({
      galleryId: "gallery-a",
      draft: original,
      expectedRevision: 4,
      previousVersion: 1,
      pricing,
      placements,
      now,
    });
    expect(result.draft).toEqual({
      galleryId: "gallery-a",
      revision: 5, selectedReferences: ["003", "001"], confirmed: true,
    });
    expect(result.confirmation).toEqual({
      galleryId: "gallery-a",
      version: 2,
      confirmedAt: now,
      summary: { ...pricing, selectedCount: 2, extraCount: 0, extraTotalMinor: 0 },
      selectedImages: [
        { reference: "003", filename: "IMG_0003.JPG", mediaId: "media-c" },
        { reference: "001", filename: "IMG_0001.JPG", mediaId: "media-a" },
      ],
    });
    expect(result.outboxIdempotencyKey).toBe("proof-confirmation:gallery-a:2");
    expect(planPrivateGalleryProofResend({
      confirmation: result.confirmation,
      attemptId: "attempt-1",
    })).toEqual({
      confirmationVersion: 2,
      outboxIdempotencyKey: "proof-confirmation-resend:gallery-a:2:attempt-1",
    });

    expect(original.confirmed).toBe(false);
    reason(() => confirmPrivateGalleryProofSelection({
      galleryId: "gallery-a",
      draft: result.draft,
      expectedRevision: 5,
      previousVersion: 2,
      pricing,
      placements,
      now,
    }), "already-confirmed");
  });

  it("rejects a confirmation with a foreign draft or placement set", () => {
    const draft = {
      galleryId: "gallery-a",
      revision: 0,
      selectedReferences: ["001"],
      confirmed: false,
    };
    reason(() => confirmPrivateGalleryProofSelection({
      galleryId: "gallery-a",
      draft: { ...draft, galleryId: "gallery-b" },
      expectedRevision: 0,
      previousVersion: 0,
      pricing,
      placements,
      now: new Date(),
    }), "invalid-input");
    reason(() => confirmPrivateGalleryProofSelection({
      galleryId: "gallery-b",
      draft: { ...draft, galleryId: "gallery-b" },
      expectedRevision: 0,
      previousVersion: 0,
      pricing,
      placements,
      now: new Date(),
    }), "invalid-input");
  });

  it("reopens without changing expiry or prior confirmation", () => {
    const accessExpiresAt = new Date("2027-03-30T10:00:00.000Z");
    const previous = { galleryId: "gallery-a", revision: 5, selectedReferences: ["003"], confirmed: true };
    const reopened = reopenPrivateGalleryProofSelection({ draft: previous, accessExpiresAt });
    expect(reopened.draft).toEqual({
      galleryId: "gallery-a",
      revision: 6, selectedReferences: ["003"], confirmed: false,
    });
    expect(reopened.accessExpiresAt).toEqual(accessExpiresAt);
    expect(reopened.accessExpiresAt).not.toBe(accessExpiresAt);
    expect(previous.confirmed).toBe(true);
  });
});
