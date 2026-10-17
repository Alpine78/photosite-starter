import { describe, expect, it } from "vitest";
import { readClientGalleryDeployment } from "@/lib/client-gallery-deployment";

describe("unlisted client adapter deployment", () => {
  it("defaults off without reading credentials or other deployment settings", () => { expect(readClientGalleryDeployment({})).toBe("off"); });
  it.each(["preview", "production"])("refuses fixture data in %s", (stage) => {
    expect(() => readClientGalleryDeployment({ CLIENT_GALLERY_ADAPTER: "fixture", SITE_DEPLOYMENT_STAGE: stage })).toThrow();
  });
  it("permits a production-built fixture only as explicit local development", () => {
    expect(readClientGalleryDeployment({ CLIENT_GALLERY_ADAPTER: "fixture", SITE_DEPLOYMENT_STAGE: "development", NODE_ENV: "production", VERCEL_ENV: "" })).toBe("fixture");
    expect(() => readClientGalleryDeployment({ CLIENT_GALLERY_ADAPTER: "fixture", SITE_DEPLOYMENT_STAGE: "development", VERCEL_ENV: "production" })).toThrow();
  });
  it("requires actual Sanity source and refuses real customer content in either Preview declaration", () => {
    const base = { CLIENT_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", SANITY_DATASET_VISIBILITY: "public", SITE_DEPLOYMENT_STAGE: "production", VERCEL_ENV: "production" };
    expect(readClientGalleryDeployment(base)).toBe("sanity");
    for (const patch of [{ SANITY_DATASET_VISIBILITY: "private" }, { SANITY_DATASET_VISIBILITY: "" }, { SITE_CONTENT_SOURCE: "mock" }, { SITE_DEPLOYMENT_STAGE: "preview" }, { VERCEL_ENV: "preview" }, { CLIENT_GALLERY_ADAPTER: "invalid" }]) expect(() => readClientGalleryDeployment({ ...base, ...patch })).toThrow();
  });
});
