import { describe, expect, it } from "vitest";

import type { PrivateGallery, PrivateGalleryProofPlacement } from "@/lib/private-gallery";
import {
  PrivateGalleryProofStoreError,
  createPrivateGalleryProofMemoryStore,
} from "@/lib/private-gallery-proof-memory-store";
import { PrivateGalleryProofError } from "@/lib/private-gallery-proof";

const NOW = new Date("2026-09-30T10:00:00.000Z");
const LATER = new Date("2026-10-01T10:00:00.000Z");
const EXPIRES = new Date("2027-03-30T10:00:00.000Z");

function fixture() {
  const gallery: PrivateGallery = {
    galleryId: "gallery-private-a",
    galleryHandle: "private-handle",
    kind: "proof",
    state: "published",
    capabilityGeneration: 1,
    createdAt: new Date("2026-09-29T10:00:00.000Z"),
    publishedAt: new Date("2026-09-29T10:00:00.000Z"),
    accessExpiresAt: new Date(EXPIRES),
  };
  const placements: PrivateGalleryProofPlacement[] = [
    {
      galleryId: gallery.galleryId,
      placementId: "placement-a",
      mediaId: "media-a",
      filename: "IMG_0001.JPG",
      reference: "001",
      objectKey: "opaque/a",
      derivativeKind: "watermarked-proof",
      order: 0,
      nominalBytes: 1000,
      width: 1200,
      height: 800,
    },
    {
      galleryId: gallery.galleryId,
      placementId: "placement-b",
      mediaId: "media-b",
      filename: "IMG_0002.JPG",
      reference: "002",
      objectKey: "opaque/b",
      derivativeKind: "watermarked-proof",
      order: 1,
      nominalBytes: 1000,
      width: 800,
      height: 1200,
    },
  ];
  return {
    gallery,
    placements,
    pricingSnapshot: { includedCount: 0, extraUnitPriceMinor: 0, currency: "EUR" },
  };
}

function reason(error: unknown, expected: string): void {
  expect(error).toBeInstanceOf(Error);
  expect((error as PrivateGalleryProofError | PrivateGalleryProofStoreError).reason).toBe(expected);
  expect((error as Error).message).not.toMatch(/IMG_|media-|private-handle|gallery-private-a/);
}

async function rejectsReason(promise: Promise<unknown>, expected: string): Promise<void> {
  try {
    await promise;
    throw new Error("expected refusal");
  } catch (error) {
    reason(error, expected);
  }
}

describe("AB#130 development proof store", () => {
  it("commits a draft lock, immutable version and exactly one initial pending attempt", async () => {
    const store = createPrivateGalleryProofMemoryStore(fixture());
    const edited = await store.editDraft({
      galleryId: "gallery-private-a", expectedRevision: 0,
      selectedReferences: ["002", "001"], now: NOW,
    });
    const confirmed = await store.confirm({
      galleryId: "gallery-private-a", expectedRevision: edited.revision, now: NOW,
    });
    expect(confirmed.draft).toMatchObject({ revision: 2, confirmed: true });
    expect(confirmed.confirmation).toMatchObject({
      version: 1,
      summary: { selectedCount: 2, extraCount: 2, extraTotalMinor: 0 },
      selectedImages: [
        { reference: "002", filename: "IMG_0002.JPG", mediaId: "media-b" },
        { reference: "001", filename: "IMG_0001.JPG", mediaId: "media-a" },
      ],
    });
    expect(confirmed.outbox).toMatchObject({
      kind: "proof-confirmation", confirmationVersion: 1,
      idempotencyKey: "proof-confirmation:gallery-private-a:1",
      state: "pending", attempts: 0,
    });
    expect(await store.readConfirmation("gallery-private-a", 1)).toEqual(confirmed.confirmation);
    expect(await store.readOutbox("gallery-private-a", confirmed.outbox.idempotencyKey))
      .toEqual(confirmed.outbox);
    expect((await store.read("gallery-private-a"))?.latestConfirmationVersion).toBe(1);

    await rejectsReason(store.confirm({
      galleryId: "gallery-private-a", expectedRevision: 2, now: NOW,
    }), "already-confirmed");
    expect((await store.read("gallery-private-a"))?.latestConfirmationVersion).toBe(1);
  });

  it("lets only one simultaneous edit or confirmation win a revision", async () => {
    const store = createPrivateGalleryProofMemoryStore(fixture());
    const edits = await Promise.allSettled([
      store.editDraft({ galleryId: "gallery-private-a", expectedRevision: 0, selectedReferences: ["001"], now: NOW }),
      store.editDraft({ galleryId: "gallery-private-a", expectedRevision: 0, selectedReferences: ["002"], now: NOW }),
    ]);
    expect(edits.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(edits.filter((result) => result.status === "rejected")).toHaveLength(1);
    const failedEdit = edits.find((result) => result.status === "rejected");
    if (failedEdit?.status === "rejected") reason(failedEdit.reason, "stale-revision");

    const confirmations = await Promise.allSettled([
      store.confirm({ galleryId: "gallery-private-a", expectedRevision: 1, now: NOW }),
      store.confirm({ galleryId: "gallery-private-a", expectedRevision: 1, now: NOW }),
    ]);
    expect(confirmations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(confirmations.filter((result) => result.status === "rejected")).toHaveLength(1);
    const failedConfirmation = confirmations.find((result) => result.status === "rejected");
    if (failedConfirmation?.status === "rejected") reason(failedConfirmation.reason, "already-confirmed");
    expect((await store.read("gallery-private-a"))?.latestConfirmationVersion).toBe(1);
  });

  it("rolls back rejected edits and confirmations without creating an outbox attempt", async () => {
    const store = createPrivateGalleryProofMemoryStore(fixture());
    await rejectsReason(store.editDraft({
      galleryId: "gallery-private-a", expectedRevision: 0, selectedReferences: ["999"], now: NOW,
    }), "unknown-reference");
    await rejectsReason(store.confirm({
      galleryId: "gallery-private-a", expectedRevision: 1, now: NOW,
    }), "stale-revision");
    expect((await store.read("gallery-private-a"))?.draft).toMatchObject({
      revision: 0, selectedReferences: [], confirmed: false,
    });
    expect((await store.read("gallery-private-a"))?.latestConfirmationVersion).toBe(0);
    expect(await store.readOutbox("gallery-private-a", "proof-confirmation:gallery-private-a:1"))
      .toBeUndefined();
  });

  it("reopens with CAS, preserves expiry and old snapshot, then makes version two", async () => {
    const store = createPrivateGalleryProofMemoryStore(fixture());
    await store.editDraft({ galleryId: "gallery-private-a", expectedRevision: 0, selectedReferences: ["001"], now: NOW });
    const first = await store.confirm({ galleryId: "gallery-private-a", expectedRevision: 1, now: NOW });
    await rejectsReason(store.reopen({ galleryId: "gallery-private-a", expectedRevision: 1, now: LATER }), "stale-revision");
    const reopened = await store.reopen({ galleryId: "gallery-private-a", expectedRevision: 2, now: LATER });
    expect(reopened).toMatchObject({ revision: 3, confirmed: false, selectedReferences: ["001"] });
    await rejectsReason(store.queueResend({
      galleryId: "gallery-private-a", confirmationVersion: 1, attemptId: "admin-1", now: LATER,
    }), "draft-open");
    await store.editDraft({ galleryId: "gallery-private-a", expectedRevision: 3, selectedReferences: ["002"], now: LATER });
    const second = await store.confirm({ galleryId: "gallery-private-a", expectedRevision: 4, now: LATER });
    expect(second.confirmation.version).toBe(2);
    expect(second.outbox.idempotencyKey).toBe("proof-confirmation:gallery-private-a:2");
    expect(await store.readConfirmation("gallery-private-a", 1)).toEqual(first.confirmation);
    expect(await store.readOutbox("gallery-private-a", first.outbox.idempotencyKey)).toEqual(first.outbox);
    expect((await store.read("gallery-private-a"))?.gallery.accessExpiresAt).toEqual(EXPIRES);
    await rejectsReason(store.queueResend({
      galleryId: "gallery-private-a", confirmationVersion: 1, attemptId: "admin-1", now: LATER,
    }), "unknown-confirmation");
  });

  it("queues one unique resend attempt against the current version only", async () => {
    const store = createPrivateGalleryProofMemoryStore(fixture());
    await store.confirm({ galleryId: "gallery-private-a", expectedRevision: 0, now: NOW });
    const resend = await store.queueResend({
      galleryId: "gallery-private-a", confirmationVersion: 1, attemptId: "admin-1", now: LATER,
    });
    expect(resend).toMatchObject({
      confirmationVersion: 1,
      idempotencyKey: "proof-confirmation-resend:gallery-private-a:1:admin-1",
      state: "pending", attempts: 0,
    });
    await rejectsReason(store.queueResend({
      galleryId: "gallery-private-a", confirmationVersion: 1, attemptId: "admin-1", now: LATER,
    }), "duplicate-attempt");
    expect(await store.readOutbox("gallery-private-a", resend.idempotencyKey)).toEqual(resend);
    expect((await store.read("gallery-private-a"))?.latestConfirmationVersion).toBe(1);
  });

  it("copies seed and returned nested values so callers cannot rewrite a confirmation", async () => {
    const seed = fixture();
    const store = createPrivateGalleryProofMemoryStore(seed);
    seed.gallery.accessExpiresAt?.setTime(NOW.getTime());
    (seed.placements[0] as { filename: string }).filename = "modified.jpg";
    seed.pricingSnapshot.includedCount = 99;
    await store.editDraft({ galleryId: "gallery-private-a", expectedRevision: 0, selectedReferences: ["001"], now: NOW });
    const result = await store.confirm({ galleryId: "gallery-private-a", expectedRevision: 1, now: NOW });
    result.confirmation.confirmedAt.setTime(0);
    (result.confirmation.selectedImages[0] as { filename: string }).filename = "modified-again.jpg";
    (result.confirmation.summary as { includedCount: number }).includedCount = 99;
    (result.outbox.createdAt as Date).setTime(0);
    const saved = await store.readConfirmation("gallery-private-a", 1);
    expect(saved?.confirmedAt).toEqual(NOW);
    expect(saved?.selectedImages[0].filename).toBe("IMG_0001.JPG");
    expect(saved?.summary.includedCount).toBe(0);
    expect((await store.read("gallery-private-a"))?.gallery.accessExpiresAt).toEqual(EXPIRES);
    expect((await store.readOutbox("gallery-private-a", result.outbox.idempotencyKey))?.createdAt).toEqual(NOW);
  });

  it("rejects malformed publication seeds and expired edits", async () => {
    const seed = fixture();
    expect(() => createPrivateGalleryProofMemoryStore({ ...seed, placements: [
      { ...seed.placements[0], reference: "abc" },
    ] })).toThrow(PrivateGalleryProofStoreError);
    expect(() => createPrivateGalleryProofMemoryStore({ ...seed, placements: [
      seed.placements[0], { ...seed.placements[1], reference: "001" },
    ] })).toThrow(PrivateGalleryProofStoreError);
    expect(() => createPrivateGalleryProofMemoryStore({ ...seed, gallery: { ...seed.gallery, kind: "delivery" } }))
      .toThrow(PrivateGalleryProofStoreError);
    const store = createPrivateGalleryProofMemoryStore(seed);
    await rejectsReason(store.editDraft({
      galleryId: "gallery-private-a", expectedRevision: 0, selectedReferences: [], now: EXPIRES,
    }), "access-expired");
    expect((await store.read("gallery-private-a"))?.draft.revision).toBe(0);
  });
});
