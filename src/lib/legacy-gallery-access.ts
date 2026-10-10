import "server-only";
import { readLegacyGalleryDeployment } from "@/lib/legacy-gallery-deployment";
import { getLegacyGallerySanityReader, LegacyGalleryDataError, type LegacyGalleryView } from "@/lib/legacy-gallery-sanity";
import { isLegacyGalleryHandle } from "@/lib/legacy-gallery-path";
import { SanityQueryError } from "@/lib/sanity-client";

export type { LegacyGalleryView } from "@/lib/legacy-gallery-sanity";

/** Fixtures contain only already-shipped generic demo media. No customer data. */
export const LEGACY_FIXTURE_HANDLE = "11111111111111111111111111111111";
export const LEGACY_EXPIRED_FIXTURE_HANDLE = "22222222222222222222222222222222";

export async function getLegacyGallery(handle: string): Promise<LegacyGalleryView | undefined> {
  if (!isLegacyGalleryHandle(handle)) return undefined;
  const deployment = readLegacyGalleryDeployment(process.env);
  if (deployment.adapter === "off") return undefined;
  if (deployment.adapter === "fixture") {
    if (handle === "44444444444444444444444444444444") throw new Error("Synthetic legacy delivery failure");
    if (handle !== LEGACY_FIXTURE_HANDLE) return undefined;
    return {
      images: [
        { itemId: "fixture-coast", mediaId: "fixture-coast", src: "/gallery/coastal-landscape.1683eecb7e65.webp", width: 1536, height: 1024, alt: "Rocky shoreline beside calm water" },
        { itemId: "fixture-portrait", mediaId: "fixture-portrait", src: "/gallery/layout-portrait.682a067b563a.webp", width: 256, height: 2048, alt: "Geometric portrait" },
      ],
      zipUrl: "/gallery/legacy-fixture.09eadd90911d.zip",
    };
  }
  if (!deployment.handles.has(handle)) return undefined;
  try {
    return await getLegacyGallerySanityReader(deployment.batch).read(handle);
  } catch (error) {
    if (!(error instanceof LegacyGalleryDataError) &&
        !(error instanceof SanityQueryError && error.errorClass === "malformed-response")) throw error;
    // Constant classification only: no handle, title, source URL or provider body.
    console.error("[legacy-gallery] malformed-content");
    return undefined;
  }
}
