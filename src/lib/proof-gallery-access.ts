import "server-only";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { ClientGalleryDataError, isClientGalleryHandle } from "@/lib/client-gallery-model";
import { readProofGalleryDeployment } from "@/lib/proof-gallery-deployment";
import { getProofGallerySanityReader } from "@/lib/proof-gallery-sanity";
import { SanityQueryError } from "@/lib/sanity-client";
import type { ProofGalleryView } from "@/lib/proof-gallery-types";

export const PROOF_GALLERY_FIXTURE_HANDLE = "7".repeat(32);
export const PROOF_GALLERY_DEADLINE_FIXTURE_HANDLE = "8".repeat(32);
export const PROOF_GALLERY_DEADLINE_FIXTURE_INSTANT = "2100-01-02T03:04:05.123Z";
/** Answers like a provider failure, for the error boundary journey. */
export const PROOF_GALLERY_FAILURE_FIXTURE_HANDLE = "e".repeat(32);

/** The proof page's only data source (ADR-0038 action item 2). */
export async function getProofGallery(handle: string, language: string): Promise<ProofGalleryView | undefined> {
  if (!isClientGalleryHandle(handle)) return undefined;
  const adapter = readProofGalleryDeployment(process.env);
  if (adapter === "off") return undefined;
  if (adapter === "fixture") {
    if (handle === PROOF_GALLERY_FAILURE_FIXTURE_HANDLE) throw new Error("Synthetic proof gallery failure");
    if (handle !== PROOF_GALLERY_FIXTURE_HANDLE && handle !== PROOF_GALLERY_DEADLINE_FIXTURE_HANDLE) return undefined;
    const finnish = language.toLowerCase().split("-")[0] === "fi";
    return {
      ...(handle === PROOF_GALLERY_DEADLINE_FIXTURE_HANDLE ? { availableUntil: PROOF_GALLERY_DEADLINE_FIXTURE_INSTANT } : {}),
      title: finnish ? "Vedokset" : "Proofs",
      // Authored order with a gap: numbers are permanent, not positions.
      images: [
        { itemId: "proof-portrait", mediaId: "proof-portrait", src: "/gallery/layout-portrait.682a067b563a.webp", width: 256, height: 2048, alt: finnish ? "Geometrinen muotokuva" : "Geometric portrait", reference: "014" },
        { itemId: "proof-coast", mediaId: "proof-coast", src: "/gallery/coastal-landscape.1683eecb7e65.webp", width: 1536, height: 1024, alt: "", reference: "002" },
      ],
    };
  }
  try {
    return await getProofGallerySanityReader().read(handle, language, getDeploymentConfig().locale);
  } catch (error) {
    if (!(error instanceof ClientGalleryDataError) &&
      !(error instanceof SanityQueryError && error.errorClass === "malformed-response")) throw error;
    console.error("[proof-gallery] malformed-content");
    return undefined;
  }
}
