import { describe, expect, it, vi } from "vitest";
import { buildLocaleRouteConfig } from "../src/lib/locale-routes";
import { restrictedLocaleFromSearch } from "../src/lib/restricted-page-locale";
import { isClientGalleryHandle } from "../src/lib/client-gallery-model";
import { loadStudioSettings } from "./settings";
import { clientGalleryShareCopy, clientGalleryShareUrl, clientGallerySiteOrigin, copyClientGalleryUrl, publishedClientGalleryHandle } from "./client-gallery-share";

const handle = "a".repeat(32);
const site = { origin: "https://example.test", locales: ["fi", "en-GB"] };
const published = { _id: "client-one", _type: "clientDeliveryGallery", handle, title: "Never copied" };
const state = { id: "client-one", type: "clientDeliveryGallery", ready: true, published };
describe("configured customer link origin", () => {
  it("preserves missing settings and accepts a canonical bare HTTPS origin", () => {
    expect(clientGallerySiteOrigin(undefined)).toBeUndefined(); expect(clientGallerySiteOrigin("")).toBeUndefined();
    expect(clientGallerySiteOrigin("https://example.test/")).toBe(site.origin);
    expect(clientGallerySiteOrigin("https://example.test:8443")).toBe("https://example.test:8443");
  });
  it.each(["http://localhost:3000", "//example.test", "https://user:password@example.test", "https://example.test/path", "https://example.test/?x=1", "https://example.test/#x", "https://example.test?", "https://example.test#", "https://example.test\\", "https://exam\tple.test", "https://example.test\n", " https://example.test", "https://EXAMPLE.test", "https://example.test:443", "https://" + "x".repeat(2048), "javascript:alert(1)"])("refuses unsafe/noncanonical origin without echoing it %#", (value) => {
    expect(() => clientGallerySiteOrigin(value)).toThrow(/^Invalid SANITY_STUDIO_SITE_ORIGIN$/);
  });
  it("derives full canonical route tags only when configured, leaving defaults unchanged", () => {
    const environment = { SANITY_STUDIO_PROJECT_ID: "example1", SANITY_STUDIO_DATASET: "example", SANITY_STUDIO_DATASET_VISIBILITY: "public", SANITY_STUDIO_TITLE: "Studio", SANITY_STUDIO_LOCALE_ROUTES: "fi||tarinat,en-GB|en|stories,en-US|us|stories" };
    const missing = loadStudioSettings(environment);
    expect(missing).not.toHaveProperty("clientGallerySite");
    expect(loadStudioSettings({ ...environment, SANITY_STUDIO_SITE_ORIGIN: "" })).toEqual(missing);
    const configured = loadStudioSettings({ ...environment, SANITY_STUDIO_SITE_ORIGIN: site.origin });
    expect(configured.authoringLanguages).toEqual(["fi", "en"]);
    expect(configured.clientGallerySite).toEqual({ origin: site.origin, locales: ["fi", "en-GB", "en-US"] });
  });
});
describe("published-only URL handoff", () => {
  it("takes only the published handle, regardless of pending draft fields", () => {
    const edited = { ...state, draft: { ...published, handle: "b".repeat(32), available: false } };
    expect(publishedClientGalleryHandle(edited)).toBe(handle);
    expect(publishedClientGalleryHandle({ ...state, transactionSyncLock: { enabled: false } })).toBe(handle); // Sanity's idle lock state.
    const paused = { ...state, published: { ...published, available: false, expiryInstant: "2020-01-01T00:00:00Z" } };
    expect(publishedClientGalleryHandle(paused)).toBe(handle); // URL identity is not availability.
  });
  it.each([{ ready: false }, { type: "legacyDeliveryGallery" }, { published: null }, { published: [] }, { published: { ...published, _id: "other" } }, { published: { ...published, _type: "gallery" } }, { id: "drafts.client-one", published: { ...published, _id: "drafts.client-one" } }, { id: "versions.release.client-one", published: { ...published, _id: "versions.release.client-one" } }, { release: "release" }, { version: {} }, { transactionSyncLock: {} }, { transactionSyncLock: { enabled: true } }])("refuses unavailable or foreign editor state %#", (patch) => {
    expect(publishedClientGalleryHandle({ ...state, ...patch })).toBeUndefined();
  });
  it.each([handle, "0".repeat(32), "f".repeat(32), "A".repeat(32), "a".repeat(31), "a".repeat(33), handle + "\n", "ä".repeat(32), "a/../b", ""])("matches the real reader's exact handle contract %#", (candidate) => {
    const result = publishedClientGalleryHandle({ ...state, published: { ...published, handle: candidate } });
    expect(result).toBe(isClientGalleryHandle(candidate) ? candidate : undefined);
  });
  it("uses the actual customer locale-query contract rather than language or path inference", () => {
    const routes = buildLocaleRouteConfig({ locales: [{ locale: "fi", prefix: null, storyNamespace: "tarinat" }, { locale: "en-GB", prefix: "en", storyNamespace: "stories" }], reservedRootSegments: [], reservedLocaleRouteSegments: [] });
    expect(clientGalleryShareUrl(site, handle)).toBe(`${site.origin}/client-gallery/${handle}`);
    for (const locale of site.locales) {
      const url = new URL(clientGalleryShareUrl(site, handle, locale)!);
      expect(url.pathname).toBe(`/client-gallery/${handle}`); expect(restrictedLocaleFromSearch(url.searchParams, routes)).toBe(locale);
      expect([...url.searchParams.keys()]).toEqual(["locale"]); expect(url.hash).toBe("");
    }
    expect(clientGalleryShareUrl(site, handle, "en")).toBeUndefined();
    expect(clientGalleryShareUrl(site, handle, "fi&token=private")).toBeUndefined();
    const longLocale = "en-x-" + "abcdefgh-".repeat(15) + "abcdefgh";
    expect(clientGalleryShareUrl({ ...site, locales: [longLocale] }, handle, longLocale)).toBeUndefined();
    expect(clientGalleryShareUrl(undefined, handle)).toBeUndefined(); expect(clientGalleryShareUrl(site, undefined)).toBeUndefined();
  });
  it("copies only the URL and turns unavailable/refused clipboard access into manual fallback", async () => {
    const url = clientGalleryShareUrl(site, handle)!, write = vi.fn(async () => {});
    expect(await copyClientGalleryUrl(url, write)).toBe("copied"); expect(write).toHaveBeenCalledExactlyOnceWith(url);
    expect(await copyClientGalleryUrl(url)).toBe("manual");
    const denied = vi.fn(async () => { throw new Error("private OS error"); });
    expect(await copyClientGalleryUrl(url, denied)).toBe("manual");
  });
  it("keeps both interface notices explicit about public delivery, published state and surviving files", () => {
    const fi = clientGalleryShareCopy("fi-FI"), en = clientGalleryShareCopy("en-GB");
    expect(fi.publicAccess).toContain("julkinen ilman kirjautumista"); expect(en.publicAccess).toContain("public without signing in");
    expect(fi.publication).toContain("julkaistun version"); expect(en.publication).toContain("published version");
    expect(fi.retention).toContain("ei estä suorien kuvalinkkien"); expect(en.retention).toContain("does not revoke direct image URLs");
    expect(fi.manual).toContain("käsin"); expect(en.manual).toContain("manually");
  });
});
