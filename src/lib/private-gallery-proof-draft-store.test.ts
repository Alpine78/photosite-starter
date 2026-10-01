import { describe, expect, it } from "vitest";

import {
  createPrivateGalleryProofDraftMemoryStore,
  PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT,
} from "@/lib/private-gallery-proof-draft-store";

const NOW = new Date("2026-10-01T10:00:00.000Z");
const INPUT = {
  pricing: { includedCount: 2, extraUnitPriceMinor: 1200, currency: "EUR" },
  customerReference: "customer-1",
  jobReference: "job-1",
};

describe("private proof draft memory store", () => {
  it("creates distinct inaccessible draft identities without a capability or publication", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    const first = await store.create(INPUT, NOW);
    const second = await store.create(INPUT, NOW);
    expect(first.gallery.galleryId).not.toBe(second.gallery.galleryId);
    expect(first.gallery.galleryHandle).not.toBe(second.gallery.galleryHandle);
    for (const draft of [first, second]) {
      expect(draft.gallery).toMatchObject({ kind: "proof", state: "draft", capabilityGeneration: 0 });
      expect(draft.gallery).not.toHaveProperty("publishedAt");
      expect(draft.gallery).not.toHaveProperty("accessExpiresAt");
      expect(draft).not.toHaveProperty("capability");
    }
    (first.pricing as { currency: string }).currency = "USD";
    expect((await store.list(2)).items[0].pricing.currency).toBe("EUR");
  });

  it("validates pricing, references, time and list bound before mutation", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    await expect(store.create({ ...INPUT, pricing: { ...INPUT.pricing, extraUnitPriceMinor: -1 } }, NOW))
      .rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.create({ ...INPUT, customerReference: "a\n" }, NOW))
      .rejects.toMatchObject({ reason: "invalid-input" });
    await expect(store.create(INPUT, new Date("invalid")))
      .rejects.toMatchObject({ reason: "invalid-time" });
    await expect(store.list(0)).rejects.toMatchObject({ reason: "invalid-limit" });
    await expect(store.list(101)).rejects.toMatchObject({ reason: "invalid-limit" });
    expect((await store.list(1)).items).toEqual([]);
  });

  it("returns only the latest bounded page and reports truncation", async () => {
    const store = createPrivateGalleryProofDraftMemoryStore();
    for (let index = 0; index <= PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT; index += 1) {
      await store.create(INPUT, new Date(NOW.getTime() + index * 1000));
    }
    const list = await store.list(PRIVATE_GALLERY_PROOF_DRAFT_LIST_LIMIT);
    expect(list.items).toHaveLength(100);
    expect(list.hasMore).toBe(true);
    expect(list.items[0].gallery.createdAt.toISOString()).toBe(new Date(NOW.getTime() + 100000).toISOString());
    expect(list.items.at(-1)?.gallery.createdAt.toISOString()).toBe(new Date(NOW.getTime() + 1000).toISOString());
  });
});
