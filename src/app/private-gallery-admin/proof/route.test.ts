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

import { GET, PATCH, POST } from "@/app/private-gallery-admin/proof/route";
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

function request(method: "GET" | "POST" | "PATCH", cookie?: string, body?: unknown, origin = ORIGIN) {
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
  it("creates and updates only a prepublication draft through the shared memory store", async () => {
    const cookie = await adminCookie();
    const created = await POST(request("POST", cookie, { pricing: PRICING, customerReference: "customer-1" }));
    expect(created.status).toBe(201);
    expect(created.headers.get("cache-control")).toBe("no-store");
    const creation = await created.json();
    expect(creation).toMatchObject({ ok: true, draft: { revision: 0, pricing: PRICING } });
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
});
