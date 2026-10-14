import { readLegacyGalleryDeployment } from "./legacy-gallery-deployment";
import { isLegacyGalleryHandle, MAX_LEGACY_GALLERY_IMAGES } from "./legacy-gallery-path";

const MAX_CONFIG_BYTES = 64 * 1024;
const MAX_PATH_BYTES = 1024;
const ENV_KEYS = ["LEGACY_GALLERY_REDIRECTS", "LEGACY_GALLERY_HANDLES", "LEGACY_GALLERY_ADAPTER", "LEGACY_GALLERY_IMPORT_BATCH", "SITE_CONTENT_SOURCE", "SITE_DEPLOYMENT_STAGE", "VERCEL_ENV", "NODE_ENV"] as const;
function fail(): never { throw new Error("Invalid retained-gallery redirect configuration"); }

/** Deployment-only pairs; no customer paths belong in the repository. */
export function parseLegacyGalleryRedirects(raw: string, allowedHandles: ReadonlySet<string>): ReadonlyMap<string, string> {
  try {
    if (!raw.isWellFormed() || Buffer.byteLength(raw) > MAX_CONFIG_BYTES) fail();
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.length > MAX_LEGACY_GALLERY_IMAGES) fail();
    const result = new Map<string, string>();
    for (const row of rows) {
      if (!Array.isArray(row) || row.length !== 2) fail();
      const [source, handle] = row;
      if (typeof source !== "string" || !source.isWellFormed() || Buffer.byteLength(source) > MAX_PATH_BYTES ||
        !source.startsWith("/") || /[\\:%?#\p{Cc}\p{Cf}]/u.test(source) ||
        source.slice(1).split("/").some((part) => !part || part === "." || part === "..") ||
        /^\/(?:api|_next|admin|private|client-gallery|private-gallery|private-gallery-admin)(?:\/|$)/iu.test(source) ||
        result.has(source) || typeof handle !== "string" || !isLegacyGalleryHandle(handle) || !allowedHandles.has(handle)) fail();
      result.set(source, `/client-gallery/${handle}`);
    }
    return result;
  } catch { return fail(); } // Never propagate JSON diagnostics containing private values.
}

/** Parse once per deployment configuration; request lookup reads no CMS or secret. */
export function createLegacyGalleryRedirectResolver() {
  let previous: Record<string, string | undefined> | undefined;
  let mapping: ReadonlyMap<string, string> = new Map();
  return (pathname: string, environment: Record<string, string | undefined>): string | undefined => {
    const raw = environment.LEGACY_GALLERY_REDIRECTS;
    if (!raw?.trim()) return undefined;
    if (!previous || ENV_KEYS.some((key) => previous![key] !== environment[key])) {
      try {
        const config = readLegacyGalleryDeployment(environment);
        const handles = config.adapter === "sanity" ? config.handles : new Set((environment.LEGACY_GALLERY_HANDLES ?? "").split(","));
        if (config.adapter !== "off" && [...handles].some((handle) => !isLegacyGalleryHandle(handle))) fail();
        const parsed = config.adapter === "off" ? new Map<string, string>() : parseLegacyGalleryRedirects(raw, handles);
        mapping = parsed;
        previous = Object.fromEntries(ENV_KEYS.map((key) => [key, environment[key]]));
      } catch { return fail(); }
    }
    if (Buffer.byteLength(pathname) > MAX_PATH_BYTES * 3) return undefined;
    let decoded: string;
    try { decoded = decodeURI(pathname); } catch { return undefined; }
    if (/[\p{Cc}\p{Cf}%]/u.test(decoded)) return undefined;
    return mapping.get(decoded) ?? (decoded.endsWith("/") ? mapping.get(decoded.slice(0, -1)) : undefined);
  };
}
