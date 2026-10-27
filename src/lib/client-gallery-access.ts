import "server-only";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { getLegacyGallery } from "@/lib/legacy-gallery-access";
import { readLegacyGalleryDeployment } from "@/lib/legacy-gallery-deployment";
import { readClientGalleryDeployment } from "@/lib/client-gallery-deployment";
import { CLIENT_GALLERY_MAX_ITEMS, ClientGalleryDataError, isClientGalleryHandle } from "@/lib/client-gallery-model";
import { getClientGallerySanityReader } from "@/lib/client-gallery-sanity";
import { SanityQueryError } from "@/lib/sanity-client";
import type { ClientGalleryView } from "@/lib/client-gallery-types";

export const CLIENT_GALLERY_FIXTURE_HANDLE = "6".repeat(32);
export const CLIENT_GALLERY_DEADLINE_FIXTURE_HANDLE = "b".repeat(32);
export const CLIENT_GALLERY_DEADLINE_FIXTURE_INSTANT = "2100-01-02T03:04:05.123Z";
export const CLIENT_GALLERY_ZIP_FIXTURE_HANDLE = "d".repeat(32);
/** Tiny synthetic JPEG ZIP, fixture adapter only: exercises native download with no external request. */
const ZIP_FIXTURE_URL = "data:application/zip;base64,UEsDBBQAAAAAAAAAISgr+3mwCwEAAAsBAAAOAAAAaW1hZ2UtMDAwMS5qcGf/2P/bAEMABgQFBgUEBgYFBgcHBggKEAoKCQkKFA4PDBAXFBgYFxQWFhodJR8aGyMcFhYgLCAjJicpKikZHy0wLSgwJSgpKP/bAEMBBwcHCggKEwoKEygaFhooKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKP/AABEIAAEAAQMBIgACEQEDEQH/xAAVAAEBAAAAAAAAAAAAAAAAAAAABv/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmgAf/9lQSwECFAMUAAAAAAAAACEoK/t5sAsBAAALAQAADgAAAAAAAAAAAAAAgAEAAAAAaW1hZ2UtMDAwMS5qcGdQSwUGAAAAAAEAAQA8AAAANwEAAAAA";
export const CLIENT_GALLERY_CAPACITY_FIXTURE_HANDLE = "c".repeat(32);
/** The synthetic document behind CLIENT_GALLERY_FIXTURE_HANDLE, for proof replacement fixtures. */
export const CLIENT_GALLERY_FIXTURE_ID = "client-fixture";

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
    if (![CLIENT_GALLERY_FIXTURE_HANDLE, CLIENT_GALLERY_DEADLINE_FIXTURE_HANDLE, CLIENT_GALLERY_CAPACITY_FIXTURE_HANDLE, CLIENT_GALLERY_ZIP_FIXTURE_HANDLE].includes(handle)) return undefined;
    const finnish = language.toLowerCase().split("-")[0] === "fi";
    const gallery: ClientGalleryView = { kind: "web", ...(handle === CLIENT_GALLERY_ZIP_FIXTURE_HANDLE ? { zipUrl: ZIP_FIXTURE_URL } : {}), ...(handle === CLIENT_GALLERY_DEADLINE_FIXTURE_HANDLE ? { availableUntil: CLIENT_GALLERY_DEADLINE_FIXTURE_INSTANT } : {}), title: finnish ? "Piilotettu toimitus" : "Unlisted delivery", images: [
      { itemId: "client-coast", mediaId: "client-coast", src: "/gallery/coastal-landscape.1683eecb7e65.webp", width: 1536, height: 1024, alt: finnish ? "Rantakallio ja tyyni meri" : "Rocky shoreline beside calm water", enquiryAllowed: false },
      { itemId: "client-portrait", mediaId: "client-portrait", src: "/gallery/layout-portrait.682a067b563a.webp", width: 256, height: 2048, alt: finnish ? "Geometrinen muotokuva" : "Geometric portrait", enquiryAllowed: false },
    ] };
    return handle !== CLIENT_GALLERY_CAPACITY_FIXTURE_HANDLE ? gallery : {
      ...gallery,
      images: Array.from({ length: CLIENT_GALLERY_MAX_ITEMS }, (_, index) => {
        const image = gallery.images[index % gallery.images.length];
        return { ...image, itemId: `client-capacity-${index + 1}`, alt: `${image.alt} (${index + 1})` };
      }),
    };
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

/**
 * Whether exactly the referenced new delivery gallery is available at `handle`
 * (ADR-0038 owner answer 5). A retained legacy handle, another document now
 * owning the handle, or a disabled delivery adapter never qualifies.
 * Provider failures propagate like the delivery page's own.
 */
export async function isReplacementDeliveryAvailable(handle: string, documentId: string, language: string): Promise<boolean> {
  if (!isClientGalleryHandle(handle)) return false;
  const legacy = readLegacyGalleryDeployment(process.env);
  if ((legacy.adapter === "sanity" && legacy.handles.has(handle)) ||
    (legacy.adapter === "fixture" && ["1", "2", "4"].some((digit) => handle === digit.repeat(32)))) return false;
  const adapter = readClientGalleryDeployment(process.env);
  if (adapter === "off") return false;
  if (adapter === "fixture") return handle === CLIENT_GALLERY_FIXTURE_HANDLE && documentId === CLIENT_GALLERY_FIXTURE_ID;
  try {
    return await getClientGallerySanityReader().read(handle, language, getDeploymentConfig().locale, documentId) !== undefined;
  } catch (error) {
    if (!(error instanceof ClientGalleryDataError) &&
      !(error instanceof SanityQueryError && error.errorClass === "malformed-response")) throw error;
    console.error("[client-gallery] malformed-content");
    return false;
  }
}
