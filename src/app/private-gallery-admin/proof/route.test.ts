import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({ store: "memory" as "memory" | "off" | "enabled" }));

vi.mock("@/lib/deployment-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/deployment-config")>();
  return { ...actual, getDeploymentConfig: () => ({ privateGallery: { store: settings.store, routePrefix: "private" } }) };
});
vi.mock("@/lib/private-gallery-deployment", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/private-gallery-deployment")>();
  return { ...actual, getPrivateGalleryDeployment: () => ({ store: settings.store, routePrefix: "private" }) };
});

import { GET, PATCH, POST, PUT } from "@/app/private-gallery-admin/proof/route";
import { attemptPrivateGalleryAdminLogin } from "@/lib/private-gallery-access";
import {
  getPrivateGalleryMemoryStore,
  MEMORY_ADMIN_SECRET,
  MEMORY_PROOF_GALLERY_HANDLE,
  resetPrivateGalleryMemoryStore,
} from "@/lib/private-gallery-memory-store";

const ORIGIN = "https://private.test";
const PRICING = { includedCount: 2, extraUnitPriceMinor: 1250, currency: "EUR" };

async function adminCookie() {
  const memory = getPrivateGalleryMemoryStore();
  const outcome = await attemptPrivateGalleryAdminLogin(
    { loginStore: memory.adminLoginStore, sessionStore: memory.adminSessionStore,
      ipLimiter: { tryConsume: () => ({ allowed: true }) },
      environment: { PRIVATE_GALLERY_ADMIN_SECRET_HASH: memory.adminCredentialHash } },
    { submittedSecret: MEMORY_ADMIN_SECRET, clientKey: "test-client", now: new Date() },
  );
  if (!outcome.ok) throw new Error("fixture administrator login failed");
  return `${outcome.cookie.name}=${outcome.cookie.value}`;
}

function request(method: "GET" | "POST" | "PATCH" | "PUT", cookie?: string, body?: unknown, origin = ORIGIN) {
  return new Request(`${ORIGIN}/admin/proof`, {
    method,
    headers: {
      host: "private.test", origin, "content-type": "application/json",
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  settings.store = "memory";
  resetPrivateGalleryMemoryStore();
});

describe("GET/POST/PATCH <admin-prefix>/proof", () => {
  it("returns the existing generic uncached unavailable response at development capacity", async () => {
    const cookie = await adminCookie();
    const store = getPrivateGalleryMemoryStore().proofDraftStore;
    for (let index = 0; index < 1000; index++) await store.create({ pricing: PRICING }, new Date());
    const full = await POST(request("POST", cookie, { pricing: PRICING, customerReference: "private-capacity-canary" }));
    expect(full.status).toBe(503);
    expect(full.headers.get("cache-control")).toBe("no-store");
    expect(full.headers.get("access-control-allow-origin")).toBeNull();
    expect(await full.text()).toBe('{"ok":false}');
    vi.spyOn(store, "create").mockRejectedValueOnce(new Error("unavailable secret-canary"));
    const unavailable = await POST(request("POST", cookie, { pricing: PRICING }));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toBe('{"ok":false}');
  });
  it("creates and updates only a prepublication draft through the shared memory store", async () => {
    const cookie = await adminCookie();
    const created = await POST(request("POST", cookie, { pricing: PRICING, customerReference: "customer-1" }));
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const creation = await created.json();
    expect(creation).toMatchObject({ ok: true, draft: { revision: 0, pricing: PRICING } });
    expect(creation.draft.state).toBe("draft");
    expect(JSON.stringify(creation)).not.toContain("galleryId");
    expect(JSON.stringify(creation)).not.toContain("capability");

    const edit = { handle: creation.draft.handle as string, expectedRevision: 0,
      pricing: { includedCount: 3, extraUnitPriceMinor: 900, currency: "USD" } };
    const updated = await PATCH(request("PATCH", cookie, edit));
    expect(updated.status).toBe(200);
    expect(updated.headers.get("cache-control")).toBe("no-store");
    expect(await updated.json()).toMatchObject({ ok: true, draft: { revision: 1, pricing: edit.pricing } });
    const listed = await GET(request("GET", cookie));
    expect(listed.status).toBe(200);
    expect(await listed.json()).toMatchObject({ ok: true, items: [{ revision: 1, pricing: edit.pricing }], hasMore: false });

    const stale = await PATCH(request("PATCH", cookie, edit));
    expect(stale.status).toBe(409);
    expect(stale.headers.get("cache-control")).toBe("no-store");
    expect(await stale.json()).toEqual({ ok: false });
    expect((await PATCH(request("PATCH", cookie, { ...edit, handle: MEMORY_PROOF_GALLERY_HANDLE }))).status)
      .toBe(404);
    expect(getPrivateGalleryMemoryStore().proofGallery.state).toBe("published");
  });

  it("keeps a stored preparation and object keys out of existing admin responses", async () => {
    const cookie = await adminCookie();
    const created = await POST(request("POST", cookie, { pricing: PRICING }));
    const { draft } = await created.json() as { draft: { handle: string } };
    const plan = await getPrivateGalleryMemoryStore().proofDraftStore.openFirstPreparation({
      handle: draft.handle, expectedRevision: 0, keyPrefix: "private-galleries",
      manifest: [{ kind: "derivative", derivativeKind: "watermarked-proof",
        nominalBytes: 900_000, width: 1200, height: 800,
        filename: "IMG_0001.JPG", mediaId: "media-1" }],
      now: new Date(),
    });
    const list = await GET(request("GET", cookie));
    expect(list.status).toBe(200);
    const listText = await list.text();
    expect(JSON.parse(listText)).toMatchObject({ items: [{ state: "preparing", upload: {
      objectCount: 1, openedAt: plan.preparation.openedAt.toISOString(), deadline: plan.preparation.deadline.toISOString(), expired: false,
    } }] });
    expect(listText).not.toContain("preparation");
    expect(listText).not.toContain("objectKey");
    expect(listText).not.toContain(plan.objects[0].objectKey);
    expect(listText).not.toContain("galleryId");

    const edit = await PATCH(request("PATCH", cookie, { handle: draft.handle,
      expectedRevision: 1, pricing: { ...PRICING, includedCount: 4 } }));
    expect(edit.status).toBe(200);
    const editText = await edit.text();
    expect(editText).not.toContain("preparation");
    expect(editText).not.toContain("objectKey");
    expect(editText).not.toContain(plan.objects[0].objectKey);
    expect(editText).not.toContain("galleryId");

    const completed = await getPrivateGalleryMemoryStore().proofDraftStore.completeFirstPreparation({
      handle: draft.handle, expectedRevision: 2,
      preparationId: plan.preparation.preparationId, receipts: [],
      observations: plan.objects.map(object => ({ objectKey: object.objectKey, sizeBytes: object.nominalBytes })),
      now: new Date(),
    });
    expect(completed.ready).toBe(true);
    const readyList = await GET(request("GET", cookie));
    expect(readyList.status).toBe(200);
    const readyText = await readyList.text();
    expect(JSON.parse(readyText)).toMatchObject({ items: [{ state: "ready", upload: { objectCount: 1 } }] });
    for (const field of ["preparation", "readyProof", "pricingSnapshot", "verifiedObjects", "placements", "objectKey", "galleryId"]) {
      expect(readyText).not.toContain(field);
    }
    expect(readyText).not.toContain(plan.objects[0].objectKey);
    expect(readyText).not.toContain("IMG_0001.JPG");
    expect((await PATCH(request("PATCH", cookie, { handle: draft.handle,
      expectedRevision: 3, pricing: PRICING }))).status).toBe(409);
  });

  it("refuses unauthenticated, cross-origin, malformed and disabled edits", async () => {
    const cookie = await adminCookie();
    const body = { handle: "A".repeat(22), expectedRevision: 0, pricing: PRICING };
    expect((await PATCH(request("PATCH", undefined, body))).status).toBe(401);
    expect((await PATCH(request("PATCH", cookie, body, "https://other.test"))).status).toBe(400);
    expect((await PATCH(request("PATCH", cookie, { ...body, other: true }))).status).toBe(400);
    settings.store = "off";
    expect((await PATCH(request("PATCH", cookie, body))).status).toBe(404);
    settings.store = "enabled";
    expect((await PATCH(request("PATCH", cookie, body))).status).toBe(401);
  });
  it("refuses the entire list when one privileged record is malformed", async () => {
    const cookie = await adminCookie();
    await POST(request("POST", cookie, { pricing: PRICING }));
    const store = getPrivateGalleryMemoryStore().proofDraftStore;
    const row = (await store.list(1)).items[0];
    vi.spyOn(store, "list").mockResolvedValueOnce({ items: [row, { ...row, gallery: { ...row.gallery, state: "published" } }], hasMore: false });
    const response = await GET(request("GET", cookie));
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ ok: false });
  });
});

describe("PUT proof draft references", () => {
  it("reauthorizes, safely replaces and clears refs and refuses stale updates", async () => {
    const cookie = await adminCookie();
    const { draft } = await (await POST(request("POST", cookie, { pricing: PRICING, customerReference: "old" }))).json();
    const value = { handle: draft.handle, expectedRevision: 0, references: { jobReference: "edited" } };
    const changed = await PUT(request("PUT", cookie, value));
    expect(changed.status).toBe(200); expect(changed.headers.get("cache-control")).toBe("no-store");
    const result = await changed.json();
    expect(result.draft).toEqual({ ...draft, customerReference: undefined, jobReference: "edited", revision: 1 });
    expect(JSON.stringify(result)).not.toContain("galleryId");
    expect((await PUT(request("PUT", cookie, value))).status).toBe(409);
    expect((await PUT(request("PUT", cookie, { ...value, handle: "A".repeat(22) }))).status).toBe(404);
    const cleared = await PUT(request("PUT", cookie, { ...value, expectedRevision: 1, references: {} }));
    expect((await cleared.json()).draft).not.toHaveProperty("jobReference");
  });
  it.each([undefined, "__Secure-pg_session=customer"])("does not read unauthorized body %s", async (auth) => {
    const req = request("PUT", auth, {});
    const reader = vi.spyOn(req.body!, "getReader");
    expect((await PUT(req)).status).toBe(401); expect(reader).not.toHaveBeenCalled();
  });
  it("checks provenance before body IO and hides all malformed/private data", async () => {
    const auth = await adminCookie();
    const invalidOrigin = request("PUT", auth, {}, "https://other.test");
    const reader = vi.spyOn(invalidOrigin.body!, "getReader");
    expect((await PUT(invalidOrigin)).status).toBe(400); expect(reader).not.toHaveBeenCalled();
    const canary = "PRIVATE-REF-CANARY";
    for (const raw of ["{", "[]", "null", JSON.stringify({ handle: "A".repeat(22), expectedRevision: 0, references: { extra: canary } }),
      '{"handle":"' + "A".repeat(22) + '","expectedRevision":0,"references":{"__proto__":"' + canary + '"}}',
      " ".repeat(1025)]) {
      const response = await PUT(new Request(ORIGIN + "/admin/proof", { method: "PUT",
        headers: { cookie: auth, origin: ORIGIN, host: "private.test", "content-type": "application/json; charset=utf-8" }, body: raw }));
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false });
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
  it("accepts worst-case valid escaped refs within streamed 1KiB and honors off/adapter gates", async () => {
    const auth = await adminCookie();
    const { draft } = await (await POST(request("POST", auth, { pricing: PRICING }))).json();
    const input = { handle: draft.handle, expectedRevision: 0, references: { customerReference: '"'.repeat(128), jobReference: "\\".repeat(128) } };
    const raw = JSON.stringify(input); expect(Buffer.byteLength(raw)).toBeLessThan(1024);
    const response = await PUT(new Request(ORIGIN + "/admin/proof", { method: "PUT", headers: {
      cookie: auth, host: "private.test", origin: ORIGIN, "content-type": "application/json" },
      body: new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(raw)); controller.close(); } }), duplex: "half",
    } as RequestInit));
    expect(response.status).toBe(200);
    settings.store = "off"; expect((await PUT(request("PUT", auth, input))).status).toBe(404);
    settings.store = "enabled"; expect((await PUT(request("PUT", auth, input))).status).toBe(401);
  });
});
