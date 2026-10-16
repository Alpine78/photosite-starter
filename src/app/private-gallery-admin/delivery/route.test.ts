import { beforeEach, describe, expect, it, vi } from "vitest";
const settings = vi.hoisted(() => ({ store: "memory" as "memory" | "off" | "enabled" }));
vi.mock("@/lib/deployment-config", async (original) => ({ ...await original<typeof import("@/lib/deployment-config")>(), getDeploymentConfig: () => ({ privateGallery: { store: settings.store } }) }));
vi.mock("@/lib/private-gallery-deployment", async (original) => ({ ...await original<typeof import("@/lib/private-gallery-deployment")>(), getPrivateGalleryDeployment: () => ({ store: settings.store, routePrefix: "private" }) }));
import { GET, POST, PATCH } from "./route";
import { attemptPrivateGalleryAdminLogin, createPrivateGalleryDeliveryDraftAsAdmin, getPrivateGalleryAdminStores,
  exchangePrivateGalleryCapability, createPrivateGalleryExchangeIpLimiter } from "@/lib/private-gallery-access";
import { getPrivateGalleryMemoryStore, resetPrivateGalleryMemoryStore, MEMORY_ADMIN_SECRET } from "@/lib/private-gallery-memory-store";
const ORIGIN = "https://private.test";
async function cookie() {
  const memory = getPrivateGalleryMemoryStore();
  const result = await attemptPrivateGalleryAdminLogin({ loginStore: memory.adminLoginStore, sessionStore: memory.adminSessionStore,
    ipLimiter: { tryConsume: () => ({ allowed: true }) }, environment: { PRIVATE_GALLERY_ADMIN_SECRET_HASH: memory.adminCredentialHash } },
  { submittedSecret: MEMORY_ADMIN_SECRET, clientKey: "fixture", now: new Date() });
  if (!result.ok) throw new Error("fixture login failed");
  return `${result.cookie.name}=${result.cookie.value}`;
}
function req(method: "GET" | "POST" | "PATCH", auth?: string, body = "{}", headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/admin/delivery`, { method,
    headers: { host: "private.test", origin: ORIGIN, "content-type": "application/json", ...(auth ? { cookie: auth } : {}), ...headers },
    ...(method !== "GET" ? { body } : {}) });
}
beforeEach(() => { settings.store = "memory"; resetPrivateGalleryMemoryStore(); });
describe("administrator delivery draft route", () => {
  it("edits and clears external references with a closed uncached projection and revision guard", async () => {
    const auth = await cookie();
    const { draft } = await (await POST(req("POST", auth, '{"customerReference":"original"}'))).json();
    const input = { handle: draft.handle, expectedRevision: 0, references: { jobReference: "job-edited" } };
    const response = await PATCH(req("PATCH", auth, JSON.stringify(input)));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({ ok: true, draft: { handle: draft.handle, createdAt: draft.createdAt, revision: 1, jobReference: "job-edited" } });
    const conflict = await PATCH(req("PATCH", auth, JSON.stringify(input)));
    expect(conflict.status).toBe(409); expect(await conflict.json()).toEqual({ ok: false });
    const cleared = await PATCH(req("PATCH", auth, JSON.stringify({ ...input, expectedRevision: 1, references: {} })));
    expect(await cleared.json()).toEqual({ ok: true, draft: { handle: draft.handle, createdAt: draft.createdAt, revision: 2 } });
    const missing = await PATCH(req("PATCH", auth, JSON.stringify({ ...input, handle: "Z".repeat(22) })));
    expect(missing.status).toBe(404);
  });
  it.each([undefined, "__Secure-pg_session=customer"])("refuses unauthorized updates before reading %s", async (auth) => {
    const request = req("PATCH", auth);
    const reader = vi.spyOn(request.body!, "getReader");
    const response = await PATCH(request);
    expect(response.status).toBe(401); expect(reader).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it.each([{ origin: "https://other.test" }, { "content-type": "text/plain" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[])("checks update provenance before body reads %j", async (headers) => {
    const request = req("PATCH", await cookie(), "{}", headers);
    const reader = vi.spyOn(request.body!, "getReader");
    expect((await PATCH(request)).status).toBe(400); expect(reader).not.toHaveBeenCalled();
  });
  it.each(["null", "[]", "{", " ".repeat(1025), '{"handle":"A","expectedRevision":0,"references":{}}',
    JSON.stringify({ handle: "A".repeat(22), expectedRevision: 0, references: {}, state: "published" }),
    JSON.stringify({ handle: "A".repeat(22), expectedRevision: 0, references: { jobReference: 3 } })])("refuses malformed PATCH %s", async (body) => {
    const response = await PATCH(req("PATCH", await cookie(), body));
    expect(response.status).toBe(400); expect(await response.json()).toEqual({ ok: false });
    expect((await getPrivateGalleryAdminStores().deliveryDraftStore.list(100)).items).toEqual([]);
  });
  it("creates and lists a safe projection while leaving the gallery customer-inaccessible", async () => {
    const auth = await cookie();
    const response = await POST(req("POST", auth, JSON.stringify({ customerReference: "client-1", jobReference: "job-1" })));
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const created = await response.json();
    expect(created).toMatchObject({ ok: true, draft: { customerReference: "client-1", jobReference: "job-1", revision: 0 } });
    expect(Object.keys(created.draft).sort()).toEqual(["createdAt", "customerReference", "handle", "jobReference", "revision"]);
    const list = await GET(req("GET", auth));
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ ok: true, items: [created.draft], hasMore: false });
    const memory = getPrivateGalleryMemoryStore();
    const deps = { exchangeStore: memory.exchangeStore, sessionStore: memory.sessionStore, keyring: memory.keyring,
      routePrefix: "private", ipLimiter: createPrivateGalleryExchangeIpLimiter() };
    const now = new Date();
    const input = { submittedSecret: "A".repeat(43), clientKey: "customer", now };
    const draftExchange = await exchangePrivateGalleryCapability(deps, { ...input, handle: created.draft.handle });
    const unknownExchange = await exchangePrivateGalleryCapability(deps, { ...input, handle: "A".repeat(22) });
    expect(draftExchange.ok).toBe(false); expect(unknownExchange.ok).toBe(false);
    if (!draftExchange.ok && !unknownExchange.ok) expect(draftExchange.failure.reason).toBe(unknownExchange.failure.reason);
    expect(memory.gallery.state).toBe("published");
  });
  it.each([undefined, "__Secure-pg_session=customer", "__Host-pg_admin_session=bad", "__Host-pg_admin_session=A; __Host-pg_admin_session=B"])("refuses non-administrator cookies %s before reading", async (auth) => {
    const request = req("POST", auth);
    const getReader = vi.spyOn(request.body!, "getReader");
    expect((await POST(request)).status).toBe(401);
    expect(getReader).not.toHaveBeenCalled();
    expect((await GET(req("GET", auth))).status).toBe(401);
  });
  it.each([{ origin: "https://other.test" }, { "content-type": "text/plain" }, { "sec-fetch-site": "cross-site" }] as Record<string, string>[])("refuses bad request provenance before body reads %j", async (headers) => {
    const request = req("POST", await cookie(), "{}", headers);
    const getReader = vi.spyOn(request.body!, "getReader");
    expect((await POST(request)).status).toBe(400);
    expect(getReader).not.toHaveBeenCalled();
  });
  it.each(["", "[1]", "null", "{bad", '{"pricing":{}}', '{"customerReference":""}', JSON.stringify({ jobReference: "a\nb" }), JSON.stringify({ jobReference: "ä".repeat(65) }), " ".repeat(1025)])("refuses malformed/oversized payload %s", async (body) => {
    const response = await POST(req("POST", await cookie(), body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false });
    expect((await getPrivateGalleryAdminStores().deliveryDraftStore.list(100)).items).toEqual([]);
  });
  it("refuses a revoked/expired administrator credential on the next mutation", async () => {
    const auth = await cookie(); const stores = getPrivateGalleryAdminStores();
    const expired = await createPrivateGalleryDeliveryDraftAsAdmin(stores, req("POST", auth), new Date(Date.now() + 3 * 60 * 60 * 1000));
    expect(expired).toEqual({ ok: false, reason: "unauthorized" });
    const missingCredential = await createPrivateGalleryDeliveryDraftAsAdmin({ ...stores, environment: {} }, req("POST", auth), new Date());
    expect(missingCredential).toEqual({ ok: false, reason: "unauthorized" });
  });
  it("follows existing fixture reset, and refuses disabled/unprovisioned stores without fallback", async () => {
    const auth = await cookie(); await POST(req("POST", auth));
    resetPrivateGalleryMemoryStore();
    expect((await getPrivateGalleryAdminStores().deliveryDraftStore.list(100)).items).toEqual([]);
    for (const store of ["off", "enabled"] as const) {
      settings.store = store;
      for (const response of [await POST(req("POST", auth)), await GET(req("GET", auth)), await PATCH(req("PATCH", auth))]) {
        expect(response.status).toBe(store === "off" ? 404 : 401);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("access-control-allow-origin")).toBeNull();
      }
    }
  });
});
