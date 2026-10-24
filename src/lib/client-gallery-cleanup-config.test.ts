import { describe, expect, it } from "vitest";
import { readClientGalleryCleanupConfig } from "./client-gallery-cleanup-config";

const environment = { CLIENT_GALLERY_CLEANUP: "enabled", CLIENT_GALLERY_ADAPTER: "sanity", SITE_CONTENT_SOURCE: "sanity", SANITY_DATASET_VISIBILITY: "public",
  SANITY_PROJECT_ID: "example123", SANITY_DATASET: "production", SANITY_API_VERSION: "v2026-06-24", SITE_DEPLOYMENT_STAGE: "production", VERCEL_ENV: "production",
  SANITY_CLIENT_GALLERY_CLEANUP_TOKEN: "synthetic-cleanup-token", CRON_SECRET: "synthetic-cron-secret" };
const now = new Date("2026-10-24T00:00:00Z");
describe("delivery cleanup deployment", () => {
  it("is off without inspecting irrelevant credentials", () => {
    for (const flag of [undefined, "", "off"]) expect(readClientGalleryCleanupConfig({ CLIENT_GALLERY_CLEANUP: flag }, now)).toEqual({ state: "disabled" });
    expect(readClientGalleryCleanupConfig({ CLIENT_GALLERY_CLEANUP: "true" }, now)).toEqual({ state: "misconfigured" });
  });
  it("requires the deployed Sanity delivery workflow, dedicated token and cron authentication", () => {
    expect(readClientGalleryCleanupConfig(environment, now)).toMatchObject({ state: "enabled", token: "synthetic-cleanup-token", limits: { maxExportBytes: 67108864, maxDocuments: 100000, exportTimeoutMs: 30000 } });
    for (const patch of [ { CLIENT_GALLERY_ADAPTER: "off" }, { SITE_CONTENT_SOURCE: "mock" }, { SITE_DEPLOYMENT_STAGE: "preview" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "development" },
      { SANITY_CLIENT_GALLERY_CLEANUP_TOKEN: "" }, { SANITY_CLIENT_GALLERY_CLEANUP_TOKEN: "bad token" }, { CRON_SECRET: "short" }, { NEXT_PUBLIC_CRON_SECRET: "exposed" },
      { NEXT_PUBLIC_SANITY_CLIENT_GALLERY_CLEANUP_TOKEN: "exposed" }, { SANITY_API_VERSION: "v2025-02-18" }, { SANITY_DATASET_VISIBILITY: "private" } ]) {
      expect(readClientGalleryCleanupConfig({ ...environment, ...patch }, now)).toEqual({ state: "misconfigured" });
    }
  });
  it("validates operator caps without accepting unbounded or malformed overrides", () => {
    expect(readClientGalleryCleanupConfig({ ...environment, CLIENT_GALLERY_CLEANUP_MAX_EXPORT_BYTES: "1048576", CLIENT_GALLERY_CLEANUP_MAX_DOCUMENTS: "200000", CLIENT_GALLERY_CLEANUP_EXPORT_TIMEOUT_MS: "60000" }, now)).toMatchObject({ state: "enabled", limits: { maxExportBytes: 1048576, maxDocuments: 200000, exportTimeoutMs: 60000 } });
    for (const value of ["0", "-1", "Infinity", "1e8", "268435457", "1048576.5"]) {
      expect(readClientGalleryCleanupConfig({ ...environment, CLIENT_GALLERY_CLEANUP_MAX_EXPORT_BYTES: value }, now)).toEqual({ state: "misconfigured" });
    }
  });
});
