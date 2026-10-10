/** AB#250: owner-local source review only; no asset binding or CMS mutation. */
import { createHash } from "node:crypto";

export const LEGACY_PLAN_VERSION = "legacy-delivery-import-plan-v1";
export const MAX_INPUT_BYTES = 8 * 1024 * 1024;
export const MAX_JPEG_BYTES = 100_000_000;
export const MAX_ZIP_BYTES = 3_000_000_000;
export const MAX_TOTAL_IMAGES = 2048;

export class LegacyPlanError extends Error {
  constructor(code: string, gallery?: number, image?: number) {
    super(`${code}${gallery === undefined ? "" : `:g${gallery}`}${image === undefined ? "" : `:i${image}`}`);
    this.name = "LegacyPlanError";
  }
}

export type LegacyFile = Readonly<{
  sourceLocator: string; sha1: string; sha256: string; bytes: number;
}>;
export type LegacyImage = LegacyFile & Readonly<{
  width: number; height: number; orientation: 1; alt: string;
}>;
export type LegacyAvailability = Readonly<{ mode: "indefinite" }> |
  Readonly<{ mode: "until"; expiryInstant: string }>;
export type LegacySourceGallery = Readonly<{
  legacyId: number; handle: string; legacyPath: string; displayTitle?: string;
  availability: LegacyAvailability; images: readonly LegacyImage[]; zip: LegacyFile | null;
}>;
export type LegacySource = Readonly<{
  version: 1;
  target: Readonly<{ projectId: string; dataset: "production" }>;
  sourceEvidence: Readonly<{
    backupSha256: string; availabilitySha256: string; orderingSha256: string; inventorySha256: string;
  }>;
  excludedLegacyIds: readonly number[]; galleries: readonly LegacySourceGallery[];
}>;

function fail(code: string): never { throw new LegacyPlanError(code); }
function object(value: unknown, required: readonly string[], optional: readonly string[] = []): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail("OBJECT_SHAPE");
  const raw = value as Record<string, unknown>;
  const allowed = new Set([...required, ...optional]);
  if (Object.keys(raw).some((key) => !allowed.has(key)) ||
    required.some((key) => !Object.hasOwn(raw, key))) fail("OBJECT_FIELDS");
  return raw;
}
function text(value: unknown, maxBytes: number, empty = false): string {
  if (typeof value !== "string" || !value.isWellFormed() || (!empty && value.length === 0) ||
    Buffer.byteLength(value, "utf8") > maxBytes || /[\p{Cc}\p{Cf}]/u.test(value)) fail("STRING_SHAPE");
  return value;
}
function hash(value: unknown, length: 40 | 64): string {
  const result = text(value, length);
  if (!new RegExp(`^[a-f0-9]{${length}}$`, "u").test(result)) fail("HASH_SHAPE");
  return result;
}
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1 || value > max) fail("INTEGER_RANGE");
  return value;
}
function locator(value: unknown): string {
  const result = text(value, 1024);
  if (/[\\:%?#]/u.test(result) || result.split("/").some((part) => !part || part === "." || part === "..")) fail("SOURCE_LOCATOR");
  return result;
}
function legacyPath(value: unknown): string {
  const result = text(value, 1024);
  // An exact local site path, never a URL; percent encodings and ambiguous aliases are refused.
  if (!result.startsWith("/") || result.startsWith("//") ||
    /[\\:%?#]/u.test(result) || result.slice(1).split("/").some((part) => !part || part === "." || part === "..")) fail("LEGACY_PATH");
  return result;
}
function availability(value: unknown, now: number): LegacyAvailability {
  const raw = object(value, ["mode"], ["expiryInstant"]);
  if (raw.mode === "indefinite" && !Object.hasOwn(raw, "expiryInstant")) return { mode: "indefinite" };
  if (raw.mode !== "until") fail("AVAILABILITY_SHAPE");
  const expiryInstant = text(raw.expiryInstant, 20);
  const deadline = Date.parse(expiryInstant);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(expiryInstant) || !Number.isFinite(deadline) ||
    new Date(deadline).toISOString() !== expiryInstant.replace("Z", ".000Z")) fail("DEADLINE_SHAPE");
  if (now >= deadline) fail("GALLERY_EXPIRED");
  return { mode: "until", expiryInstant };
}
function file(value: unknown, image: boolean): LegacyFile | LegacyImage {
  const raw = object(value, ["sourceLocator", "sha1", "sha256", "bytes",
    ...(image ? ["width", "height", "orientation", "alt"] : [])]);
  const result: LegacyFile = {
    sourceLocator: locator(raw.sourceLocator), sha1: hash(raw.sha1, 40), sha256: hash(raw.sha256, 64),
    bytes: integer(raw.bytes, image ? MAX_JPEG_BYTES : MAX_ZIP_BYTES),
  };
  if (!image) return result;
  const width = integer(raw.width, 32768), height = integer(raw.height, 32768);
  if (width * height > 256_000_000 || raw.orientation !== 1) fail("IMAGE_METADATA");
  return { ...result, width, height, orientation: 1, alt: text(raw.alt, 400, true) };
}
function descriptor(value: LegacyFile | LegacyImage): string {
  return JSON.stringify([value.sha1, value.sha256, value.bytes,
    "width" in value ? [value.width, value.height, value.orientation] : null]);
}

/** All arrays are copied; canonical gallery order does not alter source image order. */
export function parseLegacySource(value: unknown, now: number): LegacySource {
  if (!Number.isFinite(now)) fail("CLOCK_INVALID");
  const raw = object(value, ["version", "target", "sourceEvidence", "excludedLegacyIds", "galleries"]);
  if (raw.version !== 1) fail("SOURCE_VERSION");
  const target = object(raw.target, ["projectId", "dataset"]);
  const projectId = text(target.projectId, 64);
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(projectId) || target.dataset !== "production") fail("TARGET_SHAPE");
  const evidence = object(raw.sourceEvidence, ["backupSha256", "availabilitySha256", "orderingSha256", "inventorySha256"]);
  const sourceEvidence = {
    backupSha256: hash(evidence.backupSha256, 64), availabilitySha256: hash(evidence.availabilitySha256, 64),
    orderingSha256: hash(evidence.orderingSha256, 64), inventorySha256: hash(evidence.inventorySha256, 64),
  };
  if (!Array.isArray(raw.excludedLegacyIds) || raw.excludedLegacyIds.length > 256) fail("EXCLUSIONS_SHAPE");
  const excludedLegacyIds = raw.excludedLegacyIds.map((id) => integer(id)).sort((a, b) => a - b);
  if (new Set(excludedLegacyIds).size !== excludedLegacyIds.length) fail("DUPLICATE_EXCLUSION");
  if (!Array.isArray(raw.galleries) || raw.galleries.length < 1 || raw.galleries.length > 256) fail("GALLERIES_SHAPE");
  const ids = new Set<number>(), handles = new Set<string>(), paths = new Set<string>();
  const byPath = new Map<string, string>(), byAlias = new Map<string, string>(), bySha1 = new Map<string, string>();
  let totalImages = 0;
  const register = (asset: LegacyFile | LegacyImage): void => {
    const exact = asset.sourceLocator, alias = exact.normalize("NFC").toLowerCase(), signature = descriptor(asset);
    if (byAlias.has(alias) && byAlias.get(alias) !== exact) fail("SOURCE_ALIAS_COLLISION");
    if ((byPath.has(exact) && byPath.get(exact) !== signature) ||
      (bySha1.has(asset.sha1) && bySha1.get(asset.sha1) !== signature)) fail("SOURCE_DESCRIPTOR_CONFLICT");
    byPath.set(exact, signature); byAlias.set(alias, exact); bySha1.set(asset.sha1, signature);
  };
  const galleries = raw.galleries.map((value, g): LegacySourceGallery => {
    try {
      const row = object(value, ["legacyId", "handle", "legacyPath", "availability", "images", "zip"], ["displayTitle"]);
      const legacyId = integer(row.legacyId), handle = text(row.handle, 32);
      if (!/^[a-f0-9]{32}$/u.test(handle)) fail("HANDLE_SHAPE");
      return { legacyId, handle, legacyPath: legacyPath(row.legacyPath), availability: availability(row.availability, now), images: [], zip: null };
    } catch (error) {
      if (error instanceof LegacyPlanError) throw new LegacyPlanError(error.message, g);
      throw error;
    }
  });
  // Fill each closed projection only after its gallery-level fields are validated.
  for (let g = 0; g < galleries.length; g += 1) {
    const row = raw.galleries[g] as Record<string, unknown>;
    try {
      const handle = text(row.handle, 32);
      if (!/^[a-f0-9]{32}$/u.test(handle)) fail("HANDLE_SHAPE");
      const legacyId = galleries[g].legacyId, sitePath = galleries[g].legacyPath;
      if (ids.has(legacyId) || handles.has(handle) || paths.has(sitePath.normalize("NFC").toLowerCase()) || excludedLegacyIds.includes(legacyId)) fail("GALLERY_IDENTITY_CONFLICT");
      ids.add(legacyId); handles.add(handle); paths.add(sitePath.normalize("NFC").toLowerCase());
      if (!Array.isArray(row.images) || row.images.length < 1 || row.images.length > 256) fail("IMAGES_SHAPE");
      totalImages += row.images.length;
      if (totalImages > MAX_TOTAL_IMAGES) fail("TOTAL_IMAGES_LIMIT");
      const images = row.images.map((value, i) => {
        try { const image = file(value, true) as LegacyImage; register(image); return image; }
        catch (error) { if (error instanceof LegacyPlanError) throw new LegacyPlanError(error.message, undefined, i); throw error; }
      });
      const zip = row.zip === null ? null : file(row.zip, false);
      if (zip !== null) register(zip);
      galleries[g] = { ...galleries[g], handle, images, zip,
        ...(Object.hasOwn(row, "displayTitle") ? { displayTitle: text(row.displayTitle, 200) } : {}) };
    } catch (error) {
      if (error instanceof LegacyPlanError) throw new LegacyPlanError(error.message, g);
      throw error;
    }
  }
  return { version: 1, target: { projectId, dataset: "production" }, sourceEvidence,
    excludedLegacyIds, galleries: galleries.sort((a, b) => a.legacyId - b.legacyId) };
}

function fileTuple(value: LegacyFile | LegacyImage): unknown[] {
  return [value.sourceLocator, value.sha1, value.sha256, value.bytes,
    ...("width" in value ? [value.width, value.height, value.orientation, value.alt] : [])];
}
function digest(source: LegacySource): string {
  const e = source.sourceEvidence;
  return createHash("sha256").update(JSON.stringify([
    LEGACY_PLAN_VERSION, source.target.projectId, source.target.dataset,
    [e.backupSha256, e.availabilitySha256, e.orderingSha256, e.inventorySha256], source.excludedLegacyIds,
    source.galleries.map((g) => [g.legacyId, g.handle, g.legacyPath, g.displayTitle ?? null,
      [g.availability.mode, g.availability.mode === "until" ? g.availability.expiryInstant : null],
      g.images.map(fileTuple), g.zip === null ? null : fileTuple(g.zip)]),
  ])).digest("hex");
}

export function buildLegacyImportPlan(value: unknown, now: number) {
  const source = parseLegacySource(value, now);
  const imageIds = new Set<string>();
  const placements = source.galleries.map((g) => ({ handle: g.handle,
    images: g.images.map((image, position) => {
      const imageId = createHash("sha256").update(JSON.stringify([
        "legacy-delivery-placement-v1", g.handle, position, image.sha256,
      ])).digest("hex").slice(0, 32);
      if (imageIds.has(imageId)) fail("PLACEMENT_ID_COLLISION");
      imageIds.add(imageId);
      return { position, imageId };
    }),
  }));
  return {
    version: LEGACY_PLAN_VERSION, status: "offline-review-only" as const, reviewDigest: digest(source), source, placements,
    counts: { galleries: source.galleries.length, images: imageIds.size,
      zips: source.galleries.filter((g) => g.zip !== null).length, excluded: source.excludedLegacyIds.length },
    unresolvedGates: ["supported-whole-zip-transfer", "fresh-target-baseline", "provider-usage",
      "recovery", "notice-reconciliation", "owner-exact-plan-approval", "publication"] as const,
  };
}
