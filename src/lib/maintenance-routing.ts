/** Request-only routing facts. These carry no content, credentials or preference. */
export const MAINTENANCE_FALLBACK_HEADER = "x-photosite-maintenance-fallback";
export const MAINTENANCE_FALLBACK_PATH = "/api/site-maintenance";

/** The old Proxy exclusions, including file-shaped paths that may not exist. */
export function isStaticAssetCandidate(pathname: string): boolean {
  return pathname.startsWith("/_next/") || pathname.startsWith("/gallery/") ||
    /^\/[^/]+\.[^/]+$/.test(pathname);
}

/** These are application routes despite their file-shaped names. */
export function isContentMetadataPath(pathname: string): boolean {
  // Next's filesystem route check decodes once and precedes afterFiles.
  // An encoded spelling of a real metadata route must terminate here too.
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); }
  catch { return true; } // Malformed static candidates cannot select a reader.
  return decoded === "/robots.txt" || decoded === "/sitemap.xml" || decoded === "/favicon.ico";
}
