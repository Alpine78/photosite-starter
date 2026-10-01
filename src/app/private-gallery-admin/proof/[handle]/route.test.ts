import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ store: "memory" as "memory" | "off" | "enabled" }));

vi.mock("@/lib/deployment-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deployment-config")>();
  return {
    ...actual,
    getDeploymentConfig: () => ({ privateGallery: { store: settings.store, routePrefix: "private" } }),
  };
});
vi.mock("@/lib/private-gallery-deployment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/private-gallery-deployment")>();
  return {
    ...actual,
    getPrivateGalleryDeployment: () => ({ store: settings.store, routePrefix: "private" }),
  };
});

import { GET, POST } from "@/app/private-gallery-admin/proof/[handle]/route";
import { attemptPrivateGalleryAdminLogin } from "@/lib/private-gallery-access";
import {
  getPrivateGalleryMemoryStore,
  MEMORY_ADMIN_SECRET,
  MEMORY_PROOF_GALLERY_HANDLE,
  resetPrivateGalleryMemoryStore,
} from "@/lib/private-gallery-memory-store";

const ORIGIN = "https://private.test";

async function adminCookie() {
  const memory = getPrivateGalleryMemoryStore();
  const outcome = await attemptPrivateGalleryAdminLogin(
    { loginStore: memory.adminLoginStore, sessionStore: memory.adminSessionStore,
      ipLimiter: { tryConsume: () => ({ allowed: true }) },
      environment: { PRIVATE_GALLERY_ADMIN_SECRET_HASH: memory.adminCredentialHash } },
    { submittedSecret: MEMORY_ADMIN_SECRET, clientKey: "test-client", now: new Date() },
  );
  if (!outcome.ok) throw new Error("fixture admin login failed");
  return `${outcome.cookie.name}=${outcome.cookie.value}`;
}

function get(options: { handle?: string; cookie?: string } = {}) {
  const handle = options.handle ?? MEMORY_PROOF_GALLERY_HANDLE;
  const request = new Request(`${ORIGIN}/admin/proof/${handle}`, {
    headers: options.cookie === undefined ? {} : { cookie: options.cookie },
  });
  return GET(request, { params: Promise.resolve({ handle }) });
}

function post(body: unknown, options: {
  handle?: string; cookie?: string; origin?: string; raw?: string;
} = {}) {
  const handle = options.handle ?? MEMORY_PROOF_GALLERY_HANDLE;
  const request = new Request(`${ORIGIN}/admin/proof/${handle}`, {
    method: "POST",
    headers: {
      host: "private.test", origin: options.origin ?? ORIGIN,
      "sec-fetch-site": "same-origin", "content-type": "application/json",
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
    body: options.raw ?? JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ handle }) });
}

beforeEach(() => {
  settings.store = "memory";
  resetPrivateGalleryMemoryStore();
});

describe("GET/POST <admin-prefix>/proof/<handle>", () => {
  it("reports the open draft only with a current administrator session", async () => {
    const cookie = await adminCookie();
    const response = await get({ cookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toEqual({ ok: true, status: {
      handle: MEMORY_PROOF_GALLERY_HANDLE,
      confirmed: false, draftRevision: 0, latestConfirmationVersion: 0,
      pricing: { includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR" },
    } });
  });

  it("refuses without a session, an unknown handle, or a disabled/unprovisioned store", async () => {
    const cookie = await adminCookie();
    expect((await get()).status).toBe(401);
    expect((await get({ handle: "A".repeat(22), cookie })).status).toBe(404);

    settings.store = "off";
    expect((await get({ cookie })).status).toBe(404);
    settings.store = "enabled";
    expect((await get({ cookie })).status).toBe(401);
  });

  it("resends without a new confirmation version, and reports the notification's status", async () => {
    const cookie = await adminCookie();
    const memory = getPrivateGalleryMemoryStore();
    await memory.proofStore.editDraft({
      galleryId: memory.proofGallery.galleryId,
      expectedCapabilityGeneration: memory.proofGallery.capabilityGeneration,
      expectedRevision: 0, selectedReferences: ["001"], now: new Date(),
    });
    await memory.proofStore.confirm({
      galleryId: memory.proofGallery.galleryId,
      expectedCapabilityGeneration: memory.proofGallery.capabilityGeneration,
      expectedRevision: 1, now: new Date(), notification: memory.proofNotification(),
    });

    const status = await (await get({ cookie })).json();
    expect(status).toMatchObject({ ok: true, status: {
      confirmed: true, latestConfirmationVersion: 1,
      notification: { state: "pending", attempts: 0 },
    } });
    expect(JSON.stringify(status)).not.toMatch(/IMG_0001|IMG_0002|owner@example|memory-proof/);

    const resend = await post({ action: "resend" }, { cookie });
    expect(await resend.json()).toEqual({ ok: true, confirmationVersion: 1 });

    const reopenRefused = await post({ action: "reopen", expectedRevision: 0 }, { cookie });
    expect(reopenRefused.status).toBe(409);
    expect(await reopenRefused.json()).toEqual({ ok: false, reason: "conflict" });

    const reopened = await post({ action: "reopen", expectedRevision: 2 }, { cookie });
    expect(await reopened.json()).toEqual({ ok: true, revision: 3 });

    const afterReopen = await (await get({ cookie })).json();
    expect(afterReopen.status).toMatchObject({ confirmed: false, draftRevision: 3,
      latestConfirmationVersion: 1 });
  });

  it("refuses a resend for an open draft, and a cross-origin or malformed mutation", async () => {
    const cookie = await adminCookie();
    const refused = await post({ action: "resend" }, { cookie });
    expect(refused.status).toBe(422);
    expect(await refused.json()).toEqual({ ok: false, reason: "not-confirmed" });

    expect((await post({ action: "resend" }, { cookie, origin: "https://attacker.test" })).status).toBe(400);
    expect((await post({ action: "resend" }, { cookie, raw: "{" })).status).toBe(400);
    expect((await post({ action: "reopen" }, { cookie })).status).toBe(400);
  });
});
