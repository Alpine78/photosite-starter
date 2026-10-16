import { afterEach, describe, expect, it, vi } from "vitest";
import { parsePrivateGalleryClientAssetUrl, requestPrivateGalleryClientAssetUrl } from "./private-gallery-asset-client";

const ORIGIN = "https://site.example.test";
const NOW = Date.parse("2026-10-16T12:00:00Z");
const VALID = { ok: true, url: "https://private.example.test/object?signature=test", expiresAt: new Date(NOW + 300_000).toISOString() };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("private asset browser response boundary", () => {
  it("accepts a single HTTPS object URL and finite future expiry without provider fields", () => {
    expect(parsePrivateGalleryClientAssetUrl({ ...VALID, ignored: "not-projected" }, ORIGIN, NOW))
      .toEqual({ url: VALID.url, expiresAt: NOW + 300_000 });
  });

  it("permits HTTP only at this development origin", () => {
    const origin = "http://127.0.0.1:3100";
    expect(parsePrivateGalleryClientAssetUrl({ ...VALID, url: origin + "/mock-image.svg" }, origin, NOW).url)
      .toBe(origin + "/mock-image.svg");
    expect(() => parsePrivateGalleryClientAssetUrl({ ...VALID, url: "http://elsewhere.example.test/photo" }, origin, NOW))
      .toThrow("private-asset-unavailable");
  });

  it.each([
    null, [], {}, { ...VALID, ok: false }, { ...VALID, url: 42 }, { ...VALID, url: "/relative" },
    { ...VALID, expiresAt: "not-a-date" }, { ...VALID, expiresAt: undefined }, { ...VALID, expiresAt: NOW + 300_000 },
    { ...VALID, expiresAt: new Date(NOW).toISOString() }, { ...VALID, expiresAt: new Date(NOW - 1).toISOString() },
    { ...VALID, url: "javascript:alert(1)" }, { ...VALID, url: "data:image/svg+xml,test" },
    { ...VALID, url: "blob:https://site.example.test/object" }, { ...VALID, url: "ftp://private.example.test/object" },
    { ...VALID, url: "https://username:secret@private.example.test/object" },
    { ...VALID, url: "https://private.example.test/object#secret" },
    { ...VALID, url: "https://private.example.test/" + "a".repeat(16_384) },
  ])("rejects malformed, expired or unsafe replies without echoing their contents", value => {
    expect(() => parsePrivateGalleryClientAssetUrl(value, ORIGIN, NOW)).toThrow(/^private-asset-unavailable$/);
  });

  it("fails closed when its supplied comparison clock is not finite", () => {
    expect(() => parsePrivateGalleryClientAssetUrl(VALID, ORIGIN, NaN)).toThrow("private-asset-unavailable");
  });
});

describe("private asset Stage 1 browser request", () => {
  it.each([{ kind: "preview" as const, placementId: "placement-1" }, { kind: "zip" as const }])(
    "posts only the identifier request through the same-origin uncached endpoint", async request => {
      const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID), { headers: { date: new Date(NOW).toUTCString() } }));
      vi.stubGlobal("fetch", fetcher);
      const signal = new AbortController().signal;
      expect(await requestPrivateGalleryClientAssetUrl("/private/handle/asset", request, signal, ORIGIN)).toEqual({ url: VALID.url, expiresAt: NOW + 300_000 });
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(ORIGIN + "/private/handle/asset", {
        method: "POST", headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(request), credentials: "same-origin", cache: "no-store", redirect: "error", signal,
      });
    });

  it("uses the server Date header when the visitor clock is an hour fast", async () => {
    vi.useFakeTimers();vi.setSystemTime(NOW + 3_600_000);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID), { headers: { date: new Date(NOW).toUTCString() } })));
    expect((await requestPrivateGalleryClientAssetUrl("/asset", { kind: "zip" }, new AbortController().signal, ORIGIN)).url).toBe(VALID.url);
  });

  it("uses a finite local clock when no Date header is available", async () => {
    vi.useFakeTimers();vi.setSystemTime(NOW);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(VALID))));
    expect((await requestPrivateGalleryClientAssetUrl("/asset", { kind: "zip" }, new AbortController().signal, ORIGIN)).expiresAt).toBe(NOW + 300_000);
  });

  it.each([401,403,404,409,429,503])("keeps refusal %s generic and does not read its body", async status => {
    const response = new Response("provider-or-session-detail", { status });
    const json = vi.spyOn(response, "json");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    await expect(requestPrivateGalleryClientAssetUrl("/asset", { kind: "zip" }, new AbortController().signal, ORIGIN))
      .rejects.toThrow(/^private-asset-unavailable$/);
    expect(json).not.toHaveBeenCalled();
  });

  it("does not send a request or credentials to a foreign mint endpoint", async () => {
    const fetcher = vi.fn();vi.stubGlobal("fetch", fetcher);
    await expect(requestPrivateGalleryClientAssetUrl("https://foreign.example.test/asset", { kind: "zip" }, new AbortController().signal, ORIGIN))
      .rejects.toThrow("private-asset-unavailable");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not expose invalid JSON response contents through a parser error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("private-provider-payload")));
    await expect(requestPrivateGalleryClientAssetUrl("/asset", { kind: "zip" }, new AbortController().signal, ORIGIN))
      .rejects.toThrow(/^private-asset-unavailable$/);
  });

  it("forwards cancellation without starting any object transfer", async () => {
    const controller = new AbortController();controller.abort();
    const fetcher = vi.fn().mockRejectedValue(new DOMException("Aborted", "AbortError"));
    vi.stubGlobal("fetch", fetcher);
    await expect(requestPrivateGalleryClientAssetUrl("/asset", { kind: "zip" }, controller.signal, ORIGIN))
      .rejects.toMatchObject({ name: "AbortError" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
