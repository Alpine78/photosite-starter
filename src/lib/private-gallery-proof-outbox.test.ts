import { describe, expect, it } from "vitest";

import type { ContactDeliveryOutcome } from "@/lib/contact-delivery";
import { getBuiltInLabels } from "@/lib/deployment-config";
import type { GalleryNotificationRequest, GalleryNotificationTransport } from "@/lib/gallery-notification";
import {
  createPrivateGalleryProofMemoryStore,
  PROOF_OUTBOX_LEASE_MS,
  PROOF_OUTBOX_MAX_CLAIMS,
  PROOF_OUTBOX_RETRY_DELAY_MS,
} from "@/lib/private-gallery-proof-memory-store";
import {
  PrivateGalleryProofBatchError,
  dispatchPrivateGalleryProofOutboxAttempt,
  runPrivateGalleryProofOutboxBatch,
} from "@/lib/private-gallery-proof-outbox";
import { PRIVATE_GALLERY_PROOF_OUTBOX_MAX_BATCH_SIZE } from "@/lib/private-gallery-proof-store";

const NOW = new Date("2026-09-30T10:00:00.000Z");
const GALLERY_ID = "proof-fixture-gallery";

async function ready() {
  const store = createPrivateGalleryProofMemoryStore({
    gallery: {
      galleryId: GALLERY_ID,
      galleryHandle: "fixture-handle",
      kind: "proof",
      state: "published",
      capabilityGeneration: 1,
      createdAt: new Date("2026-09-29T10:00:00.000Z"),
      publishedAt: new Date("2026-09-29T10:00:00.000Z"),
      accessExpiresAt: new Date("2027-03-30T10:00:00.000Z"),
    },
    pricingSnapshot: { includedCount: 0, extraUnitPriceMinor: 1250, currency: "EUR" },
    placements: [{
      galleryId: GALLERY_ID,
      placementId: "placement-1",
      mediaId: "media-1",
      filename: "IMG_0001.JPG",
      reference: "001",
      objectKey: "opaque/1",
      derivativeKind: "watermarked-proof",
      order: 1,
      nominalBytes: 1000,
      width: 1200,
      height: 800,
    }],
  });
  await store.editDraft({ expectedCapabilityGeneration: 1,
    galleryId: GALLERY_ID, expectedRevision: 0, selectedReferences: ["001"], now: NOW,
  });
  const { outbox } = await store.confirm({ expectedCapabilityGeneration: 1,
    galleryId: GALLERY_ID,
    expectedRevision: 1,
    now: NOW,
    notification: {
      recipient: "owner@example.com",
      galleryReference: "job-42",
      customerReference: "customer-17",
      locale: "en-GB",
      labels: getBuiltInLabels("en-GB").proofConfirmationEmail,
    },
  });
  return { store, key: outbox.idempotencyKey };
}

function at(offsetMs = 0): Date {
  return new Date(NOW.getTime() + offsetMs);
}

function transport(
  deliver: (request: GalleryNotificationRequest) => Promise<ContactDeliveryOutcome>,
): GalleryNotificationTransport {
  return { name: "test", deliver };
}

describe("AB#130 proof outbox delivery", () => {
  it("sends the frozen message once and records metadata-only success", async () => {
    const { store, key } = await ready();
    const requests: GalleryNotificationRequest[] = [];
    const sender = transport(async (request) => {
      requests.push(request);
      return { status: "delivered" };
    });
    const params = { store, transport: sender, galleryId: GALLERY_ID, idempotencyKey: key, clock: () => NOW };
    const first = await dispatchPrivateGalleryProofOutboxAttempt(params);
    expect(first).toMatchObject({ kind: "completed", outbox: { state: "sent", attempts: 1, sentAt: NOW } });
    expect(requests).toHaveLength(1);
    expect(requests[0].idempotencyKey).toBe(key);
    expect(requests[0].text).toContain("001 — IMG_0001.JPG");
    expect(await dispatchPrivateGalleryProofOutboxAttempt(params)).toEqual({ kind: "not-claimable" });
    const status = await store.readOutbox(GALLERY_ID, key);
    expect(JSON.stringify(status)).not.toMatch(/owner@example.com|IMG_|customer-17|claimId/);
  });

  it("lets one of two simultaneous workers call the transport", async () => {
    const { store, key } = await ready();
    let release!: (outcome: ContactDeliveryOutcome) => void;
    const waiting = new Promise<ContactDeliveryOutcome>((resolve) => { release = resolve; });
    let calls = 0;
    const sender = transport(async () => { calls += 1; return waiting; });
    const params = { store, transport: sender, galleryId: GALLERY_ID, idempotencyKey: key, clock: () => NOW };
    const first = dispatchPrivateGalleryProofOutboxAttempt(params);
    const second = dispatchPrivateGalleryProofOutboxAttempt(params);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    release({ status: "delivered" });
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.kind).sort()).toEqual(["completed", "not-claimable"]);
    expect((await store.readOutbox(GALLERY_ID, key))?.attempts).toBe(1);
  });

  it("retries a transient failure only when due, with identical request and key", async () => {
    const { store, key } = await ready();
    const requests: GalleryNotificationRequest[] = [];
    const sender = transport(async (request) => {
      requests.push(request);
      return requests.length === 1
        ? { status: "failed", errorClass: "timeout", retryable: true }
        : { status: "delivered" };
    });
    let now = at();
    const params = { store, transport: sender, galleryId: GALLERY_ID, idempotencyKey: key, clock: () => now };
    const first = await dispatchPrivateGalleryProofOutboxAttempt(params);
    expect(first).toMatchObject({
      kind: "completed",
      outbox: { state: "failed", attempts: 1, lastError: "timeout", retryable: true,
        nextAttemptAt: at(PROOF_OUTBOX_RETRY_DELAY_MS) },
    });
    now = at(PROOF_OUTBOX_RETRY_DELAY_MS - 1);
    expect(await dispatchPrivateGalleryProofOutboxAttempt(params)).toEqual({ kind: "not-claimable" });
    now = at(PROOF_OUTBOX_RETRY_DELAY_MS);
    const second = await dispatchPrivateGalleryProofOutboxAttempt(params);
    expect(second).toMatchObject({ kind: "completed", outbox: { state: "sent", attempts: 2 } });
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
  });

  it("keeps permanent failures and thrown provider text out of retry and status", async () => {
    const { store, key } = await ready();
    const rejected = transport(async () => ({
      status: "failed", errorClass: "provider-rejected", retryable: true,
    }));
    const params = { store, transport: rejected, galleryId: GALLERY_ID, idempotencyKey: key, clock: () => NOW };
    expect(await dispatchPrivateGalleryProofOutboxAttempt(params)).toMatchObject({
      kind: "completed", outbox: { state: "failed", attempts: 1,
        lastError: "provider-rejected", retryable: false },
    });
    expect(await dispatchPrivateGalleryProofOutboxAttempt(params)).toEqual({ kind: "not-claimable" });
    const resend = await store.queueResend({
      galleryId: GALLERY_ID, confirmationVersion: 1, attemptId: "owner-1", now: at(1),
    });
    const throwing = transport(async () => { throw new Error("IMG_0001.JPG owner@example.com secret"); });
    const result = await dispatchPrivateGalleryProofOutboxAttempt({
      ...params, transport: throwing, idempotencyKey: resend.idempotencyKey, clock: () => at(1),
    });
    expect(result).toMatchObject({ kind: "completed", outbox: {
      state: "failed", lastError: "provider-unavailable", retryable: true,
    } });
    expect(JSON.stringify(result)).not.toMatch(/IMG_|owner@example.com|secret/);
    const another = await store.queueResend({
      galleryId: GALLERY_ID, confirmationVersion: 1, attemptId: "owner-2", now: at(2),
    });
    const malformed = transport(async () => ({
      status: "delivered", errorClass: "secret provider body",
    } as never));
    expect(await dispatchPrivateGalleryProofOutboxAttempt({
      ...params, transport: malformed, idempotencyKey: another.idempotencyKey, clock: () => at(2),
    })).toMatchObject({ kind: "completed", outbox: {
      state: "failed", lastError: "provider-unavailable", retryable: true,
    } });
    expect((await store.read(GALLERY_ID))?.latestConfirmationVersion).toBe(1);
  });

  it("rejects stale completion after lease recovery without replacing the current result", async () => {
    const { store, key } = await ready();
    const first = await store.claimDelivery({ galleryId: GALLERY_ID, idempotencyKey: key, now: NOW });
    const second = await store.claimDelivery({
      galleryId: GALLERY_ID, idempotencyKey: key, now: at(PROOF_OUTBOX_LEASE_MS),
    });
    expect(first?.claimId).not.toBe(second?.claimId);
    expect(second?.request).toEqual(first?.request);
    await expect(store.completeDelivery({
      galleryId: GALLERY_ID, idempotencyKey: key, claimId: first!.claimId,
      outcome: { status: "delivered" }, now: at(PROOF_OUTBOX_LEASE_MS),
    })).rejects.toMatchObject({ reason: "stale-claim" });
    expect((await store.readOutbox(GALLERY_ID, key))?.state).toBe("pending");
    await store.completeDelivery({
      galleryId: GALLERY_ID, idempotencyKey: key, claimId: second!.claimId,
      outcome: { status: "delivered" }, now: at(PROOF_OUTBOX_LEASE_MS),
    });
    expect((await store.readOutbox(GALLERY_ID, key))?.state).toBe("sent");
  });

  it("bounds abandoned claims and reports an interruption without inventing a provider error", async () => {
    const { store, key } = await ready();
    for (let index = 0; index < PROOF_OUTBOX_MAX_CLAIMS; index += 1) {
      expect(await store.claimDelivery({
        galleryId: GALLERY_ID, idempotencyKey: key, now: at(index * PROOF_OUTBOX_LEASE_MS),
      })).toBeDefined();
    }
    expect(await store.claimDelivery({
      galleryId: GALLERY_ID, idempotencyKey: key, now: at(PROOF_OUTBOX_MAX_CLAIMS * PROOF_OUTBOX_LEASE_MS),
    })).toBeUndefined();
    const status = await store.readOutbox(GALLERY_ID, key);
    expect(status).toMatchObject({
      state: "failed", attempts: PROOF_OUTBOX_MAX_CLAIMS,
      lastError: "worker-interrupted", retryable: false,
    });
    expect(JSON.stringify(status)).not.toMatch(/IMG_|owner@example.com|customer-17|claimId/);
    expect(await store.claimDelivery({ galleryId: GALLERY_ID, idempotencyKey: key, now: at(1_000_000) }))
      .toBeUndefined();
  });
});

describe("AB#130 bounded proof outbox batch", () => {
  it("discovers only due attempts, including an expired lease and a due retry", async () => {
    const { store, key } = await ready();
    const resend = await store.queueResend({
      galleryId: GALLERY_ID, confirmationVersion: 1, attemptId: "resend-1", now: at(1),
    });
    expect(await store.listDueOutboxAttempts({ now: NOW, limit: 1 })).toEqual([
      { galleryId: GALLERY_ID, idempotencyKey: key },
    ]);
    expect(await store.listDueOutboxAttempts({ now: at(1), limit: 1 })).toHaveLength(1);

    const claim = await store.claimDelivery({ galleryId: GALLERY_ID, idempotencyKey: key, now: NOW });
    expect(claim).toBeDefined();
    expect(await store.listDueOutboxAttempts({ now: at(PROOF_OUTBOX_LEASE_MS - 1), limit: 10 }))
      .toEqual([{ galleryId: GALLERY_ID, idempotencyKey: resend.idempotencyKey }]);
    expect(await store.listDueOutboxAttempts({ now: at(PROOF_OUTBOX_LEASE_MS), limit: 10 }))
      .toContainEqual({ galleryId: GALLERY_ID, idempotencyKey: key });

    const recovered = await store.claimDelivery({
      galleryId: GALLERY_ID, idempotencyKey: key, now: at(PROOF_OUTBOX_LEASE_MS),
    });
    expect(recovered?.claimId).not.toBe(claim!.claimId);
    await store.completeDelivery({
      galleryId: GALLERY_ID, idempotencyKey: key, claimId: recovered!.claimId,
      outcome: { status: "failed", errorClass: "timeout", retryable: true },
      now: at(PROOF_OUTBOX_LEASE_MS),
    });
    const retryAt = PROOF_OUTBOX_LEASE_MS + PROOF_OUTBOX_RETRY_DELAY_MS;
    expect(await store.listDueOutboxAttempts({ now: at(retryAt - 1), limit: 10 }))
      .not.toContainEqual({ galleryId: GALLERY_ID, idempotencyKey: key });
    expect(await store.listDueOutboxAttempts({ now: at(retryAt), limit: 10 }))
      .toContainEqual({ galleryId: GALLERY_ID, idempotencyKey: key });
  });

  it("runs a bounded pass and reports only aggregate outcomes", async () => {
    const { store, key } = await ready();
    const resend = await store.queueResend({
      galleryId: GALLERY_ID, confirmationVersion: 1, attemptId: "resend-1", now: at(1),
    });
    const sender = transport(async (request) => request.idempotencyKey === key
      ? { status: "delivered" }
      : { status: "failed", errorClass: "provider-rejected", retryable: false });
    const progress = await runPrivateGalleryProofOutboxBatch({
      store, transport: sender, clock: () => at(1), limit: 2,
    });
    expect(progress).toEqual({ listed: 2, completed: 2, sent: 1, failed: 1, notClaimable: 0 });
    expect(JSON.stringify(progress)).not.toMatch(/owner@example|IMG_|customer-17|proof-confirmation/);
    expect((await store.readOutbox(GALLERY_ID, key))?.state).toBe("sent");
    expect((await store.readOutbox(GALLERY_ID, resend.idempotencyKey))?.state).toBe("failed");
    expect(await runPrivateGalleryProofOutboxBatch({
      store, transport: sender, clock: () => at(2), limit: 2,
    })).toEqual({ listed: 0, completed: 0, sent: 0, failed: 0, notClaimable: 0 });
  });

  it("counts a claim race as a normal skip when two batches overlap", async () => {
    const { store } = await ready();
    let release!: (outcome: ContactDeliveryOutcome) => void;
    const waiting = new Promise<ContactDeliveryOutcome>((resolve) => { release = resolve; });
    let calls = 0;
    const sender = transport(async () => { calls += 1; return waiting; });
    const params = { store, transport: sender, clock: () => NOW, limit: 1 };
    const first = runPrivateGalleryProofOutboxBatch(params);
    const second = runPrivateGalleryProofOutboxBatch(params);
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    release({ status: "delivered" });
    const results = await Promise.all([first, second]);
    expect(results.map((result) => result.completed).sort()).toEqual([0, 1]);
    expect(results.map((result) => result.notClaimable).sort()).toEqual([0, 1]);
  });

  it("redacts infrastructure errors while retaining completed counts", async () => {
    const { store, key } = await ready();
    const resend = await store.queueResend({
      galleryId: GALLERY_ID, confirmationVersion: 1, attemptId: "resend-1", now: at(1),
    });
    const failingStore = {
      ...store,
      async claimDelivery(params: Parameters<typeof store.claimDelivery>[0]) {
        if (params.idempotencyKey === resend.idempotencyKey) {
          throw new Error("IMG_0001.JPG owner@example.com secret");
        }
        return store.claimDelivery(params);
      },
    };
    try {
      await runPrivateGalleryProofOutboxBatch({
        store: failingStore, transport: transport(async () => ({ status: "delivered" })),
        clock: () => at(1), limit: 2,
      });
      throw new Error("expected batch failure");
    } catch (error) {
      expect(error).toBeInstanceOf(PrivateGalleryProofBatchError);
      expect(error).toMatchObject({
        reason: "dispatch-failed",
        progress: { listed: 2, completed: 1, sent: 1, failed: 0, notClaimable: 0 },
      });
      expect(JSON.stringify(error)).not.toMatch(/IMG_|owner@example|secret|proof-confirmation/);
    }
    expect((await store.readOutbox(GALLERY_ID, key))?.state).toBe("sent");
  });

  it("refuses invalid bounds and malformed discovery without delivering", async () => {
    const { store } = await ready();
    const sender = transport(async () => { throw new Error("must not deliver"); });
    for (const limit of [0, -1, 1.5, PRIVATE_GALLERY_PROOF_OUTBOX_MAX_BATCH_SIZE + 1]) {
      await expect(runPrivateGalleryProofOutboxBatch({
        store, transport: sender, clock: () => NOW, limit,
      })).rejects.toMatchObject({ reason: "invalid-limit" });
    }
    await expect(store.listDueOutboxAttempts({ now: NOW, limit: 0 }))
      .rejects.toMatchObject({ reason: "invalid-limit" });
    const malformedStore = {
      ...store,
      async listDueOutboxAttempts() {
        return [
          { galleryId: GALLERY_ID, idempotencyKey: "same" },
          { galleryId: GALLERY_ID, idempotencyKey: "same" },
        ];
      },
    };
    await expect(runPrivateGalleryProofOutboxBatch({
      store: malformedStore, transport: sender, clock: () => NOW, limit: 2,
    })).rejects.toMatchObject({ reason: "invalid-store-result" });
  });
});
