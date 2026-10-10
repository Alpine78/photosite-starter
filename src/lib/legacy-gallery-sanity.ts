import "server-only";
import { createHash } from "node:crypto";
import { createSanityClient, createSanityDocumentReader, type SanityClient, type SanityDocumentReader } from "@/lib/sanity-client";
import { getSanityConfig, type SanityConfig } from "@/lib/sanity-config";
import { legacyGalleryManifestString, type LegacyManifestImage, type LegacyManifestZip } from "@/lib/legacy-gallery-manifest";
import { isLegacyGalleryHandle, MAX_LEGACY_GALLERY_IMAGES } from "@/lib/legacy-gallery-path";
import type { LightboxSlide } from "@/lib/lightbox-slides";

export const LEGACY_QUERY_MAX_RESPONSE_BYTES = 512 * 1024;
export const LEGACY_IMAGE_QUERY = `{
  "images": *[_type == "legacyDeliveryImage" && gallery._ref == $galleryId && migrationBatch == $batch]
    | order(position asc)[0...257]{_id, _type, imageId, migrationBatch, position, displayWidth, displayHeight, sourceOrientation, alt,
      "galleryId": gallery._ref, "galleryReferenceType": gallery._type,
      "sourceAssetId": source.asset._ref, "sourceReferenceType": source.asset._type,
      "asset": source.asset->{_id,_type,sha1hash,size,mimeType}},
  "zip": *[_id == $zipId && _type == "sanity.fileAsset"][0]{_id,_type,sha1hash,size,mimeType}
}`;

export class LegacyGalleryDataError extends Error {
  constructor() { super("Malformed legacy gallery content"); this.name = "LegacyGalleryDataError"; }
}

export type LegacyGalleryView = Readonly<{
  title?: string;
  images: readonly LightboxSlide[];
  zipUrl?: string;
}>;

function invalid(): never { throw new LegacyGalleryDataError(); }
function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return invalid();
  return value;
}
function integer(value: unknown, max: number, min = 1): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) return invalid();
  return value;
}

type Metadata = Readonly<{
  revision: string; title?: string; imageCount: number; manifestDigest: string; zipId: string | null;
}>;
function metadata(value: unknown, galleryId: string, handle: string, batch: string, now: number): Metadata | undefined {
  if (value === null) return undefined;
  const row = record(value);
  if (row._id !== galleryId || row._type !== "legacyDeliveryGallery" || row.handle !== handle ||
      row.migrationBatch !== batch || typeof row.published !== "boolean" ||
      typeof row._rev !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(row._rev)) return invalid();
  if (!Number.isFinite(now)) return invalid();
  if (row.availabilityMode === "until") {
    if (typeof row.expiryInstant !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(row.expiryInstant)) return invalid();
    const deadline = Date.parse(row.expiryInstant);
    if (!Number.isFinite(deadline) || new Date(deadline).toISOString().replace(".000Z", "Z") !== row.expiryInstant) return invalid();
    if (now >= deadline) return undefined;
  } else if (row.availabilityMode !== "indefinite" || row.expiryInstant != null) return invalid();
  if (!row.published) return undefined;
  const imageCount = integer(row.imageCount, MAX_LEGACY_GALLERY_IMAGES);
  if (typeof row.manifestDigest !== "string" || !/^[a-f0-9]{64}$/.test(row.manifestDigest)) return invalid();
  const title = row.displayTitle === undefined ? undefined : text(row.displayTitle, 200);
  let zipId: string | null = null;
  if (row.deliveryZip != null) {
    const file = record(row.deliveryZip);
    const ref = record(file.asset);
    if (file._type !== "file" || ref._type !== "reference" || typeof ref._ref !== "string" || !/^file-[a-f0-9]{40}-zip$/.test(ref._ref)) return invalid();
    zipId = ref._ref;
  }
  return { revision: row._rev, imageCount, manifestDigest: row.manifestDigest, zipId, ...(title === undefined ? {} : { title }) };
}

function image(value: unknown, galleryId: string, batch: string): LegacyManifestImage {
  const row = record(value);
  if (typeof row.imageId !== "string" || !isLegacyGalleryHandle(row.imageId) ||
      row._id !== `legacyDeliveryImage-${row.imageId}` || row._type !== "legacyDeliveryImage" ||
      row.galleryId !== galleryId || row.galleryReferenceType !== "reference" || row.migrationBatch !== batch ||
      row.sourceReferenceType !== "reference" || row.sourceOrientation !== 1) return invalid();
  const asset = record(row.asset);
  if (typeof asset._id !== "string" || asset._id !== row.sourceAssetId) return invalid();
  const parts = /^image-([a-f0-9]{40})-([1-9]\d{0,4})x([1-9]\d{0,4})-(jpg|jpeg)$/.exec(asset._id);
  if (!parts || asset._type !== "sanity.imageAsset" || asset.sha1hash !== parts[1] || asset.mimeType !== "image/jpeg") return invalid();
  const width = integer(Number(parts[2]), 32768), height = integer(Number(parts[3]), 32768);
  if (width * height > 256_000_000 || row.displayWidth !== width || row.displayHeight !== height) return invalid();
  return {
    id: row.imageId, position: integer(row.position, MAX_LEGACY_GALLERY_IMAGES - 1, 0),
    assetId: asset._id, bytes: integer(asset.size, 100_000_000), width, height, orientation: 1,
    alt: text(row.alt, 400),
  };
}

function zip(value: unknown, expectedId: string | null): LegacyManifestZip | null {
  if (expectedId === null) { if (value !== null) return invalid(); return null; }
  const asset = record(value);
  if (asset._id !== expectedId || asset._type !== "sanity.fileAsset" ||
      asset.sha1hash !== expectedId.slice(5, -4) || !["application/zip", "application/x-zip-compressed"].includes(String(asset.mimeType))) return invalid();
  return { assetId: expectedId, bytes: integer(asset.size, 3_000_000_000) };
}

export function createLegacyGalleryReader(settings: {
  config: Pick<SanityConfig, "projectId" | "dataset">;
  batch: string; documents: SanityDocumentReader; query: SanityClient; now?: () => number;
}) {
  const now = settings.now ?? Date.now;
  return {
    async read(handle: string): Promise<LegacyGalleryView | undefined> {
      if (!isLegacyGalleryHandle(handle)) return undefined;
      const galleryId = `legacyDeliveryGallery-${handle}`;
      const first = metadata(await settings.documents.read(galleryId), galleryId, handle, settings.batch, now());
      if (first === undefined) return undefined;
      const data = record(await settings.query.query({ query: LEGACY_IMAGE_QUERY, tag: "legacy.images", params: { galleryId, batch: settings.batch, zipId: first.zipId } }));
      if (!Array.isArray(data.images) || data.images.length !== first.imageCount || data.images.length > MAX_LEGACY_GALLERY_IMAGES) return invalid();
      const images = data.images.map((value) => image(value, galleryId, settings.batch)).sort((a, b) => a.position - b.position);
      if (new Set(images.map((i) => i.id)).size !== images.length || images.some((i, position) => i.position !== position)) return invalid();
      const archive = zip(data.zip, first.zipId);
      const digest = createHash("sha256").update(legacyGalleryManifestString(galleryId, settings.batch, images, archive)).digest("hex");
      if (digest !== first.manifestDigest) return invalid();
      const last = metadata(await settings.documents.read(galleryId), galleryId, handle, settings.batch, now());
      if (last === undefined || last.revision !== first.revision || last.manifestDigest !== digest) return undefined;
      const prefix = `https://cdn.sanity.io/images/${settings.config.projectId}/${settings.config.dataset}/`;
      const slides = images.map((i): LightboxSlide => ({
        itemId: i.id, mediaId: i.id, src: prefix + i.assetId.slice(6).replace(/-(jpg|jpeg)$/, ".$1"),
        width: i.width, height: i.height, alt: i.alt,
      }));
      return {
        ...(last.title === undefined ? {} : { title: last.title }), images: slides,
        ...(archive === null ? {} : { zipUrl: `https://cdn.sanity.io/files/${settings.config.projectId}/${settings.config.dataset}/${archive.assetId.slice(5, -4)}.zip?dl=photographs.zip` }),
      };
    },
  };
}

export function getLegacyGallerySanityReader(batch: string) {
  const configured = getSanityConfig();
  // Public root documents need no credential; private datasets use the declared
  // server-only reader. Neither choice turns direct asset URLs into protection.
  const config: SanityConfig = {
    projectId: configured.projectId, dataset: configured.dataset,
    datasetVisibility: configured.datasetVisibility, apiVersion: configured.apiVersion,
    ...(configured.datasetVisibility === "private" ? { readToken: configured.readToken } : {}),
  };
  return createLegacyGalleryReader({
    config, batch, documents: createSanityDocumentReader({ config }),
    query: createSanityClient({ config, maxResponseBytes: LEGACY_QUERY_MAX_RESPONSE_BYTES }),
  });
}
