import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const config = vi.hoisted(() => ({
  store: "memory" as "off" | "enabled" | "memory",
  routePrefix: "private",
}));
const log = vi.hoisted(() => ({ write: vi.fn() }));

vi.mock("@/lib/deployment-config", () => ({
  getDeploymentConfig: () => ({ privateGallery: { ...config } }),
}));

vi.mock("@/lib/contact-log", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/contact-log")>();
  return { ...actual, logPrivateGalleryExchangeEvent: log.write };
});

vi.mock("@/lib/private-gallery-deployment", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/private-gallery-deployment")>();
  return { ...actual, getPrivateGalleryDeployment: () => ({ ...config }) };
});

import { POST } from "@/app/private-gallery/[handle]/exchange/route";
import {
  MEMORY_GALLERY_CAPABILITY,
  MEMORY_GALLERY_HANDLE,
  resetPrivateGalleryMemoryStore,
} from "@/lib/private-gallery-memory-store";

const ORIGIN = "https://private.test";

/**
 * A handle of the right shape that names no gallery. It has to decode
 * *canonically*, or it is refused as malformed before the store is ever asked —
 * which would make every "unknown handle" case below silently test the
 * malformed path instead.
 */
const UNKNOWN_HANDLE = Buffer.alloc(16, 0x33).toString("base64url");

function post(
  handle: string,
  body: unknown,
  init: { headers?: Record<string, string>; raw?: string } = {},
) {
  const request = new Request(`${ORIGIN}/private/${handle}/exchange`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      host: "private.test",
      origin: ORIGIN,
      ...init.headers,
    },
    body: init.raw ?? JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ handle }) });
}

/**
 * The one answer every refusal must produce. A test that asserted only the
 * status would miss the actual requirement: an existence oracle can hide in a
 * header or a body field just as easily as in a status code.
 */
async function refusalShape(response: Response) {
  return {
    status: response.status,
    body: await response.clone().json(),
    setCookie: response.headers.get("set-cookie"),
    retryAfter: response.headers.get("retry-after"),
    cacheControl: response.headers.get("cache-control"),
  };
}

beforeEach(() => {
  config.store = "memory";
  config.routePrefix = "private";
  log.write.mockClear();
  resetPrivateGalleryMemoryStore();
});

afterEach(() => {
  resetPrivateGalleryMemoryStore();
});

describe("POST <prefix>/<handle>/exchange", () => {
  it("exchanges the fixture link for a session cookie", async () => {
    const response = await post(MEMORY_GALLERY_HANDLE, {
      capability: MEMORY_GALLERY_CAPABILITY,
    });

    expect(response.status).toBe(200);
    await expect(response.clone().json()).resolves.toEqual({ ok: true });

    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("__Secure-");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=lax");
    // Scoped to this gallery's own public path, not the site root.
    expect(cookie).toContain(`Path=/private/${MEMORY_GALLERY_HANDLE}`);
    // No `Domain`, so the cookie stays host-only.
    expect(cookie.toLowerCase()).not.toContain("domain=");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("carries neither the handle nor the capability into the accepted event", async () => {
    await post(MEMORY_GALLERY_HANDLE, { capability: MEMORY_GALLERY_CAPABILITY });

    expect(log.write).toHaveBeenCalledTimes(1);
    const [event] = log.write.mock.calls[0];
    expect(event).toMatchObject({ state: "accepted" });
    expect(JSON.stringify(event)).not.toContain(MEMORY_GALLERY_HANDLE);
    expect(JSON.stringify(event)).not.toContain(MEMORY_GALLERY_CAPABILITY);
  });
});

describe("every refusal answers identically", () => {
  /**
   * The classes a prober can actually reach, spanning the whole handler: the
   * feature switch, the header guard, handle shape, body shape, and the
   * facade's own credential and rate refusals. If any one of these ever
   * diverges, the endpoint has become an existence oracle for gallery handles.
   */
  const cases: ReadonlyArray<[string, () => Promise<Response>]> = [
    [
      "an unknown but well-formed handle",
      () => post(UNKNOWN_HANDLE, { capability: MEMORY_GALLERY_CAPABILITY }),
    ],
    [
      "the real handle with a wrong capability",
      () => post(MEMORY_GALLERY_HANDLE, { capability: "A".repeat(43) }),
    ],
    [
      "a malformed handle",
      () => post("not-a-handle", { capability: MEMORY_GALLERY_CAPABILITY }),
    ],
    ["a missing capability field", () => post(MEMORY_GALLERY_HANDLE, {})],
    [
      "an extra field beside the capability",
      () =>
        post(MEMORY_GALLERY_HANDLE, {
          capability: MEMORY_GALLERY_CAPABILITY,
          admin: true,
        }),
    ],
    [
      "a non-string capability",
      () => post(MEMORY_GALLERY_HANDLE, { capability: 42 }),
    ],
    [
      "a body that is not JSON",
      () => post(MEMORY_GALLERY_HANDLE, undefined, { raw: "not json" }),
    ],
    [
      "a JSON array body",
      () => post(MEMORY_GALLERY_HANDLE, undefined, { raw: "[]" }),
    ],
    [
      "an oversized body",
      () =>
        post(MEMORY_GALLERY_HANDLE, {
          capability: "A".repeat(2048),
        }),
    ],
    [
      "a cross-origin request",
      () =>
        post(
          MEMORY_GALLERY_HANDLE,
          { capability: MEMORY_GALLERY_CAPABILITY },
          { headers: { origin: "https://attacker.test" } },
        ),
    ],
    [
      "a form-encoded content type",
      () =>
        post(
          MEMORY_GALLERY_HANDLE,
          { capability: MEMORY_GALLERY_CAPABILITY },
          { headers: { "content-type": "application/x-www-form-urlencoded" } },
        ),
    ],
    [
      "a deployment with the feature off",
      () => {
        config.store = "off";
        return post(MEMORY_GALLERY_HANDLE, {
          capability: MEMORY_GALLERY_CAPABILITY,
        });
      },
    ],
    [
      "a deployment whose store adapter does not exist yet",
      () => {
        config.store = "enabled";
        return post(MEMORY_GALLERY_HANDLE, {
          capability: MEMORY_GALLERY_CAPABILITY,
        });
      },
    ],
  ];

  const EXPECTED = {
    status: 403,
    body: { ok: false },
    setCookie: null,
    retryAfter: null,
    cacheControl: "no-store",
  };

  it.each(cases)("refuses %s with the one shared answer", async (_case, run) => {
    expect(await refusalShape(await run())).toEqual(EXPECTED);
  });

  it("answers a throttled known handle exactly like an unknown one", async () => {
    // The sharpest case: the two states a rate limit would otherwise separate.
    // Spend the window on the real handle, then compare.
    let throttled: Response | undefined;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await post(MEMORY_GALLERY_HANDLE, {
        capability: "A".repeat(43),
      });
      if (response.status === 403) throttled = response;
    }
    const unknown = await post(UNKNOWN_HANDLE, {
      capability: MEMORY_GALLERY_CAPABILITY,
    });

    expect(throttled).toBeDefined();
    expect(await refusalShape(throttled as Response)).toEqual(
      await refusalShape(unknown),
    );
  });

  it("writes no operational event for an ordinary credential refusal", async () => {
    // A prober sending well-formed handles could otherwise flood the log at no
    // cost to itself.
    await post(UNKNOWN_HANDLE, { capability: MEMORY_GALLERY_CAPABILITY });

    expect(log.write).not.toHaveBeenCalled();
  });

  it("logs the class but never the credential for a configuration defect", async () => {
    config.store = "enabled";
    await post(MEMORY_GALLERY_HANDLE, { capability: MEMORY_GALLERY_CAPABILITY });

    expect(log.write).toHaveBeenCalledTimes(1);
    const [event] = log.write.mock.calls[0];
    expect(event).toMatchObject({ state: "rejected", errorClass: "unexpected" });
    expect(JSON.stringify(event)).not.toContain(MEMORY_GALLERY_CAPABILITY);
  });
});
