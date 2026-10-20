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

import { POST } from "@/app/private-gallery-admin/login/route";
import {
  getPrivateGalleryAdminStores,
  PRIVATE_GALLERY_FIXTURE_ADMIN_LOGIN_RATE_CONFIG,
} from "@/lib/private-gallery-access";
import { PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS } from "@/lib/private-gallery-admin-login";
import { MEMORY_ADMIN_SECRET, resetPrivateGalleryMemoryStore } from "@/lib/private-gallery-memory-store";

const ORIGIN = "https://private.test";
let address = 0;

// Each attempt from its own address, so only the deployment-wide counter can refuse it.
function login(secret: string) {
  address++;
  return POST(new Request(`${ORIGIN}/admin/login`, {
    method: "POST",
    headers: {
      host: "private.test", origin: ORIGIN, "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${address % 250}, 10.0.${Math.floor(address / 250)}.1`,
    },
    body: JSON.stringify({ secret }),
  }));
}

beforeEach(() => {
  settings.store = "memory";
  resetPrivateGalleryMemoryStore();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST <admin-prefix>/login with the development fixture (AB#377)", () => {
  it("still signs in after more failed attempts than the default global cap", async () => {
    for (let i = 0; i < PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS + 5; i++) {
      expect((await login("wrong-fixture-secret")).status).toBe(401);
    }
    const response = await login(MEMORY_ADMIN_SECRET);
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toMatch(/^__Host-pg_admin_session=/);
  });

  it("uses the larger cap only for the memory fixture, keeping the same window", () => {
    expect(getPrivateGalleryAdminStores().rateConfig).toBe(PRIVATE_GALLERY_FIXTURE_ADMIN_LOGIN_RATE_CONFIG);
    expect(PRIVATE_GALLERY_FIXTURE_ADMIN_LOGIN_RATE_CONFIG.maxAttempts).toBeGreaterThan(PRIVATE_GALLERY_ADMIN_LOGIN_MAX_ATTEMPTS);
    for (const store of ["off", "enabled"] as const) {
      settings.store = store;
      expect(() => getPrivateGalleryAdminStores()).toThrow();
    }
  });
});
