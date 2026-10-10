import { readDeploymentStage } from "@/lib/deployment-stage";
import { isLegacyGalleryHandle, MAX_LEGACY_GALLERY_IMAGES } from "@/lib/legacy-gallery-path";

export type LegacyGalleryDeployment =
  | { readonly adapter: "off" }
  | { readonly adapter: "fixture" }
  | { readonly adapter: "sanity"; readonly batch: string; readonly handles: ReadonlySet<string> };

export function readLegacyGalleryDeployment(environment: Record<string, string | undefined>): LegacyGalleryDeployment {
  const adapter = environment.LEGACY_GALLERY_ADAPTER?.trim() || "off";
  if (adapter === "off") return { adapter };
  if (adapter === "fixture") {
    const platform = environment.VERCEL_ENV?.trim();
    if (readDeploymentStage(environment) !== "development" || (platform && platform !== "development")) {
      throw new Error("Legacy gallery fixtures require an explicit local development deployment");
    }
    return { adapter };
  }
  if (adapter !== "sanity" || environment.SITE_CONTENT_SOURCE?.trim() !== "sanity") {
    throw new Error("Invalid legacy gallery adapter/content-source combination");
  }
  const platform = environment.VERCEL_ENV?.trim().toLowerCase();
  if (readDeploymentStage(environment) === "preview" ||
      (platform && platform !== "production" && platform !== "development")) {
    throw new Error("Real legacy gallery content is unavailable in Preview");
  }
  const batch = environment.LEGACY_GALLERY_IMPORT_BATCH?.trim() ?? "";
  const handles = (environment.LEGACY_GALLERY_HANDLES?.trim() ?? "").split(",").map((s) => s.trim());
  if (!/^[a-f0-9]{64}$/.test(batch) || handles.length > MAX_LEGACY_GALLERY_IMAGES ||
      handles.some((h) => !isLegacyGalleryHandle(h)) || new Set(handles).size !== handles.length) {
    throw new Error("Legacy gallery publication requires a valid approved batch and distinct opaque handles");
  }
  return { adapter, batch, handles: new Set(handles) };
}
