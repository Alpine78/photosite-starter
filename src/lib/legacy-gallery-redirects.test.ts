import { describe, expect, it, vi } from "vitest";
import { createLegacyGalleryRedirectResolver, parseLegacyGalleryRedirects } from "./legacy-gallery-redirects";
const handle = "a".repeat(32), second = "b".repeat(32);
const env = { LEGACY_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", SITE_DEPLOYMENT_STAGE: "production", VERCEL_ENV: "production", LEGACY_GALLERY_IMPORT_BATCH: "c".repeat(64), LEGACY_GALLERY_HANDLES: handle, LEGACY_GALLERY_REDIRECTS: JSON.stringify([["/retained-source", handle], ["/säilytetty", handle]]) };
const error = "Invalid retained-gallery redirect configuration";
describe("retained-gallery source mapping", () => {
  it("resolves exact and one trailing-slash source without CMS IO; unicode URL encodings agree", () => {
    const resolve = createLegacyGalleryRedirectResolver();
    expect(resolve("/retained-source", env)).toBe(`/client-gallery/${handle}`);
    expect(resolve("/retained-source/", env)).toBe(`/client-gallery/${handle}`);
    expect(resolve("/s%C3%A4ilytetty", env)).toBe(`/client-gallery/${handle}`);
    expect(resolve("/s%c3%a4ilytetty", env)).toBe(`/client-gallery/${handle}`);
    for (const source of ["/retained-source//", "/RETAINED-source", "/retained-source%2f", "/retained%2dsource%2f", "/%zz", "/unmapped", "/retained-source%00"]) expect(resolve(source, env)).toBeUndefined();
  });
  it("parses only when deployment configuration changes and rechecks the allowlist", () => {
    const resolve = createLegacyGalleryRedirectResolver(), parse = vi.spyOn(JSON, "parse");
    try {
      resolve("/retained-source", env); resolve("/unmapped", env); expect(parse).toHaveBeenCalledTimes(1);
      expect(() => resolve("/retained-source", { ...env, LEGACY_GALLERY_HANDLES: second })).toThrow(error);
      expect(resolve("/retained-source", env)).toBe(`/client-gallery/${handle}`);
      expect(resolve("/retained-source", { ...env, LEGACY_GALLERY_ADAPTER: "off" })).toBeUndefined();
    } finally { parse.mockRestore(); }
  });
  it.each([{}, { ...env, LEGACY_GALLERY_REDIRECTS: "" }, { ...env, LEGACY_GALLERY_ADAPTER: "off" }])("leaves no mapping while absent or off", (value) => expect(createLegacyGalleryRedirectResolver()("/retained-source", value)).toBeUndefined());
  it.each([{ ...env, SITE_DEPLOYMENT_STAGE: "preview" }, { ...env, VERCEL_ENV: "preview" }, { ...env, LEGACY_GALLERY_ADAPTER: "fixture" }, { ...env, LEGACY_GALLERY_IMPORT_BATCH: "invalid" }])("refuses real/fixture scope drift with a fixed diagnostic", (value) => expect(() => createLegacyGalleryRedirectResolver()("/retained-source", value)).toThrow(error));
  it("allows only explicit local fixture mapping", () => {
    expect(createLegacyGalleryRedirectResolver()("/retained-source", { ...env, LEGACY_GALLERY_ADAPTER: "fixture", SITE_DEPLOYMENT_STAGE: "development", VERCEL_ENV: "development" })).toBe(`/client-gallery/${handle}`);
  });
  it.each(["/", "//untrusted.invalid/path", "/api/contact", "/admin", "/private/anything", "/client-gallery/anything", "/private-gallery/anything", "/_next/chunk", "/source/", "/source//x", "/source/../x", "/source?secret=value", "/source#secret", "/source%2fother", "/source\\other", "/source\nother", "https://untrusted.invalid/path"]) ("rejects unsafe or reserved configured source %s", (source) => expect(() => parseLegacyGalleryRedirects(JSON.stringify([[source, handle]]), new Set([handle]))).toThrow(error));
  it.each(["not JSON containing private-value", "{}", "null", "[null]", JSON.stringify([["/first", handle, "extra"]]), JSON.stringify([["/first", second]]), JSON.stringify([["/first", handle], ["/first", handle]]), JSON.stringify([["/first", "https://untrusted.invalid"]]), JSON.stringify(Array(257).fill(["/source", handle])), JSON.stringify([["/"+"x".repeat(1024), handle]]), " ".repeat(65537)])("rejects malformed or excessive map with no raw diagnostic", (raw) => expect(() => parseLegacyGalleryRedirects(raw, new Set([handle]))).toThrow(error));
});
