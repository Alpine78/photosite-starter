/** Canonical v1 import/read contract. No provider URL, filenames or source paths. */
export type LegacyManifestImage = Readonly<{
  id: string; position: number; assetId: string; bytes: number;
  width: number; height: number; orientation: number; alt: string;
}>;
export type LegacyManifestZip = Readonly<{ assetId: string; bytes: number }>;

export function legacyGalleryManifestString(
  galleryId: string, batch: string, images: readonly LegacyManifestImage[], zip: LegacyManifestZip | null,
): string {
  return JSON.stringify([
    "legacy-delivery-manifest-v1", galleryId, batch,
    images.map((i) => [i.id, i.position, i.assetId, i.bytes, i.width, i.height, i.orientation, i.alt]),
    zip === null ? null : [zip.assetId, zip.bytes],
  ]);
}
