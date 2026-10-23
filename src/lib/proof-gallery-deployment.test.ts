import { describe, expect, it } from "vitest";
import { readProofGalleryDeployment } from "@/lib/proof-gallery-deployment";

describe("proof gallery reader deployment (ADR-0038)", () => {
  it("defaults off without reading credentials or other deployment settings", () => { expect(readProofGalleryDeployment({})).toBe("off"); });
  it.each(["preview", "production"])("refuses fixture data in %s", (stage) => {
    expect(() => readProofGalleryDeployment({ PROOF_GALLERY_ADAPTER: "fixture", SITE_DEPLOYMENT_STAGE: stage })).toThrow();
  });
  it("permits a production-built fixture only as explicit local development", () => {
    expect(readProofGalleryDeployment({ PROOF_GALLERY_ADAPTER: "fixture", SITE_DEPLOYMENT_STAGE: "development", NODE_ENV: "production", VERCEL_ENV: "" })).toBe("fixture");
    expect(() => readProofGalleryDeployment({ PROOF_GALLERY_ADAPTER: "fixture", SITE_DEPLOYMENT_STAGE: "development", VERCEL_ENV: "production" })).toThrow();
  });
  it("requires actual Sanity source and refuses real customer content in either Preview declaration", () => {
    const base = { PROOF_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", SANITY_DATASET_VISIBILITY: "public", SITE_DEPLOYMENT_STAGE: "production", VERCEL_ENV: "production" };
    expect(readProofGalleryDeployment(base)).toBe("sanity");
    for (const patch of [{ SANITY_DATASET_VISIBILITY: "private" }, { SANITY_DATASET_VISIBILITY: "" }, { SITE_CONTENT_SOURCE: "mock" }, { SITE_DEPLOYMENT_STAGE: "preview" }, { VERCEL_ENV: "preview" }, { PROOF_GALLERY_ADAPTER: "invalid" }]) expect(() => readProofGalleryDeployment({ ...base, ...patch })).toThrow();
  });
});
