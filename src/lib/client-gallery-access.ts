import "server-only";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getLegacyGallery } from "@/lib/legacy-gallery-access";
import { readLegacyGalleryDeployment } from "@/lib/legacy-gallery-deployment";
import { readClientGalleryDeployment } from "@/lib/client-gallery-deployment";
import { ClientGalleryDataError, isClientGalleryHandle } from "@/lib/client-gallery-model";
import { getClientGallerySanityReader } from "@/lib/client-gallery-sanity";
import { SanityQueryError } from "@/lib/sanity-client";
import type { ClientGalleryView } from "@/lib/client-gallery-types";

export const CLIENT_GALLERY_FIXTURE_HANDLE = "6".repeat(32);

export async function getClientGallery(handle: string, language: string): Promise<ClientGalleryView | undefined> {
  if (!isClientGalleryHandle(handle)) return undefined;
  // An invalid legacy configuration propagates. It cannot surrender ownership.
  const legacy = readLegacyGalleryDeployment(process.env);
  if ((legacy.adapter === "sanity" && legacy.handles.has(handle)) ||
    (legacy.adapter === "fixture" && ["1", "2", "4"].some((digit) => handle === digit.repeat(32)))) {
    const gallery = await getLegacyGallery(handle);
    return gallery === undefined ? undefined : { ...gallery, kind: "legacy" };
  }
  const adapter = readClientGalleryDeployment(process.env);
  if (adapter === "off") return undefined;
  if (adapter === "fixture") {
    if (handle === "9".repeat(32)) throw new Error("Synthetic client gallery failure");
    if (handle !== CLIENT_GALLERY_FIXTURE_HANDLE) return undefined;
    const finnish = language.toLowerCase().split("-")[0] === "fi";
    return { kind: "web", title: finnish ? "Piilotettu toimitus" : "Unlisted delivery", images: [
      { itemId: "client-coast", mediaId: "client-coast", src: "/gallery/coastal-landscape.1683eecb7e65.webp", width: 1536, height: 1024, alt: finnish ? "Rantakallio ja tyyni meri" : "Rocky shoreline beside calm water", enquiryAllowed: false },
      { itemId: "client-portrait", mediaId: "client-portrait", src: "/gallery/layout-portrait.682a067b563a.webp", width: 256, height: 2048, alt: finnish ? "Geometrinen muotokuva" : "Geometric portrait", enquiryAllowed: false },
    ] };
  }
  try {
    return await getClientGallerySanityReader().read(handle, language, getDeploymentConfig().locale);
  } catch (error) {
    if (!(error instanceof ClientGalleryDataError) &&
      !(error instanceof SanityQueryError && error.errorClass === "malformed-response")) throw error;
    console.error("[client-gallery] malformed-content");
    return undefined;
  }
}
