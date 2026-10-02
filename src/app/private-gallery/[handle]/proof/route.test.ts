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

import { GET, POST, PUT } from "@/app/private-gallery/[handle]/proof/route";
import {
  createPrivateGalleryExchangeIpLimiter,
  exchangePrivateGalleryCapability,
} from "@/lib/private-gallery-access";
import {
  getPrivateGalleryMemoryStore,
  MEMORY_GALLERY_CAPABILITY,
  MEMORY_GALLERY_HANDLE,
  MEMORY_PROOF_GALLERY_CAPABILITY,
  MEMORY_PROOF_GALLERY_HANDLE,
  resetPrivateGalleryMemoryStore,
} from "@/lib/private-gallery-memory-store";

const ORIGIN = "https://private.test";

async function cookie(handle = MEMORY_PROOF_GALLERY_HANDLE, capability = MEMORY_PROOF_GALLERY_CAPABILITY) {
  const store = getPrivateGalleryMemoryStore();
  const exchanged = await exchangePrivateGalleryCapability({
    exchangeStore: store.exchangeStore, sessionStore: store.sessionStore,
    keyring: store.keyring, routePrefix: "private",
    ipLimiter: createPrivateGalleryExchangeIpLimiter(),
  }, { handle, submittedSecret: capability, clientKey: "test-client", now: new Date() });
  if (!exchanged.ok) throw new Error("fixture exchange failed");
  return `${exchanged.cookie.name}=${exchanged.cookie.value}`;
}

function get(options: { handle?: string; cookie?: string; search?: string } = {}) {
  const handle = options.handle ?? MEMORY_PROOF_GALLERY_HANDLE;
  const request = new Request(`${ORIGIN}/private/${handle}/proof${options.search ?? ""}`, {
    headers: options.cookie === undefined ? {} : { cookie: options.cookie },
  });
  return GET(request, { params: Promise.resolve({ handle }) });
}

function mutate(body: unknown, options: {
  method?: "POST" | "PUT"; handle?: string; cookie?: string;
  origin?: string; raw?: string; search?: string;
} = {}) {
  const handle = options.handle ?? MEMORY_PROOF_GALLERY_HANDLE;
  const request = new Request(`${ORIGIN}/private/${handle}/proof${options.search ?? ""}`, {
    method: options.method ?? "POST",
    headers: {
      host: "private.test", origin: options.origin ?? ORIGIN,
      "sec-fetch-site": "same-origin", "content-type": "application/json",
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
    },
    body: options.raw ?? JSON.stringify(body),
  });
  return (options.method === "PUT" ? PUT : POST)(request, { params: Promise.resolve({ handle }) });
}

async function shape(response: Response) {
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("cache-control"),
    retryAfter: response.headers.get("retry-after"),
    setCookie: response.headers.get("set-cookie"),
  };
}

beforeEach(() => {
  settings.store = "memory";
  resetPrivateGalleryMemoryStore();
});

describe("GET/POST/PUT <prefix>/<handle>/proof", () => {
  it("reads a browser-safe proof page only with this gallery's current session", async () => {
    const proofCookie = await cookie();
    const response = await get({ cookie: proofCookie });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, view: {
      revision: 0, confirmed: false, totalCount: 2, pageIndex: 0,
      summary: { includedCount: 1, extraUnitPriceMinor: 1250, currency: "EUR",
        selectedCount: 0, extraCount: 0, extraTotalMinor: 0 },
      items: [
        { itemId: "memory-proof-01", reference: "001", width: 1800, height: 1200 },
        { itemId: "memory-proof-02", reference: "002", width: 1200, height: 1800 },
      ],
    } });
    expect(JSON.stringify(body)).not.toMatch(/objectKey|nominalBytes|mediaId|memory\/proof|owner@example|galleryId/);

    const deliveryCookie = await cookie(MEMORY_GALLERY_HANDLE, MEMORY_GALLERY_CAPABILITY);
    expect(await shape(await get({ cookie: deliveryCookie }))).toEqual(await shape(await get()));
  });

  it("keeps unknown, wrong-gallery, malformed, expired and unavailable reads identical", async () => {
    const proofCookie = await cookie();
    const baseline = await shape(await get());
    expect(baseline).toEqual({ status: 403, body: { ok: false },
      cacheControl: "no-store", retryAfter: null, setCookie: null });
    for (const response of [
      await get({ handle: "A".repeat(22), cookie: proofCookie }),
      await get({ handle: MEMORY_GALLERY_HANDLE, cookie: proofCookie }),
      await get({ cookie: proofCookie, search: "?page=-1" }),
      await get({ cookie: proofCookie, search: "?page=01" }),
      await get({ cookie: proofCookie, search: "?page=1" }),
      await get({ cookie: proofCookie, search: "?page=0&page=0" }),
      await get({ cookie: proofCookie, search: "?other=1" }),
    ]) expect(await shape(response)).toEqual(baseline);

    Object.assign(getPrivateGalleryMemoryStore().proofGallery, {
      accessExpiresAt: new Date(Date.now() - 1000),
    });
    expect(await shape(await get({ cookie: proofCookie }))).toEqual(baseline);
    settings.store = "off";
    expect(await shape(await get({ cookie: proofCookie }))).toEqual(baseline);
    settings.store = "enabled";
    expect(await shape(await get({ cookie: proofCookie }))).toEqual(baseline);
  });

  it("edits, confirms and reads one durable snapshot with one pending email", async () => {
    const proofCookie = await cookie();
    const edited = await mutate({ action: "edit", expectedRevision: 0,
      selectedReferences: ["002", "001"] }, { cookie: proofCookie });
    expect(await shape(edited)).toMatchObject({ status: 200, cacheControl: "no-store",
      body: { ok: true, action: "edit", revision: 1,
        summary: { selectedCount: 2, extraCount: 1, extraTotalMinor: 1250 } } });
    const review = await (await get({ cookie: proofCookie })).json();
    expect(review.view.selectedImages).toEqual([
      { reference: "002", filename: "IMG_0002.JPG" },
      { reference: "001", filename: "IMG_0001.JPG" },
    ]);
    const confirmed = await mutate({ action: "confirm", expectedRevision: 1 },
      { cookie: proofCookie, method: "PUT" });
    const confirmationBody = await confirmed.json();
    expect(confirmed.status).toBe(200);
    expect(confirmationBody).toMatchObject({ ok: true, action: "confirm", revision: 2,
      confirmationVersion: 1, summary: { selectedCount: 2, extraTotalMinor: 1250 } });
    expect(JSON.stringify(confirmationBody)).not.toMatch(/owner@example|customer|mediaId|outbox|galleryId/);
    expect((await (await get({ cookie: proofCookie })).json()).view).toMatchObject({
      confirmed: true, confirmationVersion: 1,
      selectedImages: [{ reference: "002" }, { reference: "001" }],
    });
    const store = getPrivateGalleryMemoryStore();
    expect((await store.proofStore.read(store.proofGallery.galleryId))?.latestConfirmationVersion).toBe(1);
    expect(await store.proofStore.readOutbox(store.proofGallery.galleryId,
      `proof-confirmation:${store.proofGallery.galleryId}:1`))
      .toMatchObject({ state: "pending", confirmationVersion: 1 });
    expect(await shape(await mutate({ action: "confirm", expectedRevision: 2 },
      { cookie: proofCookie }))).toMatchObject({ status: 409,
        body: { ok: false, reason: "conflict" }, cacheControl: "no-store" });
    expect((await store.proofStore.read(store.proofGallery.galleryId))?.latestConfirmationVersion).toBe(1);
  });

  it("gives generic write refusal for other-gallery access, bad origin and oversized body", async () => {
    const proofCookie = await cookie();
    const deliveryCookie = await cookie(MEMORY_GALLERY_HANDLE, MEMORY_GALLERY_CAPABILITY);
    const body = { action: "edit", expectedRevision: 0, selectedReferences: ["001"] };
    const baseline = await shape(await mutate(body));
    expect(baseline).toMatchObject({ status: 403, body: { ok: false }, cacheControl: "no-store" });
    for (const response of [
      await mutate(body, { cookie: deliveryCookie }),
      await mutate(body, { cookie: proofCookie, origin: "https://attacker.test" }),
      await mutate(body, { cookie: proofCookie, raw: " ".repeat(65_537) }),
      await mutate(body, { cookie: proofCookie, handle: MEMORY_GALLERY_HANDLE }),
    ]) expect(await shape(response)).toEqual(baseline);
    expect((await getPrivateGalleryMemoryStore().proofStore.read(
      getPrivateGalleryMemoryStore().proofGallery.galleryId))?.draft.revision).toBe(0);
  });
});
