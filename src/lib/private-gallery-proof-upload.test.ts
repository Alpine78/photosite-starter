import { describe, expect, it } from "vitest";

import type { PrivateGallery } from "@/lib/private-gallery";
import { planPrivateGalleryFirstProofReady } from "@/lib/private-gallery-readiness";
import {
  verifyPrivateGalleryUpload,
  type PrivateGalleryCompletionOutcome,
} from "@/lib/private-gallery-upload-completion";
import {
  buildVerifiedFirstProofPlacements,
  PrivateGalleryProofUploadError,
} from "@/lib/private-gallery-proof-upload";
import {
  openPrivateGalleryUploadPreparation,
  type PrivateGalleryManifestEntry,
  type PrivateGalleryUploadPlan,
} from "@/lib/private-gallery-upload";

const NOW = new Date("2026-09-02T12:00:00.000Z");
const GALLERY: PrivateGallery = {
  galleryId: "gallery-1",
  galleryHandle: "opaque-handle",
  kind: "proof",
  state: "preparing",
  capabilityGeneration: 1,
  createdAt: NOW,
};

function proof(filename: string, mediaId: string): PrivateGalleryManifestEntry {
  return {
    kind: "derivative",
    derivativeKind: "watermarked-proof",
    filename,
    mediaId,
    nominalBytes: 900_000,
    width: 1200,
    height: 800,
  };
}

function plan(manifest: readonly PrivateGalleryManifestEntry[]): PrivateGalleryUploadPlan {
  return openPrivateGalleryUploadPreparation({
    galleryId: GALLERY.galleryId,
    galleryKind: "proof",
    state: "draft",
    keyPrefix: "private-galleries",
    preparationId: "prep-1",
    manifest,
    now: NOW,
  });
}

function complete(uploadPlan: PrivateGalleryUploadPlan): PrivateGalleryCompletionOutcome {
  return verifyPrivateGalleryUpload({
    preparation: uploadPlan.preparation,
    expected: uploadPlan.objects,
    receipts: [],
    observations: uploadPlan.objects.map((object) => ({
      objectKey: object.objectKey,
      sizeBytes: object.nominalBytes,
    })),
    keyPrefix: "private-galleries",
    now: NOW,
  });
}

describe("buildVerifiedFirstProofPlacements", () => {
  it("joins verified upload objects to their complete proof metadata", () => {
    const uploadPlan = plan([
      proof("IMG_10.JPG", "media-c"),
      proof("IMG_2.JPG", "media-b"),
      proof("IMG_2.JPG", "media-a"),
    ]);
    const completion = complete(uploadPlan);
    expect(completion.verified).toBe(true);

    const placements = buildVerifiedFirstProofPlacements(uploadPlan, completion);
    expect(placements.map((item) => item.filename)).toEqual([
      "IMG_10.JPG", "IMG_2.JPG", "IMG_2.JPG",
    ]);
    expect(placements.map((item) => item.order)).toEqual([1, 2, 3]);
    expect(placements.map((item) => item.mediaId)).toEqual([
      "media-c", "media-b", "media-a",
    ]);
    expect(placements.every((item) => item.reference === undefined)).toBe(true);
    expect(placements.map((item) => item.objectKey)).toEqual(
      uploadPlan.objects.map((object) => object.objectKey),
    );
  });

  it("feeds the first-ready plan with deterministic filename and media-ID references", () => {
    const entries = [
      proof("IMG_10.JPG", "media-c"),
      proof("IMG_2.JPG", "media-b"),
      proof("IMG_2.JPG", "media-a"),
    ];
    const referenceMap = (manifest: readonly PrivateGalleryManifestEntry[]) => {
      const uploadPlan = plan(manifest);
      const completion = complete(uploadPlan);
      if (!completion.verified) throw new Error("expected verified upload");
      const ready = planPrivateGalleryFirstProofReady({
        gallery: GALLERY,
        placements: buildVerifiedFirstProofPlacements(uploadPlan, completion),
        pricing: { includedCount: 2, extraUnitPriceMinor: 1250, currency: "EUR" },
        verifiedObjects: completion.objects,
      });
      if (!ready.ready) throw new Error("expected first-ready plan");
      expect(ready.lastAssignedOrdinal).toBe(3);
      return Object.fromEntries(ready.placements.map((item) => [item.mediaId, item.reference]));
    };

    expect(referenceMap(entries)).toEqual({
      "media-a": "001",
      "media-b": "002",
      "media-c": "003",
    });
    expect(referenceMap([...entries].reverse())).toEqual(referenceMap(entries));
  });

  it("refuses a failed completion without producing any placements", () => {
    const uploadPlan = plan([proof("IMG_1.JPG", "media-a")]);
    const completion = verifyPrivateGalleryUpload({
      preparation: uploadPlan.preparation,
      expected: uploadPlan.objects,
      receipts: [],
      observations: [],
      keyPrefix: "private-galleries",
      now: NOW,
    });
    expect(completion.verified).toBe(false);
    expect(() => buildVerifiedFirstProofPlacements(uploadPlan, completion)).toThrow(
      expect.objectContaining({ reason: "unverified-upload" }),
    );
  });

  it("refuses missing, extra, changed-size and duplicate verification objects", () => {
    const uploadPlan = plan([proof("IMG_1.JPG", "media-a")]);
    const completion = complete(uploadPlan);
    if (!completion.verified) throw new Error("expected verified upload");
    const [object] = completion.objects;

    for (const objects of [
      [],
      [object, { ...object, objectKey: "other-key" }],
      [{ ...object, sizeBytes: object.sizeBytes + 1 }],
      [{ ...object, objectKind: "preview" as const }],
      [object, object],
    ]) {
      expect(() => buildVerifiedFirstProofPlacements(
        uploadPlan,
        { verified: true, objects },
      )).toThrow(PrivateGalleryProofUploadError);
    }
  });

  it("refuses a delivery plan or a plan whose preparation keys differ", () => {
    const deliveryPlan = openPrivateGalleryUploadPreparation({
      galleryId: GALLERY.galleryId,
      galleryKind: "delivery",
      state: "draft",
      keyPrefix: "private-galleries",
      preparationId: "prep-2",
      manifest: [{
        kind: "derivative",
        derivativeKind: "delivery-preview",
        nominalBytes: 1000,
        width: 100,
        height: 100,
      }],
      now: NOW,
    });
    expect(() => buildVerifiedFirstProofPlacements(deliveryPlan, complete(deliveryPlan)))
      .toThrow(expect.objectContaining({ reason: "wrong-gallery-kind" }));

    const uploadPlan = plan([proof("IMG_1.JPG", "media-a")]);
    const altered = {
      ...uploadPlan,
      preparation: { ...uploadPlan.preparation, objectKeys: ["different-key"] },
    };
    expect(() => buildVerifiedFirstProofPlacements(altered, complete(uploadPlan)))
      .toThrow(expect.objectContaining({ reason: "plan-mismatch" }));
  });
});
