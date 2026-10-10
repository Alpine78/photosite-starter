export const LEGACY_GALLERY_ROOT = "client-gallery";
export const MAX_LEGACY_GALLERY_IMAGES = 256;

export function isLegacyGalleryHandle(value: string): boolean {
  return /^[a-f0-9]{32}$/.test(value);
}

/** Recognize aliases for refusal/hygiene; only the literal grammar is served. */
export function isLegacyGalleryNamespace(pathname: string, localePrefixes: readonly string[] = []): boolean {
  const segments = pathname.slice(1).split("/", 3);
  const decode = (value: string | undefined) => {
    if (value === undefined || value.length > 128) return "";
    try { return decodeURIComponent(value).toLowerCase(); } catch { return ""; }
  };
  const first = decode(segments[0]);
  const owns = (value: string) => value === LEGACY_GALLERY_ROOT || value.startsWith(`${LEGACY_GALLERY_ROOT}/`);
  return owns(first) || (localePrefixes.includes(first) && owns(decode(segments[1])));
}

export function legacyGalleryHandleFromPath(pathname: string): string | undefined {
  return /^\/client-gallery\/([a-f0-9]{32})\/?$/.exec(pathname)?.[1];
}
