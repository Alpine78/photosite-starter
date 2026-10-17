import { afterEach, describe, expect, it, vi } from "vitest";
import { getClientGallery, CLIENT_GALLERY_FIXTURE_HANDLE, CLIENT_GALLERY_DEADLINE_FIXTURE_HANDLE, CLIENT_GALLERY_DEADLINE_FIXTURE_INSTANT, CLIENT_GALLERY_CAPACITY_FIXTURE_HANDLE } from "@/lib/client-gallery-access";
import { CLIENT_GALLERY_MAX_ITEMS, ClientGalleryDataError, ClientGalleryChangedError } from "@/lib/client-gallery-model";

const mocks = vi.hoisted(() => ({ legacy: vi.fn(), read: vi.fn(), factory: vi.fn() }));
vi.mock("@/lib/legacy-gallery-access", () => ({ getLegacyGallery: mocks.legacy }));
vi.mock("@/lib/client-gallery-sanity", async (original) => ({ ...await original<typeof import("@/lib/client-gallery-sanity")>(), getClientGallerySanityReader: mocks.factory }));
vi.mock("@/lib/deployment-config", () => ({ getDeploymentConfig: () => ({ locale: "en-GB" }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); mocks.read.mockReset(); mocks.legacy.mockReset(); mocks.factory.mockReset(); });
function environment(adapter: string) {
  vi.stubEnv("CLIENT_GALLERY_ADAPTER", adapter); vi.stubEnv("LEGACY_GALLERY_ADAPTER", "off");
  vi.stubEnv("SITE_DEPLOYMENT_STAGE", "development"); vi.stubEnv("VERCEL_ENV", ""); vi.stubEnv("SITE_CONTENT_SOURCE", "sanity");
  vi.stubEnv("SANITY_DATASET_VISIBILITY", "public");
}
describe("combined unlisted customer facade", () => {
  it("bounds the large fixture and preserves distinct occurrences of two complete source images", async () => {
    environment("off"); expect(await getClientGallery(CLIENT_GALLERY_CAPACITY_FIXTURE_HANDLE, "fi")).toBeUndefined();
    environment("fixture");
    const gallery = await getClientGallery(CLIENT_GALLERY_CAPACITY_FIXTURE_HANDLE, "fi");
    expect(gallery?.images).toHaveLength(CLIENT_GALLERY_MAX_ITEMS);
    expect(new Set(gallery?.images.map((image) => image.itemId)).size).toBe(CLIENT_GALLERY_MAX_ITEMS);
    expect(new Set(gallery?.images.map((image) => image.mediaId)).size).toBe(2);
    expect(gallery?.images.every((image) => image.enquiryAllowed === false && Math.max(image.width, image.height) <= 2048)).toBe(true);
    expect(gallery).not.toHaveProperty("zipUrl"); expect(gallery).not.toHaveProperty("availableUntil");
    expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("makes no provider/configuration read while new delivery is off", async () => {
    environment("off"); expect(await getClientGallery(CLIENT_GALLERY_FIXTURE_HANDLE, "fi")).toBeUndefined(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("retains legacy ownership even when expired or the new adapter is invalid", async () => {
    environment("invalid"); vi.stubEnv("LEGACY_GALLERY_ADAPTER", "sanity"); vi.stubEnv("LEGACY_GALLERY_IMPORT_BATCH", "b".repeat(64)); vi.stubEnv("LEGACY_GALLERY_HANDLES", CLIENT_GALLERY_FIXTURE_HANDLE);
    mocks.legacy.mockResolvedValue(undefined);
    expect(await getClientGallery(CLIENT_GALLERY_FIXTURE_HANDLE, "fi")).toBeUndefined(); expect(mocks.legacy).toHaveBeenCalledWith(CLIENT_GALLERY_FIXTURE_HANDLE); expect(mocks.factory).not.toHaveBeenCalled();
    mocks.legacy.mockResolvedValue({ title: "Retained", images: [], zipUrl: "https://example.test/delivery.zip" });
    expect(await getClientGallery(CLIENT_GALLERY_FIXTURE_HANDLE, "fi")).toMatchObject({ kind: "legacy", zipUrl: "https://example.test/delivery.zip" });
  });
  it("propagates bad legacy ownership configuration rather than falling through", async () => {
    environment("fixture"); vi.stubEnv("LEGACY_GALLERY_ADAPTER", "sanity"); vi.stubEnv("LEGACY_GALLERY_IMPORT_BATCH", "bad");
    await expect(getClientGallery(CLIENT_GALLERY_FIXTURE_HANDLE, "fi")).rejects.toThrow(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("uses synthetic local images with real FI/EN text and no ZIP", async () => {
    environment("fixture"); const fi = await getClientGallery(CLIENT_GALLERY_FIXTURE_HANDLE, "fi-FI");
    expect(fi?.title).toBe("Piilotettu toimitus"); expect(fi?.images).toHaveLength(2); expect(fi).not.toHaveProperty("zipUrl");
    expect(fi?.kind).toBe("web");
    expect(fi).not.toHaveProperty("availableUntil");
    expect(await getClientGallery(CLIENT_GALLERY_DEADLINE_FIXTURE_HANDLE, "fi")).toMatchObject({ kind: "web", availableUntil: CLIENT_GALLERY_DEADLINE_FIXTURE_INSTANT });
    expect((await getClientGallery(CLIENT_GALLERY_FIXTURE_HANDLE, "en"))?.title).toBe("Unlisted delivery");
    expect(await getClientGallery("7".repeat(32), "en")).toBeUndefined(); expect(mocks.factory).not.toHaveBeenCalled();
  });
  it("redacts malformed content but propagates transient changes", async () => {
    environment("sanity"); mocks.factory.mockReturnValue({ read: mocks.read });
    const log = vi.spyOn(console, "error").mockImplementation(() => {}); mocks.read.mockRejectedValue(new ClientGalleryDataError());
    expect(await getClientGallery(CLIENT_GALLERY_FIXTURE_HANDLE, "fi")).toBeUndefined(); expect(log).toHaveBeenCalledWith("[client-gallery] malformed-content");
    const changed = new ClientGalleryChangedError(); mocks.read.mockRejectedValue(changed);
    await expect(getClientGallery(CLIENT_GALLERY_FIXTURE_HANDLE, "fi")).rejects.toBe(changed);
  });
});
