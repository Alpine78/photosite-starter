import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { PrivateGallery, PrivateGalleryAdminSession, PrivateGalleryProofPlacement } from "@/lib/private-gallery";
import {
  readPrivateGalleryProofAdminStatus,
  reopenPrivateGalleryProofAsAdmin,
  resendPrivateGalleryProofNotificationAsAdmin,
  type PrivateGalleryProofAdminDeps,
} from "@/lib/private-gallery-access";
import {
  encodePrivateGalleryAdminCredential,
  PRIVATE_GALLERY_ADMIN_SALT_BYTES,
  PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING,
} from "@/lib/private-gallery-admin-credential";
import { privateGalleryAdminCredentialGeneration } from "@/lib/private-gallery-admin-credential-format";
import { createPrivateGalleryAdminSession } from "@/lib/private-gallery-admin-session";
import {
  PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME,
  type PrivateGalleryAdminSessionStore,
} from "@/lib/private-gallery-admin-session";
import { createPrivateGalleryProofMemoryStore } from "@/lib/private-gallery-proof-memory-store";
import { getBuiltInLabels } from "@/lib/deployment-config";

const NOW = new Date("2026-09-30T12:00:00.000Z");
const ENCODED_CREDENTIAL = encodePrivateGalleryAdminCredential({
  secret: randomBytes(32).toString("base64url"),
  salt: Buffer.alloc(PRIVATE_GALLERY_ADMIN_SALT_BYTES, 7),
});
const ENV = { [PRIVATE_GALLERY_ADMIN_SECRET_HASH_SETTING]: ENCODED_CREDENTIAL };
const CREDENTIAL_GENERATION = privateGalleryAdminCredentialGeneration(ENCODED_CREDENTIAL);

const GALLERY: PrivateGallery = {
  galleryId: "admin-proof-gallery",
  galleryHandle: "AAAAAAAAAAAAAAAAAAAAAA",
  kind: "proof",
  state: "published",
  capabilityGeneration: 1,
  createdAt: NOW,
  publishedAt: NOW,
  accessExpiresAt: new Date(NOW.getTime() + 180 * 24 * 60 * 60 * 1000),
};

const PLACEMENT: PrivateGalleryProofPlacement = {
  galleryId: GALLERY.galleryId,
  placementId: "placement-1",
  mediaId: "media-1",
  filename: "IMG_0001.JPG",
  reference: "001",
  objectKey: "private/admin/1",
  derivativeKind: "watermarked-proof",
  order: 0,
  nominalBytes: 1000,
  width: 1200,
  height: 800,
};

function adminSessionStore(): {
  readonly store: PrivateGalleryAdminSessionStore;
  readonly rows: PrivateGalleryAdminSession[];
} {
  const rows: PrivateGalleryAdminSession[] = [];
  return {
    rows,
    store: {
      async create(session) {
        rows.push(session);
      },
      async findByHash(hash) {
        return rows.find((row) => row.sessionIdHash === hash);
      },
      async deleteByHash(hash) {
        const index = rows.findIndex((row) => row.sessionIdHash === hash);
        if (index >= 0) rows.splice(index, 1);
      },
    },
  };
}

async function fixture(options: { confirm?: boolean } = {}) {
  const { store: sessionStore } = adminSessionStore();
  const { cookie } = await createPrivateGalleryAdminSession(sessionStore, {
    credentialGeneration: CREDENTIAL_GENERATION,
    now: NOW,
  });
  const header = `${PRIVATE_GALLERY_ADMIN_SESSION_COOKIE_NAME}=${cookie.value}`;

  const proofStore = createPrivateGalleryProofMemoryStore({
    gallery: GALLERY,
    pricingSnapshot: { includedCount: 0, extraUnitPriceMinor: 500, currency: "EUR" },
    placements: [PLACEMENT],
  });

  const findProofGalleryIdByHandle = vi.fn(async (handle: string) =>
    handle === GALLERY.galleryHandle ? GALLERY.galleryId : undefined,
  );

  const deps: PrivateGalleryProofAdminDeps = {
    sessionStore,
    environment: ENV,
    proofStore,
    findProofGalleryIdByHandle,
  };

  if (options.confirm) {
    await proofStore.editDraft({
      galleryId: GALLERY.galleryId,
      expectedCapabilityGeneration: GALLERY.capabilityGeneration,
      expectedRevision: 0,
      selectedReferences: ["001"],
      now: NOW,
    });
    await proofStore.confirm({
      galleryId: GALLERY.galleryId,
      expectedCapabilityGeneration: GALLERY.capabilityGeneration,
      expectedRevision: 1,
      now: NOW,
      notification: {
        recipient: "owner@example.test",
        galleryReference: "job-1",
        customerReference: "customer-1",
        locale: "en-GB",
        labels: getBuiltInLabels("en-GB").proofConfirmationEmail,
      },
    });
  }

  return { deps, header, proofStore, findProofGalleryIdByHandle };
}

describe("readPrivateGalleryProofAdminStatus", () => {
  it("refuses without a valid administrator session", async () => {
    const f = await fixture();
    await expect(readPrivateGalleryProofAdminStatus(f.deps, {
      cookieHeader: null, now: NOW, handle: GALLERY.galleryHandle,
    })).resolves.toEqual({ ok: false, reason: "no-session" });
    expect(f.findProofGalleryIdByHandle).not.toHaveBeenCalled();
  });

  it("reports not-found for a handle naming no gallery, without leaking which", async () => {
    const f = await fixture();
    await expect(readPrivateGalleryProofAdminStatus(f.deps, {
      cookieHeader: f.header, now: NOW, handle: "B".repeat(22),
    })).resolves.toEqual({ ok: false, reason: "not-found" });
  });

  it("reports the open draft with no notification yet", async () => {
    const f = await fixture();
    const outcome = await readPrivateGalleryProofAdminStatus(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle,
    });
    expect(outcome).toEqual({
      ok: true,
      value: {
        handle: GALLERY.galleryHandle,
        confirmed: false,
        draftRevision: 0,
        latestConfirmationVersion: 0,
        pricing: { includedCount: 0, extraUnitPriceMinor: 500, currency: "EUR" },
      },
    });
  });

  it("reports the confirmation summary and the pending notification's status", async () => {
    const f = await fixture({ confirm: true });
    const outcome = await readPrivateGalleryProofAdminStatus(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle,
    });
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        confirmed: true,
        latestConfirmationVersion: 1,
        currentSummary: { selectedCount: 1, extraCount: 1, extraTotalMinor: 500 },
        confirmedAt: NOW.toISOString(),
        notification: { state: "pending", attempts: 0 },
      },
    });
    expect(JSON.stringify(outcome)).not.toMatch(/IMG_0001|media-1|owner@example|private\/admin/);
  });

  it("reports the newest resend attempt even when the original was sent", async () => {
    const f = await fixture({ confirm: true });
    const initialKey = `proof-confirmation:${GALLERY.galleryId}:1`;
    const initialClaim = await f.proofStore.claimDelivery({
      galleryId: GALLERY.galleryId, idempotencyKey: initialKey, now: NOW,
    });
    expect(initialClaim).toBeDefined();
    await f.proofStore.completeDelivery({
      galleryId: GALLERY.galleryId, idempotencyKey: initialKey,
      claimId: initialClaim!.claimId, outcome: { status: "delivered" }, now: NOW,
    });

    // The same timestamp must still rank the later queued row as the latest.
    const resend = await f.proofStore.queueResend({
      galleryId: GALLERY.galleryId, confirmationVersion: 1,
      attemptId: "resend-1", now: NOW,
    });
    let status = await readPrivateGalleryProofAdminStatus(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle,
    });
    expect(status).toMatchObject({
      ok: true, value: { notification: { state: "pending", attempts: 0 } },
    });

    const resendClaim = await f.proofStore.claimDelivery({
      galleryId: GALLERY.galleryId, idempotencyKey: resend.idempotencyKey, now: NOW,
    });
    expect(resendClaim).toBeDefined();
    await f.proofStore.completeDelivery({
      galleryId: GALLERY.galleryId, idempotencyKey: resend.idempotencyKey,
      claimId: resendClaim!.claimId,
      outcome: { status: "failed", errorClass: "provider-rejected", retryable: false },
      now: NOW,
    });
    status = await readPrivateGalleryProofAdminStatus(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle,
    });
    expect(status).toMatchObject({
      ok: true, value: { notification: {
        state: "failed", attempts: 1, lastError: "provider-rejected",
      } },
    });
    expect((await f.proofStore.readOutbox(GALLERY.galleryId, initialKey))?.state).toBe("sent");
  });

  it("reports a failed notification's error class and retry time", async () => {
    const f = await fixture({ confirm: true });
    const claim = await f.proofStore.claimDelivery({
      galleryId: GALLERY.galleryId,
      idempotencyKey: `proof-confirmation:${GALLERY.galleryId}:1`,
      now: NOW,
    });
    expect(claim).toBeDefined();
    await f.proofStore.completeDelivery({
      galleryId: GALLERY.galleryId,
      idempotencyKey: `proof-confirmation:${GALLERY.galleryId}:1`,
      claimId: claim!.claimId,
      outcome: { status: "failed", errorClass: "provider-unavailable", retryable: true },
      now: NOW,
    });

    const outcome = await readPrivateGalleryProofAdminStatus(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle,
    });
    expect(outcome).toMatchObject({
      ok: true,
      value: {
        notification: {
          state: "failed", attempts: 1, lastError: "provider-unavailable",
        },
      },
    });
  });
});

describe("reopenPrivateGalleryProofAsAdmin", () => {
  it("refuses to reopen an open draft", async () => {
    const f = await fixture();
    await expect(reopenPrivateGalleryProofAsAdmin(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle, expectedRevision: 0,
    })).resolves.toEqual({ ok: false, reason: "not-confirmed" });
  });

  it("unlocks a confirmed draft for a new round of edits without touching the confirmation", async () => {
    const f = await fixture({ confirm: true });
    const outcome = await reopenPrivateGalleryProofAsAdmin(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle, expectedRevision: 2,
    });
    expect(outcome).toEqual({ ok: true, value: { revision: 3 } });

    const state = await f.proofStore.read(GALLERY.galleryId);
    expect(state?.draft).toMatchObject({ revision: 3, confirmed: false });
    expect(state?.latestConfirmationVersion).toBe(1);
    expect(state?.currentConfirmation).toBeUndefined();
  });

  it("reports a conflict for a stale revision, only after authorization", async () => {
    const f = await fixture({ confirm: true });
    await expect(reopenPrivateGalleryProofAsAdmin(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle, expectedRevision: 0,
    })).resolves.toEqual({ ok: false, reason: "conflict" });

    await expect(reopenPrivateGalleryProofAsAdmin(f.deps, {
      cookieHeader: null, now: NOW, handle: GALLERY.galleryHandle, expectedRevision: 0,
    })).resolves.toEqual({ ok: false, reason: "no-session" });
  });
});

describe("resendPrivateGalleryProofNotificationAsAdmin", () => {
  it("refuses to resend for an open draft", async () => {
    const f = await fixture();
    await expect(resendPrivateGalleryProofNotificationAsAdmin(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle,
    })).resolves.toEqual({ ok: false, reason: "not-confirmed" });
  });

  it("queues a fresh attempt under the same confirmation version, repeatably", async () => {
    const f = await fixture({ confirm: true });
    const first = await resendPrivateGalleryProofNotificationAsAdmin(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle,
    });
    expect(first).toEqual({ ok: true, value: { confirmationVersion: 1 } });

    const second = await resendPrivateGalleryProofNotificationAsAdmin(f.deps, {
      cookieHeader: f.header, now: NOW, handle: GALLERY.galleryHandle,
    });
    expect(second).toEqual({ ok: true, value: { confirmationVersion: 1 } });

    const state = await f.proofStore.read(GALLERY.galleryId);
    expect(state?.latestConfirmationVersion).toBe(1);
  });
});
