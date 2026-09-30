import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  store: "memory" as "off" | "enabled" | "memory",
  objectStoreEnabled: true,
}));
const log = vi.hoisted(() => ({ write: vi.fn() }));

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({
    privateGallery: { store: settings.store, routePrefix: "private" },
  }),
}));
vi.mock("@/lib/private-gallery-deployment", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/private-gallery-deployment")>();
  return {
    ...actual,
    getPrivateGalleryDeployment: () => ({
      store: settings.store,
      routePrefix: "private",
    }),
  };
});
vi.mock("@/lib/private-gallery-config", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/private-gallery-config")>();
  return {
    ...actual,
    getPrivateGalleryRuntimeConfig: () => {
      if (!settings.objectStoreEnabled) {
        throw new actual.PrivateGalleryConfigurationError("not provisioned");
      }
      return {
        objectStore: {
          endpoint: "https://private-objects.test",
          bucket: "private-bucket",
          region: "eu-test-1",
          keyPrefix: "memory",
          verifierAccessKeyId: "fixture-key",
          verifierSecretAccessKey: "fixture-secret",
        },
      };
    },
  };
});
vi.mock("@/lib/contact-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contact-log")>();
  return { ...actual, logPrivateGalleryMintEvent: log.write };
});

import { POST } from "@/app/private-gallery/[handle]/asset/route";
import {
  createPrivateGalleryExchangeIpLimiter,
  exchangePrivateGalleryCapability,
} from "@/lib/private-gallery-access";
import {
  getPrivateGalleryMemoryStore,
  MEMORY_GALLERY_CAPABILITY,
  MEMORY_GALLERY_HANDLE,
  resetPrivateGalleryMemoryStore,
} from "@/lib/private-gallery-memory-store";

const ORIGIN = "https://private.test";

async function sessionCookie(): Promise<string> {
  const store = getPrivateGalleryMemoryStore();
  const result = await exchangePrivateGalleryCapability(
    {
      exchangeStore: store.exchangeStore,
      sessionStore: store.sessionStore,
      keyring: store.keyring,
      routePrefix: "private",
      ipLimiter: createPrivateGalleryExchangeIpLimiter(),
    },
    {
      handle: MEMORY_GALLERY_HANDLE,
      submittedSecret: MEMORY_GALLERY_CAPABILITY,
      clientKey: "test-client",
      now: new Date(),
    },
  );
  if (!result.ok) throw new Error("fixture exchange failed");
  return `${result.cookie.name}=${result.cookie.value}`;
}

function post(
  body: unknown,
  options: {
    handle?: string;
    cookie?: string;
    headers?: Record<string, string>;
    raw?: string;
  } = {},
): Promise<Response> {
  const handle = options.handle ?? MEMORY_GALLERY_HANDLE;
  const request = new Request(`${ORIGIN}/private/${handle}/asset`, {
    method: "POST",
    headers: {
      host: "private.test",
      origin: ORIGIN,
      "content-type": "application/json",
      ...(options.cookie === undefined ? {} : { cookie: options.cookie }),
      ...options.headers,
    },
    body: options.raw ?? JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ handle }) });
}

async function refusalShape(response: Response) {
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
  settings.objectStoreEnabled = true;
  log.write.mockClear();
  resetPrivateGalleryMemoryStore();
});

describe("POST <prefix>/<handle>/asset", () => {
  it("mints one short-lived GET for an authorized preview without returning store internals", async () => {
    const response = await post(
      { kind: "preview", placementId: "memory-placement-01" },
      { cookie: await sessionCookie() },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "ok", "url"]);
    expect(body.ok).toBe(true);
    const url = new URL(body.url);
    expect(url.origin).toBe("https://private-objects.test");
    expect(url.pathname).toBe("/private-bucket/memory/preview/01.webp");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
    expect(url.searchParams.get("response-cache-control")).toBe("no-store");
    expect(Date.parse(body.expiresAt) - Date.now()).toBeLessThanOrEqual(5 * 60_000);
    expect(JSON.stringify(body)).not.toContain(MEMORY_GALLERY_CAPABILITY);
    expect(log.write.mock.calls[0]?.[0]).toMatchObject({ state: "accepted" });
    expect(JSON.stringify(log.write.mock.calls)).not.toContain(MEMORY_GALLERY_HANDLE);
  });

  it("never reads an asset or spends budget without a currently valid session", async () => {
    const store = getPrivateGalleryMemoryStore();
    const lookup = vi.spyOn(store.deliveryStore, "findPlacement");
    const charge = vi.spyOn(store.deliveryStore, "consumeAccessBudget");
    const cookie = await sessionCookie();
    Object.assign(store.gallery, { capabilityGeneration: 2 });

    const response = await post(
      { kind: "preview", placementId: "memory-placement-01" },
      { cookie },
    );
    expect(await refusalShape(response)).toEqual({
      status: 403,
      body: { ok: false },
      cacheControl: "no-store",
      retryAfter: null,
      setCookie: null,
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(charge).not.toHaveBeenCalled();
  });

  it("refuses a placement resolved into another gallery before charging", async () => {
    const store = getPrivateGalleryMemoryStore();
    const fixture = await store.deliveryStore.findPlacement(
      store.gallery.galleryId,
      "memory-placement-01",
    );
    if (fixture === undefined) throw new Error("fixture placement missing");
    vi.spyOn(store.deliveryStore, "findPlacement").mockResolvedValue({
      ...fixture,
      galleryId: "another-gallery",
    });
    const charge = vi.spyOn(store.deliveryStore, "consumeAccessBudget");

    const response = await post(
      { kind: "preview", placementId: fixture.placementId },
      { cookie: await sessionCookie() },
    );
    expect(response.status).toBe(403);
    expect(charge).not.toHaveBeenCalled();
  });

  it("limits one session to 60 mints in a rolling minute", async () => {
    const store = getPrivateGalleryMemoryStore();
    const charge = vi.spyOn(store.deliveryStore, "consumeAccessBudget");
    // Isolate the per-session ceiling from this fixture's smaller byte budget.
    vi.spyOn(store.deliveryStore, "totalGalleryBytes").mockResolvedValue(
      100_000_000,
    );
    const cookie = await sessionCookie();
    for (let index = 0; index < 60; index += 1) {
      const response = await post(
        { kind: "preview", placementId: "memory-placement-01" },
        { cookie },
      );
      expect(response.status).toBe(200);
    }
    const refused = await post(
      { kind: "preview", placementId: "memory-placement-01" },
      { cookie },
    );
    expect(refused.status).toBe(403);
    expect(charge).toHaveBeenCalledTimes(60);
    expect(log.write.mock.calls.at(-1)?.[0]).toMatchObject({
      state: "rejected",
      errorClass: "mint-rate-limited",
    });
    // A second independently exchanged session has its own rate window.
    expect((await post(
      { kind: "preview", placementId: "memory-placement-01" },
      { cookie: await sessionCookie() },
    )).status).toBe(200);
  });

  it("returns the same refusal for bad requests, unavailable assets, and missing store config", async () => {
    const cookie = await sessionCookie();
    const cases = [
      () => post({ kind: "zip" }, { cookie }),
      () => post({ kind: "preview", placementId: "unknown" }, { cookie }),
      () => post({ kind: "preview", placementId: "memory-placement-01", objectKey: "x" }, { cookie }),
      () => post({ kind: "preview", placementId: "memory-placement-01" }, { cookie, headers: { origin: "https://attacker.test" } }),
      () => post({ kind: "preview", placementId: "memory-placement-01" }, { cookie, raw: "x".repeat(1024) }),
      () => post({ kind: "preview", placementId: "memory-placement-01" }),
      () => post({ kind: "preview", placementId: "memory-placement-01" }, { cookie, handle: Buffer.alloc(16, 0x33).toString("base64url") }),
    ];
    const expected = await refusalShape(await cases[0]());
    for (const invoke of cases.slice(1)) {
      expect(await refusalShape(await invoke())).toEqual(expected);
    }
    settings.objectStoreEnabled = false;
    expect(await refusalShape(await post(
      { kind: "preview", placementId: "memory-placement-01" },
      { cookie },
    ))).toEqual(expected);
    settings.store = "off";
    expect(await refusalShape(await post(
      { kind: "preview", placementId: "memory-placement-01" },
      { cookie },
    ))).toEqual(expected);
  });
});
