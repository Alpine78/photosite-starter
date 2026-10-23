import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getProofGallery, PROOF_GALLERY_FIXTURE_HANDLE, PROOF_GALLERY_REPLACED_FIXTURE_HANDLE, PROOF_GALLERY_UNREPLACED_FIXTURE_HANDLE,
} from "@/lib/proof-gallery-access";
import { ClientGalleryDataError } from "@/lib/client-gallery-model";

const mocks = vi.hoisted(() => ({ read: vi.fn(), delivery: vi.fn() }));
vi.mock("@/lib/proof-gallery-sanity", async (original) => ({ ...await original<typeof import("@/lib/proof-gallery-sanity")>(), getProofGallerySanityReader: () => ({ read: mocks.read }) }));
vi.mock("@/lib/client-gallery-access", async (original) => ({ ...await original<typeof import("@/lib/client-gallery-access")>(), isReplacementDeliveryAvailable: mocks.delivery }));
vi.mock("@/lib/deployment-config", () => ({ getDeploymentConfig: () => ({ locale: "en-GB" }) }));
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.restoreAllMocks(); mocks.read.mockReset(); mocks.delivery.mockReset(); });

function environment(adapter: string) {
  vi.stubEnv("PROOF_GALLERY_ADAPTER", adapter); vi.stubEnv("SITE_DEPLOYMENT_STAGE", "development"); vi.stubEnv("VERCEL_ENV", "");
  vi.stubEnv("SITE_CONTENT_SOURCE", "sanity"); vi.stubEnv("SANITY_DATASET_VISIBILITY", "public");
}
const view = { title: "Proofs", images: [] };
const replacement = { id: "delivery1", handle: "d".repeat(32) };

describe("proof page facade", () => {
  it("is off without provider reads", async () => {
    environment("off"); expect(await getProofGallery(PROOF_GALLERY_FIXTURE_HANDLE, "fi")).toBeUndefined();
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("redirects to an available replacing delivery gallery, even from paused proofs", async () => {
    environment("sanity"); mocks.delivery.mockResolvedValue(true);
    mocks.read.mockResolvedValue({ view, availability: { available: false }, replacement });
    expect(await getProofGallery("a".repeat(32), "fi")).toEqual({ kind: "replaced", deliveryHandle: replacement.handle });
    expect(mocks.delivery).toHaveBeenCalledWith(replacement.handle, replacement.id, "fi");
  });

  it("shows open proofs when the replacement is unavailable, and nothing for closed ones", async () => {
    environment("sanity"); mocks.delivery.mockResolvedValue(false);
    mocks.read.mockResolvedValue({ view, availability: { available: true }, replacement });
    expect(await getProofGallery("a".repeat(32), "fi")).toEqual({ kind: "proofs", view });
    mocks.read.mockResolvedValue({ view, availability: { available: false }, replacement });
    expect(await getProofGallery("a".repeat(32), "fi")).toBeUndefined();
  });

  it("judges the proofs' deadline after the delivery check", async () => {
    environment("sanity"); vi.useFakeTimers(); vi.setSystemTime(1_000);
    mocks.read.mockResolvedValue({ view, availability: { available: true, deadline: 2_000 }, replacement });
    mocks.delivery.mockImplementation(async () => { vi.setSystemTime(2_000); return false; });
    expect(await getProofGallery("a".repeat(32), "fi")).toBeUndefined();
  });

  it("keeps delivery provider failures as errors and redacts malformed proofs", async () => {
    environment("sanity"); const failure = new Error("provider");
    mocks.read.mockResolvedValue({ view, availability: { available: true }, replacement }); mocks.delivery.mockRejectedValue(failure);
    await expect(getProofGallery("a".repeat(32), "fi")).rejects.toBe(failure);
    const log = vi.spyOn(console, "error").mockImplementation(() => {}); mocks.read.mockRejectedValue(new ClientGalleryDataError());
    expect(await getProofGallery("a".repeat(32), "fi")).toBeUndefined(); expect(log).toHaveBeenCalledWith("[proof-gallery] malformed-content");
  });

  it("exposes the replacement fixtures through the same decision", async () => {
    environment("fixture");
    mocks.delivery.mockImplementation(async (_handle: string, id: string) => id === "client-fixture");
    expect(await getProofGallery(PROOF_GALLERY_REPLACED_FIXTURE_HANDLE, "fi")).toEqual({ kind: "replaced", deliveryHandle: "6".repeat(32) });
    expect(await getProofGallery(PROOF_GALLERY_UNREPLACED_FIXTURE_HANDLE, "fi")).toMatchObject({ kind: "proofs" });
    expect(mocks.read).not.toHaveBeenCalled();
  });
});
