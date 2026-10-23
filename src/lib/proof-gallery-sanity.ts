import "server-only";
import { createHash } from "node:crypto";
import { createSanityClient, createSanityDocumentReader, SanityQueryError, type SanityClient, type SanityDocumentReader } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  ClientGalleryBudgetError, ClientGalleryChangedError, ClientGalleryDataError,
  CLIENT_GALLERY_FORMATS, clientGalleryText, clientRecord, invalidClientGallery, isClientDocumentId, isClientGalleryHandle,
} from "@/lib/client-gallery-model";
import { parsePublishedProofGallery, proofGalleryAvailable, type ProofAvailability, type PublishedProofGallery } from "@/lib/proof-gallery-model";
import type { ProofGalleryView, ProofReplacement } from "@/lib/proof-gallery-types";

export const PROOF_GALLERY_HTTP_BYTES = 1024 * 1024;
export const PROOF_GALLERY_READ_TIMEOUT_MS = 15_000;
export const PROOF_GALLERY_MISS_TTL_MS = 10_000;
export const PROOF_GALLERY_MISS_CAPACITY = 128;

/**
 * Indexed discovery/snapshot only; a fresh Doc read below is the authority.
 * `originalFilename` is projected only so the snapshot parses as the closed
 * document does; it never leaves this module.
 */
export const PROOF_GALLERY_QUERY = `*[_type == "clientProofGallery" && handle == $handle][0...2]{
  _id, _type,
  "document": {_id, _type, _rev, handle, available, availabilityMode, expiryInstant, referenceHighWater, replacedBy,
    "title": title[0...21]{_key, _type, language, value},
    "items": items[0...257]{_key, _type, mediaType, originalFilename, reference,
      image{_type, asset{_type, _ref}, crop, hotspot},
      "alt": alt[0...21]{_key, _type, language, value}}},
  "assets": items[0...257]{"asset": image.asset->{_id, _type, sha1hash, extension, mimeType,
    "width": metadata.dimensions.width, "height": metadata.dimensions.height,
    "restricted": count(*[_type == "media" && image.asset._ref == ^._id && defined(privateOnly) && privateOnly != false]) > 0}},
  "replacement": replacedBy->{_id, _type, handle}
}`;

export class ProofGalleryProviderError extends Error {
  constructor() { super("Proof gallery provider unavailable"); this.name = "ProofGalleryProviderError"; }
}

function validateAssets(value: unknown, gallery: PublishedProofGallery): void {
  try {
    if (!Array.isArray(value) || value.length !== gallery.items.length || Object.keys(value).length !== value.length) return invalidClientGallery();
    for (let index = 0; index < gallery.items.length; index++) {
      const asset = clientRecord(clientRecord(value[index]).asset), item = gallery.items[index];
      if (asset._id !== item.assetId || asset._type !== "sanity.imageAsset" || asset.sha1hash !== item.hash ||
        asset.extension !== item.extension || asset.mimeType !== CLIENT_GALLERY_FORMATS[item.extension] ||
        asset.width !== item.width || asset.height !== item.height || asset.restricted !== false) return invalidClientGallery();
    }
  } catch { return invalidClientGallery(); }
}

/** The dereferenced replacement must be the referenced client gallery; a deleted one is ignored. */
function replacementOf(value: unknown, gallery: PublishedProofGallery): ProofReplacement | undefined {
  if (gallery.replacedBy === undefined || value === null || value === undefined) return undefined;
  const row = clientRecord(value);
  if (row._id !== gallery.replacedBy || row._type !== "clientDeliveryGallery" || !isClientGalleryHandle(row.handle)) return invalidClientGallery();
  return { id: gallery.replacedBy, handle: row.handle };
}

type ReaderConfig = Pick<SanityConfig, "projectId" | "dataset" | "apiVersion" | "datasetVisibility">;

/**
 * A published proof gallery as read: its view, its own availability for the
 * caller to apply at decision time, and the delivery gallery that may replace
 * it. Present even when the proofs are paused or expired if a replacement is
 * named, since the delivery gallery supersedes them for the same customer.
 */
export type ProofGalleryRead = Readonly<{ view: ProofGalleryView; availability: ProofAvailability; replacement?: ProofReplacement }>;

/**
 * The customer page's proof reader (ADR-0038 action item 2), the client gallery
 * reader's shape: discovery by handle within the proof type only, then the
 * published document by its own ID (a dotted ID — a draft or private record —
 * is never read), compared with the snapshot after normalization.
 * Missing galleries, and paused or expired ones naming no replacement, are
 * `undefined`; malformed content, a changing document, the time budget and the
 * provider throw.
 */
export function createProofGalleryReader(settings: {
  config: ReaderConfig; query: SanityClient; documents: SanityDocumentReader;
  now?: () => number; missClock?: () => number; missing?: Map<string, number>;
  signal?: () => AbortSignal;
}) {
  const config = { ...settings.config }, now = settings.now ?? Date.now;
  const clock = settings.missClock ?? (() => performance.now()), missing = settings.missing ?? new Map<string, number>();
  const publicDataset = config.datasetVisibility === "public";
  return {
    async read(handle: string, language: string, fallbackLanguage: string): Promise<ProofGalleryRead | undefined> {
      if (!isClientGalleryHandle(handle)) return undefined;
      try {
        const signal = settings.signal?.() ?? AbortSignal.timeout(PROOF_GALLERY_READ_TIMEOUT_MS);
        const checkBudget = () => { if (signal.aborted) throw new ClientGalleryBudgetError(); };
        checkBudget();
        const cacheKey = `${config.projectId}/${config.dataset}/${config.apiVersion}/${handle}`;
        const missUntil = publicDataset ? missing.get(cacheKey) : undefined;
        if (missUntil !== undefined && missUntil > clock()) return undefined;
        missing.delete(cacheKey);
        let knownId: string | undefined;
        const fresh = async (id: string) => {
          checkBudget();
          const raw = await settings.documents.read(id, signal);
          checkBudget();
          if (raw === null) return undefined;
          const result = parsePublishedProofGallery(raw, id, handle);
          // Only a gallery that could still answer — open, or naming a replacement — is worth the rest of the read.
          return proofGalleryAvailable(result, now()) || result.replacedBy !== undefined ? result : undefined;
        };
        for (let attempt = 0; attempt < 2; attempt++) {
          checkBudget();
          const rows = await settings.query.query({ query: PROOF_GALLERY_QUERY, tag: "client.proof", params: { handle }, signal });
          checkBudget();
          if (!Array.isArray(rows) || rows.length > 2 || Object.keys(rows).length !== rows.length) return invalidClientGallery();
          if (rows.length === 0) {
            if (knownId !== undefined) {
              if (await fresh(knownId)) throw new ClientGalleryChangedError();
              return undefined;
            }
            if (publicDataset) {
              if (missing.size >= PROOF_GALLERY_MISS_CAPACITY) missing.delete(missing.keys().next().value!);
              missing.set(cacheKey, clock() + PROOF_GALLERY_MISS_TTL_MS);
            }
            return undefined;
          }
          if (rows.length !== 1) return invalidClientGallery();
          const row = clientRecord(rows[0]);
          if (row._type !== "clientProofGallery" || !isClientDocumentId(row._id)) return invalidClientGallery();
          if (knownId !== undefined && knownId !== row._id) throw new ClientGalleryChangedError();
          knownId = row._id;
          const current = await fresh(row._id);
          if (current === undefined) return undefined;
          const rawSnapshot = clientRecord(row.document);
          if (rawSnapshot._rev !== current.revision) {
            if (attempt === 0) continue;
            throw new ClientGalleryChangedError();
          }
          const snapshot = parsePublishedProofGallery(rawSnapshot, row._id, handle, true);
          if (JSON.stringify(snapshot) !== JSON.stringify(current)) {
            if (attempt === 0) continue;
            throw new ClientGalleryChangedError();
          }
          validateAssets(row.assets, current);
          const replacement = replacementOf(row.replacement, current);
          checkBudget();
          if (!proofGalleryAvailable(current, now()) && replacement === undefined) return undefined;
          const title = clientGalleryText(current.title, language);
          const view: ProofGalleryView = {
            ...(current.expiryInstant === undefined ? {} : { availableUntil: current.expiryInstant }),
            ...(title === undefined ? {} : { title }),
            images: current.items.map((item) => ({
              itemId: item.key,
              // Opaque gallery-local media identity; repeated sources keep one alias.
              mediaId: `proof-${createHash("sha256").update(JSON.stringify([handle, item.assetId])).digest("hex")}`,
              src: `https://cdn.sanity.io/images/${config.projectId}/${config.dataset}/${item.assetId.slice(6).replace(/-(avif|jpeg|jpg|png|webp)$/u, ".$1")}`,
              width: item.width, height: item.height,
              alt: clientGalleryText(item.alt, language, fallbackLanguage) ?? "",
              reference: item.reference,
            })),
          };
          return {
            view, availability: { available: current.available, ...(current.deadline === undefined ? {} : { deadline: current.deadline }) },
            ...(replacement === undefined ? {} : { replacement }),
          };
        }
        throw new ClientGalleryChangedError();
      } catch (error) {
        if (error instanceof ClientGalleryDataError || error instanceof ClientGalleryChangedError ||
          error instanceof ClientGalleryBudgetError || error instanceof SanityQueryError) throw error;
        throw new ProofGalleryProviderError();
      }
    },
  };
}

// Only absent discovery results, never customer content, publication or expiry.
const missingProofGalleries = new Map<string, number>();
export function getProofGallerySanityReader() {
  const config = getSanityConfig();
  return createProofGalleryReader({
    config, missing: missingProofGalleries,
    query: createSanityClient({ config, maxResponseBytes: PROOF_GALLERY_HTTP_BYTES, rejectDuplicateJsonKeys: true }),
    documents: createSanityDocumentReader({ config, tag: "client.proof.document", maxResponseBytes: PROOF_GALLERY_HTTP_BYTES, rejectDuplicateJsonKeys: true }),
  });
}
