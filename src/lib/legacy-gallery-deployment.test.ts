import { describe, expect, it } from "vitest";
import { readLegacyGalleryDeployment } from "@/lib/legacy-gallery-deployment";
import { isLegacyGalleryNamespace, legacyGalleryHandleFromPath } from "@/lib/legacy-gallery-path";
import { LEGACY_REDIRECT_ENTRIES } from "@/lib/legacy-redirects-data";

const handle = "a".repeat(32);
describe("legacy gallery publication settings and path grammar", () => {
  it("defaults to off without requiring any provider settings", () => expect(readLegacyGalleryDeployment({})).toEqual({ adapter: "off" }));
  it("permits local fixtures for a production-built development harness", () => expect(readLegacyGalleryDeployment({ LEGACY_GALLERY_ADAPTER: "fixture", SITE_DEPLOYMENT_STAGE: "development", NODE_ENV: "production" })).toEqual({ adapter: "fixture" }));
  it.each([{}, { SITE_DEPLOYMENT_STAGE: "preview" }, { SITE_DEPLOYMENT_STAGE: "production" }, { SITE_DEPLOYMENT_STAGE: "development", VERCEL_ENV: "production" }, { SITE_DEPLOYMENT_STAGE: "development", VERCEL_ENV: "preview" }])("refuses fixtures outside local development %j", (env) => expect(() => readLegacyGalleryDeployment({ ...env, LEGACY_GALLERY_ADAPTER: "fixture" })).toThrow());
  it("requires an explicit approved batch and deployed handles for Sanity", () => {
    const config = readLegacyGalleryDeployment({ LEGACY_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", LEGACY_GALLERY_IMPORT_BATCH: "b".repeat(64), LEGACY_GALLERY_HANDLES: handle });
    expect(config.adapter).toBe("sanity"); if (config.adapter === "sanity") expect(config.handles.has(handle)).toBe(true);
  });
  it.each([{ SITE_DEPLOYMENT_STAGE: "preview" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "Preview" }])("refuses real legacy content in Preview %j", (env) => {
    expect(() => readLegacyGalleryDeployment({ ...env, LEGACY_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", LEGACY_GALLERY_IMPORT_BATCH: "b".repeat(64), LEGACY_GALLERY_HANDLES: handle })).toThrow("unavailable in Preview");
  });
  it.each(["", "bad", `${handle},${handle}`, `${handle},`, Array(257).fill(handle).join(",")])("refuses invalid publication allowlist", (list) => expect(() => readLegacyGalleryDeployment({ LEGACY_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", LEGACY_GALLERY_IMPORT_BATCH: "b".repeat(64), LEGACY_GALLERY_HANDLES: list })).toThrow());
  it.each(["/client-gallery", "/CLIENT-GALLERY/x", "/%63lient-gallery/x", "/client-gallery%2Fx", "/en/client-gallery/x", "/fi/client-gallery/x"])("recognizes namespace aliases for hygienic refusal %s", (path) => expect(isLegacyGalleryNamespace(path, ["en", "fi"])).toBe(true));
  it.each(["/client-gallery-other/x", "/stories/client-gallery", "/en/client-gallery-other"])("does not claim unrelated namespaces %s", (path) => expect(isLegacyGalleryNamespace(path, ["en"])).toBe(false));
  it("serves only the literal bounded handle grammar", () => {
    expect(legacyGalleryHandleFromPath(`/client-gallery/${handle}`)).toBe(handle);
    expect(legacyGalleryHandleFromPath(`/client-gallery/${handle}/`)).toBe(handle);
    for (const path of [`/en/client-gallery/${handle}`, `/client-gallery/${handle}/image.jpg`, `/client-gallery/${handle.toUpperCase()}`, `/CLIENT-GALLERY/${handle}`]) expect(legacyGalleryHandleFromPath(path)).toBeUndefined();
  });
  it("keeps customer targets out of the ordinary committed redirect registry", () => {
    for (const entry of LEGACY_REDIRECT_ENTRIES) {
      if (entry.outcome.kind === "redirect") expect(entry.outcome.target).not.toMatch(/^\/client-gallery(?:\/|$)/);
    }
  });
});
