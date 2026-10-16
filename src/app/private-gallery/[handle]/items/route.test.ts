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


import { GET } from "@/app/private-gallery/[handle]/items/route";
import { createPrivateGalleryExchangeIpLimiter, exchangePrivateGalleryCapability } from "@/lib/private-gallery-access";
import { getPrivateGalleryMemoryStore, resetPrivateGalleryMemoryStore, MEMORY_PAGED_GALLERY_HANDLE as HANDLE,
  MEMORY_PAGED_GALLERY_CAPABILITY as CAPABILITY, MEMORY_PROOF_GALLERY_HANDLE, MEMORY_PROOF_GALLERY_CAPABILITY } from "@/lib/private-gallery-memory-store";

async function cookie(handle = HANDLE, capability = CAPABILITY) {
  const store = getPrivateGalleryMemoryStore();
  const result = await exchangePrivateGalleryCapability({ ...store, routePrefix: "private", ipLimiter: createPrivateGalleryExchangeIpLimiter() },
    { handle, submittedSecret: capability, clientKey: "paging-test", now: new Date() });
  if (!result.ok) throw new Error("synthetic exchange failed");
  return `${result.cookie.name}=${result.cookie.value}`;
}
function get(search = "", session?: string, handle = HANDLE) {
  return GET(new Request(`https://private.test/private/${handle}/items${search}`, {
    headers: session === undefined ? {} : { cookie: session },
  }), { params: Promise.resolve({ handle }) });
}
beforeEach(() => { resetPrivateGalleryMemoryStore(); settings.store = "memory"; vi.restoreAllMocks(); });

describe("authorized delivery page API", () => {
  it("reads all 205 authored items through bounded pages with no raw storage fields", async () => {
    const session = await cookie();
    const ids: string[] = [];
    for (let index = 0; index < 3; index++) {
      const response = await get(`?page=${index}`, session);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("access-control-allow-origin")).toBeNull();
      const body = await response.json();
      expect(body.view).toMatchObject({ pageIndex: index, totalCount: 205, hasNextPage: index < 2 });
      expect(body.view.items).toHaveLength(index === 2 ? 5 : 100);
      expect(JSON.stringify(body)).not.toMatch(/objectKey|nominalBytes|galleryId|capability|memory\/preview/);
      ids.push(...body.view.items.map((item: { itemId: string }) => item.itemId));
    }
    expect(ids).toEqual(Array.from({ length: 205 }, (_, index) => `paged-delivery-${index + 1}`));
  });
  it.each(["?page=00", "?page=-1", "?page=+1", "?page=1.0", "?page=10", "?page=3", "?page=1&page=1", "?locale=en-GB", "?page=1&x=1", "?page=9007199254740992"])("refuses malformed or out-of-range query %s", async (query) => {
    const response = await get(query, await cookie());
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false });
  });
  it("uses the proof API's decoded-value grammar and defaults to page zero", async () => {
    const session = await cookie();
    expect((await (await get("", session)).json()).view.pageIndex).toBe(0);
    expect((await (await get("?page=%31", session)).json()).view.pageIndex).toBe(1);
  });
  it("never reads items for absent, duplicated, wrong-gallery or proof sessions", async () => {
    const store = getPrivateGalleryMemoryStore();
    const read = vi.spyOn(store.deliveryPageStore, "readPage");
    const session = await cookie();
    const proofSession = await cookie(MEMORY_PROOF_GALLERY_HANDLE, MEMORY_PROOF_GALLERY_CAPABILITY);
    for (const response of [await get(), await get("", `${session}; ${session}`), await get("", session, MEMORY_PROOF_GALLERY_HANDLE), await get("", proofSession, MEMORY_PROOF_GALLERY_HANDLE)]) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false });
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("re-authorizes against current generation, expiry and state on each later page", async () => {
    const store = getPrivateGalleryMemoryStore();
    const session = await cookie();
    expect((await get("?page=0", session)).status).toBe(200);
    const read = vi.spyOn(store.deliveryPageStore, "readPage");
    const find = store.viewStore.findGalleryById.bind(store.viewStore);
    const current = await find("memory-paged-delivery");
    if (!current) throw new Error("fixture missing");
    for (const change of [{ capabilityGeneration: current.capabilityGeneration + 1 }, { state: "access-suspended" as const }, { accessExpiresAt: new Date(0) }]) {
      vi.spyOn(store.viewStore, "findGalleryById").mockImplementation(async (id) => {
        const gallery = await find(id); return gallery === undefined ? undefined : { ...gallery, ...change };
      });
      expect((await get("?page=1", session)).status).toBe(403);
    }
    expect(read).not.toHaveBeenCalled();
  });
  it("refuses unavailable adapters and malformed snapshots identically", async () => {
    const session = await cookie();
    const store = getPrivateGalleryMemoryStore();
    vi.spyOn(store.deliveryPageStore, "readPage").mockResolvedValue({ placements: [], totalCount: 205 });
    expect((await get("?page=1", session)).status).toBe(403);
    settings.store = "enabled";
    expect((await get("?page=1", session)).status).toBe(403);
    settings.store = "off";
    expect((await get("?page=1", session)).status).toBe(403);
  });
});
