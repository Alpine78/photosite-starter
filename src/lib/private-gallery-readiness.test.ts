import { describe, expect, it } from "vitest";

import { PRIVATE_GALLERY_STATES, type PrivateGallery } from "@/lib/private-gallery";
import { evaluatePrivateGalleryReadiness } from "@/lib/private-gallery-readiness";
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
) =>
  evaluatePrivateGalleryReadiness({
    gallery: { ...GALLERY, ...gallery },
    verifiedObjects,
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

  it("accepts a watermarked proof as a derivative", () => {
    expect(evaluate({}, [proof, zip])).toEqual({ ready: true });
  });
});

describe("a proof gallery", () => {
  it("is refused rather than declared ready", () => {
    // §8c gives proof readiness three conditions this story owns none of:
    // watermarked derivatives, a frozen pricing snapshot, and every proof's
    // permanent 001-based reference. Answering on the one visible condition
    // would look like a decision.
    expect(evaluate({ kind: "proof" }, [proof])).toEqual({
      ready: false,
      blockers: ["proof-readiness-unimplemented"],
    });
  });

  it("is refused even when it has everything this module can see", () => {
    expect(evaluate({ kind: "proof" }, [proof, zip]).ready).toBe(false);
  });

  it("still reports its own missing derivatives alongside the refusal", () => {
    expect(evaluate({ kind: "proof" }, [])).toEqual({
      ready: false,
      blockers: ["no-derivatives", "proof-readiness-unimplemented"],
    });
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
    const neverHasOne = evaluate({ kind: "proof" }, [proof]);

    expect(awaitingZip).not.toEqual(neverHasOne);
    if (awaitingZip.ready || neverHasOne.ready) return;
    expect(awaitingZip.blockers).toContain("no-verified-zip");
    expect(neverHasOne.blockers).not.toContain("no-verified-zip");
  });
});
