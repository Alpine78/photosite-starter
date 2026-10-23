import "server-only";
import { getDeploymentConfig } from "@/lib/deployment-config";
import { ClientGalleryDataError, isClientGalleryHandle } from "@/lib/client-gallery-model";
import { CLIENT_GALLERY_FIXTURE_HANDLE, CLIENT_GALLERY_FIXTURE_ID, isReplacementDeliveryAvailable } from "@/lib/client-gallery-access";
import { proofGalleryAvailable } from "@/lib/proof-gallery-model";
import { readProofGalleryDeployment } from "@/lib/proof-gallery-deployment";
import { getProofGallerySanityReader, type ProofGalleryRead } from "@/lib/proof-gallery-sanity";
import { SanityQueryError } from "@/lib/sanity-client";
import type { ProofGalleryView } from "@/lib/proof-gallery-types";

export const PROOF_GALLERY_FIXTURE_HANDLE = "7".repeat(32);
export const PROOF_GALLERY_DEADLINE_FIXTURE_HANDLE = "8".repeat(32);
export const PROOF_GALLERY_DEADLINE_FIXTURE_INSTANT = "2100-01-02T03:04:05.123Z";
/** Answers like a provider failure, for the error boundary journey. */
export const PROOF_GALLERY_FAILURE_FIXTURE_HANDLE = "e".repeat(32);
/** Paused proofs replaced by the available delivery fixture: always redirects. */
export const PROOF_GALLERY_REPLACED_FIXTURE_HANDLE = "5".repeat(32);
/** Open proofs naming a delivery gallery that is not available: shows the proofs. */
export const PROOF_GALLERY_UNREPLACED_FIXTURE_HANDLE = "3".repeat(32);

export type ProofGalleryOutcome =
  | Readonly<{ kind: "proofs"; view: ProofGalleryView }>
  /** A temporary redirect to the delivery gallery that replaces the proofs (ADR-0038 owner answer 5). */
  | Readonly<{ kind: "replaced"; deliveryHandle: string }>;

function fixture(handle: string, language: string): ProofGalleryRead | undefined {
  if (handle === PROOF_GALLERY_FAILURE_FIXTURE_HANDLE) throw new Error("Synthetic proof gallery failure");
  if (![PROOF_GALLERY_FIXTURE_HANDLE, PROOF_GALLERY_DEADLINE_FIXTURE_HANDLE, PROOF_GALLERY_REPLACED_FIXTURE_HANDLE, PROOF_GALLERY_UNREPLACED_FIXTURE_HANDLE].includes(handle)) return undefined;
  const finnish = language.toLowerCase().split("-")[0] === "fi";
  const deadline = handle === PROOF_GALLERY_DEADLINE_FIXTURE_HANDLE;
  return {
    view: {
      ...(deadline ? { availableUntil: PROOF_GALLERY_DEADLINE_FIXTURE_INSTANT } : {}),
      title: finnish ? "Vedokset" : "Proofs",
      // Authored order with a gap: numbers are permanent, not positions.
      images: [
        { itemId: "proof-portrait", mediaId: "proof-portrait", src: "/gallery/layout-portrait.682a067b563a.webp", width: 256, height: 2048, alt: finnish ? "Geometrinen muotokuva" : "Geometric portrait", reference: "014" },
        { itemId: "proof-coast", mediaId: "proof-coast", src: "/gallery/coastal-landscape.1683eecb7e65.webp", width: 1536, height: 1024, alt: "", reference: "002" },
      ],
    },
    availability: { available: handle !== PROOF_GALLERY_REPLACED_FIXTURE_HANDLE, ...(deadline ? { deadline: Date.parse(PROOF_GALLERY_DEADLINE_FIXTURE_INSTANT) } : {}) },
    ...(handle === PROOF_GALLERY_REPLACED_FIXTURE_HANDLE ? { replacement: { id: CLIENT_GALLERY_FIXTURE_ID, handle: CLIENT_GALLERY_FIXTURE_HANDLE } } : {}),
    ...(handle === PROOF_GALLERY_UNREPLACED_FIXTURE_HANDLE ? { replacement: { id: "client-paused-fixture", handle: "0".repeat(32) } } : {}),
  };
}

async function read(handle: string, language: string, adapter: "fixture" | "sanity"): Promise<ProofGalleryRead | undefined> {
  if (adapter === "fixture") return fixture(handle, language);
  try {
    return await getProofGallerySanityReader().read(handle, language, getDeploymentConfig().locale);
  } catch (error) {
    if (!(error instanceof ClientGalleryDataError) &&
      !(error instanceof SanityQueryError && error.errorClass === "malformed-response")) throw error;
    console.error("[proof-gallery] malformed-content");
    return undefined;
  }
}

/**
 * The proof page's only data source (ADR-0038 action items 2 and owner answer 5).
 * An available replacing delivery gallery wins; otherwise the proofs show if
 * they are themselves available, judged after the delivery check so a deadline
 * crossed meanwhile is respected.
 */
export async function getProofGallery(handle: string, language: string): Promise<ProofGalleryOutcome | undefined> {
  if (!isClientGalleryHandle(handle)) return undefined;
  const adapter = readProofGalleryDeployment(process.env);
  if (adapter === "off") return undefined;
  const result = await read(handle, language, adapter);
  if (result === undefined) return undefined;
  if (result.replacement && await isReplacementDeliveryAvailable(result.replacement.handle, result.replacement.id, language)) {
    return { kind: "replaced", deliveryHandle: result.replacement.handle };
  }
  return proofGalleryAvailable(result.availability, Date.now()) ? { kind: "proofs", view: result.view } : undefined;
}
