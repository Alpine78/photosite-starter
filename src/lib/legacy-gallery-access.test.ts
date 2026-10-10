import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyGalleryDataError } from "@/lib/legacy-gallery-sanity";
import { getLegacyGallery, LEGACY_FIXTURE_HANDLE } from "@/lib/legacy-gallery-access";
import { SanityQueryError } from "@/lib/sanity-client";

const mocked = vi.hoisted(() => ({ read: vi.fn(), factory: vi.fn() }));
vi.mock("@/lib/legacy-gallery-sanity", async (original) => ({ ...await original<typeof import("@/lib/legacy-gallery-sanity")>(), getLegacyGallerySanityReader: mocked.factory }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); mocked.read.mockReset(); mocked.factory.mockReset(); });
describe("legacy gallery facade", () => {
  it("performs no provider read while off", async () => { vi.stubEnv("LEGACY_GALLERY_ADAPTER", "off"); expect(await getLegacyGallery(LEGACY_FIXTURE_HANDLE)).toBeUndefined(); expect(mocked.factory).not.toHaveBeenCalled(); });
  it("refuses undeployed handles before any provider read", async () => {
    vi.stubEnv("LEGACY_GALLERY_ADAPTER", "sanity"); vi.stubEnv("SITE_CONTENT_SOURCE", "sanity"); vi.stubEnv("LEGACY_GALLERY_IMPORT_BATCH", "b".repeat(64)); vi.stubEnv("LEGACY_GALLERY_HANDLES", "a".repeat(32));
    expect(await getLegacyGallery(LEGACY_FIXTURE_HANDLE)).toBeUndefined(); expect(mocked.factory).not.toHaveBeenCalled();
  });
  it("classifies malformed data without logging customer content", async () => {
    vi.stubEnv("LEGACY_GALLERY_ADAPTER", "sanity"); vi.stubEnv("SITE_CONTENT_SOURCE", "sanity"); vi.stubEnv("LEGACY_GALLERY_IMPORT_BATCH", "b".repeat(64)); vi.stubEnv("LEGACY_GALLERY_HANDLES", LEGACY_FIXTURE_HANDLE);
    mocked.factory.mockReturnValue({ read: mocked.read }); mocked.read.mockRejectedValue(new LegacyGalleryDataError()); const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getLegacyGallery(LEGACY_FIXTURE_HANDLE)).toBeUndefined(); expect(log).toHaveBeenCalledWith("[legacy-gallery] malformed-content");
  });
  it("uses only synthetic local fixtures", async () => {
    vi.stubEnv("LEGACY_GALLERY_ADAPTER", "fixture"); vi.stubEnv("SITE_DEPLOYMENT_STAGE", "development"); vi.stubEnv("VERCEL_ENV", "");
    expect((await getLegacyGallery(LEGACY_FIXTURE_HANDLE))?.images).toHaveLength(2); expect(mocked.factory).not.toHaveBeenCalled();
  });
  it.each(["malformed-response", "timeout"] as const)("refuses malformed envelopes but propagates %s transport classification", async (errorClass) => {
    vi.stubEnv("LEGACY_GALLERY_ADAPTER", "sanity"); vi.stubEnv("SITE_CONTENT_SOURCE", "sanity"); vi.stubEnv("LEGACY_GALLERY_IMPORT_BATCH", "b".repeat(64)); vi.stubEnv("LEGACY_GALLERY_HANDLES", LEGACY_FIXTURE_HANDLE);
    const error = new SanityQueryError({ errorClass, retryable: errorClass === "timeout", correlationId: "fixture" });
    mocked.factory.mockReturnValue({ read: mocked.read }); mocked.read.mockRejectedValue(error); vi.spyOn(console, "error").mockImplementation(() => {});
    if (errorClass === "malformed-response") expect(await getLegacyGallery(LEGACY_FIXTURE_HANDLE)).toBeUndefined();
    else await expect(getLegacyGallery(LEGACY_FIXTURE_HANDLE)).rejects.toBe(error);
  });
});
