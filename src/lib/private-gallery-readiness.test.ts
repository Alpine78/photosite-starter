import { describe, expect, it } from "vitest";

import {
  PRIVATE_GALLERY_STATES,
  type PrivateGallery,
  type PrivateGalleryProofPlacement,
} from "@/lib/private-gallery";
import {
  evaluatePrivateGalleryReadiness,
  planPrivateGalleryFirstProofReady,
  type PrivateGalleryProofReadinessData,
} from "@/lib/private-gallery-readiness";
import type { PrivateGalleryVerifiedObject } from "@/lib/private-gallery-upload-completion";

const ZIP_KEY = "private/g/gallery-1/zip/aaaa";

const GALLERY: PrivateGallery = {
  galleryId: "gallery-1",
  galleryHandle: "handle-1",
  kind: "delivery",
  state: "preparing",
  capabilityGeneration: 1,
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  activeZipObjectKey: ZIP_KEY,
};

const preview: PrivateGalleryVerifiedObject = {
  objectKey: "private/g/gallery-1/preview/aaaa",
  objectKind: "preview",
  sizeBytes: 1_500_000,
};
const proof: PrivateGalleryVerifiedObject = {
  objectKey: "private/g/gallery-1/proof/aaaa",
  objectKind: "proof",
  sizeBytes: 900_000,
};
const zip: PrivateGalleryVerifiedObject = {
  objectKey: ZIP_KEY,
  objectKind: "zip",
  sizeBytes: 4_000_000_000,
};

const evaluate = (
  gallery: Partial<PrivateGallery>,
  verifiedObjects: readonly PrivateGalleryVerifiedObject[],
  proofData?: PrivateGalleryProofReadinessData,
) =>
  evaluatePrivateGalleryReadiness({
    gallery: { ...GALLERY, ...gallery },
    verifiedObjects,
    ...(proofData === undefined ? {} : { proof: proofData }),
  });

describe("a delivery gallery", () => {
  it("is ready with derivatives and a verified ZIP the pointer names", () => {
    expect(evaluate({}, [preview, zip])).toEqual({ ready: true });
  });

  it("is not ready without a ZIP", () => {
    // Publishing one would hand a customer a gallery whose entire promise —
    // download everything as one package — is missing, and they could not tell
    // that from a gallery that had simply not finished loading.
    expect(evaluate({}, [preview])).toEqual({
      ready: false,
      blockers: ["no-verified-zip"],
    });
  });

  it("is not ready when the pointer names something other than the verified ZIP", () => {
    // The pointer is what a signed URL is minted against, so this would publish
    // a download of bytes nothing vouched for.
    expect(
      evaluate({ activeZipObjectKey: "private/g/gallery-1/zip/older" }, [
        preview,
        zip,
      ]),
    ).toEqual({ ready: false, blockers: ["zip-pointer-unverified"] });
  });

  it("is not ready while the pointer swap has not been committed", () => {
    const withoutPointer: PrivateGallery = { ...GALLERY };
    delete (withoutPointer as { activeZipObjectKey?: string }).activeZipObjectKey;

    expect(
      evaluatePrivateGalleryReadiness({
        gallery: withoutPointer,
        verifiedObjects: [preview, zip],
      }),
    ).toEqual({ ready: false, blockers: ["zip-pointer-unverified"] });
  });

  it("is not ready with a ZIP but nothing to view", () => {
    expect(evaluate({}, [zip])).toEqual({
      ready: false,
      blockers: ["no-derivatives"],
    });
  });

  it("reports every blocker at once, not just the first", () => {
    // An administrator fixing one missing thing at a time, only to be told
    // about the next, is how a publication takes four attempts instead of one.
    expect(evaluate({}, [])).toEqual({
      ready: false,
      blockers: ["no-derivatives", "no-verified-zip"],
    });
  });

  it("requires a delivery preview even when a proof and ZIP are present", () => {
    expect(evaluate({}, [proof, zip])).toEqual({
      ready: false,
      blockers: ["no-derivatives"],
    });
  });
});

const PROOF_GALLERY: PrivateGallery = {
  ...GALLERY,
  kind: "proof",
  activeZipObjectKey: undefined,
};
const pricing = {
  includedCount: 2,
  extraUnitPriceMinor: 1250,
  currency: "EUR",
} as const;
const proofPlacement: PrivateGalleryProofPlacement = {
  galleryId: GALLERY.galleryId,
  placementId: "placement-1",
  mediaId: "media-1",
  filename: "IMG_0002.JPG",
  objectKey: proof.objectKey,
  derivativeKind: "watermarked-proof",
  reference: "001",
  order: 1,
  nominalBytes: proof.sizeBytes,
  width: 1200,
  height: 800,
};
const proofData: PrivateGalleryProofReadinessData = {
  pricingSnapshot: pricing,
  placements: [proofPlacement],
};

describe("a proof gallery", () => {
  it("needs a frozen price and permanently referenced, verified proof set", () => {
    expect(evaluate(PROOF_GALLERY, [proof], proofData)).toEqual({ ready: true });
    expect(evaluate(PROOF_GALLERY, [proof])).toEqual({
      ready: false,
      blockers: ["proof-data-missing"],
    });
  });

  it("refuses missing, changed and unrepresented proof objects", () => {
    expect(evaluate(PROOF_GALLERY, [], proofData)).toEqual({
      ready: false,
      blockers: ["no-derivatives", "proof-objects-mismatch"],
    });
    expect(evaluate(PROOF_GALLERY, [{ ...proof, sizeBytes: 1 }], proofData)).toEqual({
      ready: false,
      blockers: ["proof-objects-mismatch"],
    });
    expect(evaluate(PROOF_GALLERY, [proof, {
      objectKey: "private/g/gallery-1/proof/extra",
      objectKind: "proof",
      sizeBytes: 1000,
    }], proofData)).toEqual({
      ready: false,
      blockers: ["proof-objects-mismatch"],
    });
  });

  it("refuses a ZIP or delivery preview in the proof set", () => {
    expect(evaluate(PROOF_GALLERY, [proof, zip], proofData)).toEqual({
      ready: false,
      blockers: ["proof-objects-mismatch"],
    });
    expect(evaluate(PROOF_GALLERY, [preview], proofData)).toEqual({
      ready: false,
      blockers: ["no-derivatives", "proof-objects-mismatch"],
    });
  });

  it("refuses invalid pricing, misplaced or duplicated references and wrong gallery", () => {
    expect(evaluate(PROOF_GALLERY, [proof], {
      ...proofData,
      pricingSnapshot: { ...pricing, includedCount: -1 },
    })).toEqual({ ready: false, blockers: ["proof-pricing-invalid"] });
    for (const changed of [
      { reference: undefined },
      { reference: "002" },
      { galleryId: "other-gallery" },
      { derivativeKind: "delivery-preview" as const },
      { width: 4096 },
    ]) {
      expect(evaluate(PROOF_GALLERY, [proof], {
        ...proofData,
        placements: [
          { ...proofPlacement, ...changed } as unknown as PrivateGalleryProofPlacement,
        ],
      })).toEqual({ ready: false, blockers: ["proof-placements-invalid"] });
    }
    const second = {
      ...proofPlacement,
      placementId: "placement-2",
      mediaId: "media-2",
      objectKey: "private/g/gallery-1/proof/bbbb",
    };
    expect(evaluate(PROOF_GALLERY, [proof], {
      ...proofData,
      placements: [proofPlacement, second],
    }).ready).toBe(false);
  });

  it("plans one atomic first-ready transition only after the entire set is verified", () => {
    const second: PrivateGalleryProofPlacement = {
      ...proofPlacement,
      placementId: "placement-2",
      mediaId: "media-2",
      filename: "IMG_0001.JPG",
      objectKey: "private/g/gallery-1/proof/bbbb",
      reference: undefined,
    };
    const secondObject: PrivateGalleryVerifiedObject = {
      objectKey: second.objectKey,
      objectKind: "proof",
      sizeBytes: second.nominalBytes,
    };
    const input = [{ ...proofPlacement, reference: undefined }, second];
    const incomplete = planPrivateGalleryFirstProofReady({
      gallery: PROOF_GALLERY,
      placements: input,
      pricing,
      verifiedObjects: [proof],
    });
    expect(incomplete).toEqual({
      ready: false,
      blockers: ["proof-objects-mismatch"],
    });
    expect(input.every((item) => item.reference === undefined)).toBe(true);

    const plan = planPrivateGalleryFirstProofReady({
      gallery: PROOF_GALLERY,
      placements: input,
      pricing,
      verifiedObjects: [proof, secondObject],
    });
    expect(plan.ready).toBe(true);
    if (!plan.ready) return;
    expect(plan.nextState).toBe("ready");
    expect(plan.pricingSnapshot).toEqual(pricing);
    expect(plan.pricingSnapshot).not.toBe(pricing);
    expect(plan.placements.map((item) => item.reference)).toEqual(["002", "001"]);
    expect(plan.lastAssignedOrdinal).toBe(2);
    expect(input.every((item) => item.reference === undefined)).toBe(true);
  });

  it("never reassigns an existing or partially assigned reference", () => {
    for (const state of ["preparing", "ready", "published"] as const) {
      const plan = planPrivateGalleryFirstProofReady({
        gallery: { ...PROOF_GALLERY, state },
        placements: [proofPlacement],
        pricing,
        verifiedObjects: [proof],
      });
      expect(plan.ready).toBe(false);
    }
    expect(planPrivateGalleryFirstProofReady({
      gallery: { ...PROOF_GALLERY, state: "ready" },
      placements: [{ ...proofPlacement, reference: undefined }],
      pricing,
      verifiedObjects: [proof],
    })).toEqual({ ready: false, blockers: ["wrong-state"] });
  });

  it("reports no private object keys or filenames in blocker values", () => {
    const result = evaluate(PROOF_GALLERY, [], proofData);
    expect(JSON.stringify(result)).not.toMatch(/IMG_|private\/g\//);
  });
});

describe("the states readiness is a question for", () => {
  it.each(["preparing", "ready"] as const)("answers for %s", (state) => {
    expect(evaluate({ state }, [preview, zip])).toEqual({ ready: true });
  });

  it.each(
    PRIVATE_GALLERY_STATES.filter(
      (state) => state !== "preparing" && state !== "ready",
    ),
  )("refuses to call %s ready", (state) => {
    // Answering "ready" for a published or deleting gallery would invite a
    // second publication of something already live.
    const outcome = evaluate({ state }, [preview, zip]);

    expect(outcome.ready).toBe(false);
    if (outcome.ready) return;
    expect(outcome.blockers).toContain("wrong-state");
  });
});

describe("the kind is a stored discriminant, not an inference", () => {
  it("distinguishes a delivery gallery awaiting its ZIP from a proof gallery", () => {
    // Both have no verified ZIP; only one of them ever will. Inferring the kind
    // from `activeZipObjectKey` would publish the first as though it were the
    // second.
    const awaitingZip = evaluate({ kind: "delivery" }, [preview]);
    const neverHasOne = evaluate(PROOF_GALLERY, [proof], proofData);

    expect(awaitingZip).toEqual({
      ready: false,
      blockers: ["no-verified-zip"],
    });
    expect(neverHasOne).toEqual({ ready: true });
  });
});
