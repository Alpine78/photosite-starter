import "server-only";
import { createHash } from "node:crypto";
import { createSanityClient, createSanityDocumentReader, SanityQueryError, type SanityClient, type SanityDocumentReader } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import {
  ClientGalleryBudgetError, ClientGalleryChangedError, ClientGalleryDataError,
  CLIENT_GALLERY_FORMATS, clientGalleryAvailable, clientGalleryText, clientRecord,
  invalidClientGallery, isClientDocumentId, isClientGalleryHandle, parseClientGallery,
  type ParsedClientGallery,
} from "@/lib/client-gallery-model";
import type { ClientGalleryView } from "@/lib/client-gallery-types";

export const CLIENT_GALLERY_HTTP_BYTES = 1024 * 1024;
export const CLIENT_GALLERY_READ_TIMEOUT_MS = 15_000;
export const CLIENT_GALLERY_MISS_TTL_MS = 10_000;
export const CLIENT_GALLERY_MISS_CAPACITY = 128;

/** Indexed discovery/snapshot only; a fresh Doc read below is the authority. */
export const CLIENT_GALLERY_QUERY = `*[_type in ["clientDeliveryGallery", "legacyDeliveryGallery"] && handle == $handle][0...2]{
  _id, _type,
  "document": {_id, _type, _rev, handle, available, availabilityMode, expiryInstant,
    "title": title[0...21]{_key, _type, language, value},
    "items": items[0...257]{_key, _type, mediaType,
      image{_type, asset{_type, _ref}, crop, hotspot},
      "alt": alt[0...21]{_key, _type, language, value}}},
  "assets": items[0...257]{"asset": image.asset->{_id, _type, sha1hash, extension, mimeType,
    "width": metadata.dimensions.width, "height": metadata.dimensions.height,
    "restricted": count(*[_type == "media" && image.asset._ref == ^._id && defined(privateOnly) && privateOnly != false]) > 0}}
}`;

export class ClientGalleryProviderError extends Error {
  constructor() { super("Client gallery provider unavailable"); this.name = "ClientGalleryProviderError"; }
}

function validateAssets(value: unknown, gallery: ParsedClientGallery): void {
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

type ReaderConfig = Pick<SanityConfig, "projectId" | "dataset" | "apiVersion" | "datasetVisibility">;
export function createClientGalleryReader(settings: {
  config: ReaderConfig; query: SanityClient; documents: SanityDocumentReader;
  now?: () => number; missClock?: () => number; missing?: Map<string, number>;
  signal?: () => AbortSignal;
}) {
  const config = { ...settings.config }, now = settings.now ?? Date.now;
  const clock = settings.missClock ?? (() => performance.now()), missing = settings.missing ?? new Map<string, number>();
  const publicDataset = config.datasetVisibility === "public";
  return {
    /** `expectedId`: answer only for that document (a proof gallery's replacement link), never another owner of the handle. */
    async read(handle: string, language: string, fallbackLanguage: string, expectedId?: string): Promise<ClientGalleryView | undefined> {
      if (!isClientGalleryHandle(handle)) return undefined;
      try {
        const signal = settings.signal?.() ?? AbortSignal.timeout(CLIENT_GALLERY_READ_TIMEOUT_MS);
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
          const result = parseClientGallery(raw, id, handle);
          return clientGalleryAvailable(result, now()) ? result : undefined;
        };
        for (let attempt = 0; attempt < 2; attempt++) {
          checkBudget();
          const rows = await settings.query.query({ query: CLIENT_GALLERY_QUERY, tag: "client.gallery", params: { handle }, signal });
          checkBudget();
          if (!Array.isArray(rows) || rows.length > 2 || Object.keys(rows).length !== rows.length) return invalidClientGallery();
          if (rows.length === 0) {
            if (knownId !== undefined) {
              if (await fresh(knownId)) throw new ClientGalleryChangedError();
              return undefined;
            }
            if (publicDataset) {
              if (missing.size >= CLIENT_GALLERY_MISS_CAPACITY) missing.delete(missing.keys().next().value!);
              missing.set(cacheKey, clock() + CLIENT_GALLERY_MISS_TTL_MS);
            }
            return undefined;
          }
          if (rows.length !== 1) return invalidClientGallery();
          const row = clientRecord(rows[0]);
          if (row._type === "legacyDeliveryGallery") {
            if (knownId !== undefined && await fresh(knownId)) throw new ClientGalleryChangedError();
            return undefined;
          }
          if (row._type !== "clientDeliveryGallery" || !isClientDocumentId(row._id)) return invalidClientGallery();
          if (expectedId !== undefined && row._id !== expectedId) return undefined;
          if (knownId !== undefined && knownId !== row._id) throw new ClientGalleryChangedError();
          knownId = row._id;
          const current = await fresh(row._id);
          if (current === undefined) return undefined;
          const rawSnapshot = clientRecord(row.document);
          if (rawSnapshot._rev !== current.revision) {
            if (attempt === 0) continue;
            throw new ClientGalleryChangedError();
          }
          const snapshot = parseClientGallery(rawSnapshot, row._id, handle, true);
          if (JSON.stringify(snapshot) !== JSON.stringify(current)) {
            if (attempt === 0) continue;
            throw new ClientGalleryChangedError();
          }
          validateAssets(row.assets, current);
          checkBudget();
          if (!clientGalleryAvailable(current, now())) return undefined;
          const title = clientGalleryText(current.title, language);
          return {
            kind: "web",
            ...(current.expiryInstant === undefined ? {} : { availableUntil: current.expiryInstant }),
            ...(title === undefined ? {} : { title }),
            images: current.items.map((item) => ({
              itemId: item.key,
              // Opaque gallery-local media identity; repeated sources keep one alias.
              mediaId: `client-${createHash("sha256").update(JSON.stringify([handle, item.assetId])).digest("hex")}`,
              src: `https://cdn.sanity.io/images/${config.projectId}/${config.dataset}/${item.assetId.slice(6).replace(/-(avif|jpeg|jpg|png|webp)$/u, ".$1")}`,
              width: item.width, height: item.height,
              alt: clientGalleryText(item.alt, language, fallbackLanguage)!,
              enquiryAllowed: false,
            })),
          };
        }
        throw new ClientGalleryChangedError();
      } catch (error) {
        if (error instanceof ClientGalleryDataError || error instanceof ClientGalleryChangedError ||
          error instanceof ClientGalleryBudgetError || error instanceof SanityQueryError) throw error;
        throw new ClientGalleryProviderError();
      }
    },
  };
}

// Only absent discovery results, never customer content, publication or expiry.
const missingClientGalleries = new Map<string, number>();
export function getClientGallerySanityReader() {
  const config = getSanityConfig();
  return createClientGalleryReader({
    config, missing: missingClientGalleries,
    query: createSanityClient({ config, maxResponseBytes: CLIENT_GALLERY_HTTP_BYTES, rejectDuplicateJsonKeys: true }),
    documents: createSanityDocumentReader({ config, tag: "client.gallery.document", maxResponseBytes: CLIENT_GALLERY_HTTP_BYTES, rejectDuplicateJsonKeys: true }),
  });
}
