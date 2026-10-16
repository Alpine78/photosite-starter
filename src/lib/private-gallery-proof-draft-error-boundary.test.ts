import { describe, expect, it, vi } from "vitest";

describe("proof draft errors across independently loaded route modules", () => {
  it("recognizes a stale-write error from the shared store in a fresh consumer module", async () => {
    const producer = await import("./private-gallery-proof-draft-store");
    const store = producer.createPrivateGalleryProofDraftMemoryStore();
    const row = await store.create({ pricing: { includedCount: 1, extraUnitPriceMinor: 0, currency: "EUR" } }, new Date("2026-10-16T12:00:00Z"));
    const error = await store.updateReferences({ handle: row.gallery.galleryHandle, expectedRevision: 1, references: {} }).catch((error: unknown) => error);
    expect(error).toBeInstanceOf(producer.PrivateGalleryProofDraftStoreError);

    // Next.js route bundles can instantiate this module separately while retaining
    // the same process-wide memory store and its original method closures.
    vi.resetModules();
    const consumer = await import("./private-gallery-proof-draft-store");
    expect(consumer.PrivateGalleryProofDraftStoreError).not.toBe(producer.PrivateGalleryProofDraftStoreError);
    expect(error).toBeInstanceOf(consumer.PrivateGalleryProofDraftStoreError);
    expect(error).toMatchObject({ reason: "conflict" });
  });

  it("does not recognize arbitrary provider errors or JSON-shaped lookalikes", async () => {
    const { PrivateGalleryProofDraftStoreError } = await import("./private-gallery-proof-draft-store");
    const lookalike = { name: "PrivateGalleryProofDraftStoreError", reason: "conflict" };
    expect(lookalike).not.toBeInstanceOf(PrivateGalleryProofDraftStoreError);
    expect(Object.assign(new Error("provider-canary"), lookalike)).not.toBeInstanceOf(PrivateGalleryProofDraftStoreError);
    const genuine = new PrivateGalleryProofDraftStoreError("conflict");
    expect(genuine).toBeInstanceOf(PrivateGalleryProofDraftStoreError);
    expect(JSON.stringify(genuine)).not.toContain("proof-draft-error.v1");
  });
});
