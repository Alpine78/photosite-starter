import { beforeEach, describe, expect, it, vi } from "vitest";
const settings = vi.hoisted(() => ({ store: "memory" as "memory" | "off" }));
vi.mock("@/lib/deployment-config", async (original) => ({ ...await original<typeof import("@/lib/deployment-config")>(), getDeploymentConfig: () => ({ privateGallery: { store: settings.store } }) }));
vi.mock("@/lib/private-gallery-deployment", async (original) => ({ ...await original<typeof import("@/lib/private-gallery-deployment")>(), getPrivateGalleryDeployment: () => ({ store: settings.store, routePrefix: "private" }) }));
import { GET as proofGET } from "./proof/route";
import { GET as deliveryGET } from "./delivery/route";
import { attemptPrivateGalleryAdminLogin, getPrivateGalleryAdminStores } from "@/lib/private-gallery-access";
import { getPrivateGalleryMemoryStore, resetPrivateGalleryMemoryStore, MEMORY_ADMIN_SECRET } from "@/lib/private-gallery-memory-store";
import { buildPrivateDraftCursor } from "@/lib/private-gallery-draft-cursor";

async function cookie() {
  const memory = getPrivateGalleryMemoryStore();
  const result = await attemptPrivateGalleryAdminLogin({ loginStore: memory.adminLoginStore, sessionStore: memory.adminSessionStore,
    ipLimiter: { tryConsume: () => ({ allowed: true }) }, environment: { PRIVATE_GALLERY_ADMIN_SECRET_HASH: memory.adminCredentialHash } },
  { submittedSecret: MEMORY_ADMIN_SECRET, clientKey: "pagination", now: new Date() });
  if (!result.ok) throw new Error("fixture login failed");
  return result.cookie.name + "=" + result.cookie.value;
}
beforeEach(() => { settings.store = "memory"; resetPrivateGalleryMemoryStore(); });
for (const kind of ["proof", "delivery"] as const) {
  describe(kind + " administrator draft page boundary", () => {
    const GET = kind === "proof" ? proofGET : deliveryGET;
    const req = (query = "", auth?: string) => new Request("https://private.test/admin/" + kind + query,
      { headers: auth ? { cookie: auth } : {} });
    it("lists all101 records in two private pages without internal data or a customer link", async () => {
      const auth = await cookie();
      const stores = getPrivateGalleryAdminStores();
      for (let i = 0; i < 101; i++) await (kind === "proof" ? stores.proofDraftStore.create({ pricing: { includedCount: 0, extraUnitPriceMinor: 0, currency: "EUR" } }, new Date()) : stores.deliveryDraftStore.create({}, new Date()));
      const first = await GET(req("", auth));
      expect(first.headers.get("cache-control")).toBe("no-store");
      const page = await first.json();
      expect(page.items).toHaveLength(100); expect(page.hasMore).toBe(true);
      const second = await GET(req("?cursor=" + page.nextCursor, auth));
      const end = await second.json();
      expect(end.items).toHaveLength(1); expect(end.hasMore).toBe(false); expect(end.nextCursor).toBeUndefined();
      expect(new Set([...page.items, ...end.items].map((r) => r.handle)).size).toBe(101);
      for (const forbidden of ["galleryId", "capability", "objectKey", "filename", "preparationId"]) expect(JSON.stringify([page, end])).not.toContain(forbidden);
    });
    it.each(["?cursor=", "?cursor=x", "?cursor=x&cursor=y", "?unknown=canary", "?cursor=" + buildPrivateDraftCursor(kind, "A".repeat(22)),
      "?cursor=" + buildPrivateDraftCursor(kind === "proof" ? "delivery" : "proof", "A".repeat(22))])("authorizes before refusing malformed/unknown page %s", async (query) => {
      expect((await GET(req(query))).status).toBe(401);
      const response = await GET(req(query, await cookie()));
      expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false });
      expect(response.headers.get("cache-control")).toBe("no-store");
      settings.store = "off";
      expect((await GET(req(query))).status).toBe(404);
    });
  });
}
