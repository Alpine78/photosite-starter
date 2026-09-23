/**
 * AB#167: the pure half of the rally folder importer (ADR-0022 §6).
 *
 * Turns one exported rally folder — already scanned into file facts by
 * `plan-rally-import.mts`, which owns every filesystem read — plus its
 * `rally.json` into a reviewable import plan for a capture-sequence gallery:
 * two gallery documents (one per language) and one media document per file.
 * Nothing here reads a file, touches the network, or needs a credential; the
 * write step is a separate story.
 *
 * The owner's file name is the ordering authority:
 * `<filePrefix>_<NNNN>_<sectionKey>.<jpg|jpeg|webp>`, where `NNNN` is a
 * four-digit running number unique across the rally and `sectionKey` is
 * declared in `rally.json`. EXIF capture time is never read. Every refusal is
 * collected rather than thrown at the first one, because an owner told about
 * one bad file at a time renames a folder twenty times.
 */

import { createHash } from "node:crypto";

import { MAX_PUBLIC_DELIVERY_DIMENSION } from "./sanity-seed-fixtures.mts";

export const RALLY_MANIFEST_FILE = "rally.json";
export const RALLY_MANIFEST_VERSION = 1;
export const RALLY_IMPORT_PLAN_VERSION = "rally-import-plan-v1";

/** The `gallery.orderingRule` value (ADR-0022), restated from `sanity/schemas/capture-sequence.ts`. */
export const CAPTURE_SEQUENCE_ORDERING_RULE = "capture-sequence";

/**
 * Document id namespace for this importer — disjoint from the demo seeder's
 * `seed--` (whose `--delete-all` must never reach real content) and the Joomla
 * migration's `migrated--`.
 */
export const RALLY_ID_PREFIX = "rally--";

/** Placeholder references the write step resolves. */
export const PENDING_CATEGORY_PREFIX = "pending-category:";
export const PENDING_ASSET_PREFIX = "pending-asset:";

/**
 * Identity shapes restated from the Studio schemas (`gallery.ts`, `category.ts`,
 * `localized-slug.ts`, `media.ts`) — a script cannot import them under Node's
 * native type stripping without their own extension-less imports crashing it —
 * and pinned equal by `rally-import-plan.test.mts`.
 */
export const IDENTITY_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
export const LANGUAGE_SUBTAG = /^[a-z]{2,3}$/u;
export const MAX_GALLERY_SECTIONS = 20;
export const RESERVED_ALL_SECTION_SLUG = "all";

/** Section keys and file names are ASCII by convention (ADR-0022 §6). */
const SECTION_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const FILE_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/u;
const CATEGORY_ID_PATTERN = IDENTITY_PATTERN;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/u;
const ISO_UTC_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;

/** Built-in alt-text nouns; any other language must supply its own `photoWord`. */
const DEFAULT_PHOTO_WORDS: Readonly<Record<string, string>> = {
  fi: "kuva",
  en: "photograph",
};

const ACCEPTED_EXTENSIONS: Readonly<Record<string, "jpeg" | "webp">> = {
  jpg: "jpeg",
  jpeg: "jpeg",
  webp: "webp",
};

/** Camera-master and sidecar extensions named in the refusal, so the reason is obvious. */
const CAMERA_MASTER_EXTENSIONS = new Set([
  "dng", "raw", "raf", "cr2", "cr3", "nef", "arw", "orf", "rw2", "pef", "srw", "tif", "tiff", "psd", "xmp",
]);

// ---------------------------------------------------------------------------
// rally.json
// ---------------------------------------------------------------------------

export type LocalizedStrings = Readonly<Record<string, string>>;

export type RallySection = {
  readonly key: string;
  readonly sectionId: string;
  readonly slug: string;
  readonly label: LocalizedStrings;
};

export type RallyManifest = {
  readonly contentId: string;
  readonly filePrefix: string;
  readonly canonicalCategory: string;
  readonly eventDate: string;
  readonly publishedAt?: string;
  readonly title: LocalizedStrings;
  readonly slug: LocalizedStrings;
  readonly summary?: LocalizedStrings;
  readonly photoWord: LocalizedStrings;
  readonly cover?: number;
  readonly sections: readonly RallySection[];
  readonly languages: readonly string[];
};

const MANIFEST_FIELDS = new Set([
  "version", "contentId", "filePrefix", "canonicalCategory", "eventDate", "publishedAt",
  "title", "slug", "summary", "photoWord", "cover", "sections",
]);
const SECTION_FIELDS = new Set(["key", "label", "slug"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(value).filter((key) => !allowed.has(key));
}

/** `SS2_Milzkalne_1` → `ss2-milzkalne-1`. */
export function sectionIdFromKey(key: string): string {
  return key.toLowerCase().replace(/[_-]+/gu, "-").replace(/^-+|-+$/gu, "");
}

function isRealCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function readLocalized(
  value: unknown,
  field: string,
  issues: string[],
  pattern?: RegExp,
): LocalizedStrings | undefined {
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    issues.push(`${field} must be an object keyed by language, e.g. {"fi": "…", "en": "…"}`);
    return undefined;
  }
  const result: Record<string, string> = {};
  for (const [language, text] of Object.entries(value)) {
    if (!LANGUAGE_SUBTAG.test(language)) {
      issues.push(`${field} has an invalid language key "${language}"`);
      continue;
    }
    if (typeof text !== "string" || text.trim().length === 0 || text !== text.trim()) {
      issues.push(`${field}.${language} must be non-empty text without surrounding whitespace`);
      continue;
    }
    if (pattern !== undefined && !pattern.test(text)) {
      issues.push(`${field}.${language} must use lowercase letters, digits, and single hyphens`);
      continue;
    }
    result[language] = text;
  }
  return result;
}

function sameLanguages(
  value: LocalizedStrings | undefined,
  languages: readonly string[],
  field: string,
  issues: string[],
): void {
  if (value === undefined) return;
  const keys = Object.keys(value).toSorted();
  if (keys.join(",") !== [...languages].toSorted().join(",")) {
    issues.push(`${field} must have exactly the languages of title (${languages.join(", ")})`);
  }
}

/**
 * Validates `rally.json` strictly: a version, every required field, no unknown
 * field at any level, and the same language set everywhere a localized value
 * appears. Returns every issue at once.
 */
export function parseRallyManifest(raw: unknown): {
  readonly manifest: RallyManifest | undefined;
  readonly issues: readonly string[];
} {
  const issues: string[] = [];
  if (!isPlainObject(raw)) {
    return { manifest: undefined, issues: [`${RALLY_MANIFEST_FILE} must be a JSON object`] };
  }
  for (const field of unknownFields(raw, MANIFEST_FIELDS)) {
    issues.push(`${RALLY_MANIFEST_FILE} has an unknown field "${field}"`);
  }
  if (raw.version !== RALLY_MANIFEST_VERSION) {
    issues.push(`version must be ${RALLY_MANIFEST_VERSION}`);
  }

  const contentId = raw.contentId;
  if (typeof contentId !== "string" || !IDENTITY_PATTERN.test(contentId)) {
    issues.push("contentId must use lowercase letters, digits, and single hyphens, e.g. rally-finland-2024");
  }
  const filePrefix = raw.filePrefix;
  if (typeof filePrefix !== "string" || !FILE_PREFIX_PATTERN.test(filePrefix)) {
    issues.push("filePrefix must be ASCII letters, digits, underscores, or hyphens, e.g. Rally_Finland_2024");
  }
  const canonicalCategory = raw.canonicalCategory;
  if (typeof canonicalCategory !== "string" || !CATEGORY_ID_PATTERN.test(canonicalCategory)) {
    issues.push("canonicalCategory must be a category ID: lowercase letters, digits, and single hyphens");
  }

  let eventDate: string | undefined;
  const eventDateMatch = typeof raw.eventDate === "string" ? ISO_DATE.exec(raw.eventDate) : null;
  if (
    eventDateMatch === null ||
    !isRealCalendarDate(Number(eventDateMatch[1]), Number(eventDateMatch[2]), Number(eventDateMatch[3]))
  ) {
    issues.push("eventDate must be a real calendar date, YYYY-MM-DD");
  } else {
    // Noon UTC keeps the date the same calendar day in every European time zone.
    eventDate = `${raw.eventDate as string}T12:00:00.000Z`;
  }

  let publishedAt: string | undefined;
  if (raw.publishedAt !== undefined) {
    if (
      typeof raw.publishedAt !== "string" ||
      !ISO_UTC_DATETIME.test(raw.publishedAt) ||
      Number.isNaN(Date.parse(raw.publishedAt)) ||
      new Date(raw.publishedAt).toISOString() !== raw.publishedAt
    ) {
      issues.push("publishedAt, when given, must be a UTC timestamp like 2024-08-05T09:00:00.000Z");
    } else {
      publishedAt = raw.publishedAt;
    }
  }

  const title = readLocalized(raw.title, "title", issues);
  const languages = title === undefined ? [] : Object.keys(title).toSorted();
  const slug = readLocalized(raw.slug, "slug", issues, IDENTITY_PATTERN);
  sameLanguages(slug, languages, "slug", issues);
  const summary =
    raw.summary === undefined ? undefined : readLocalized(raw.summary, "summary", issues);
  sameLanguages(summary, languages, "summary", issues);

  const suppliedPhotoWord =
    raw.photoWord === undefined ? {} : (readLocalized(raw.photoWord, "photoWord", issues) ?? {});
  const photoWord: Record<string, string> = {};
  for (const language of languages) {
    const word = suppliedPhotoWord[language] ?? DEFAULT_PHOTO_WORDS[language];
    if (word === undefined) {
      issues.push(`photoWord.${language} is required: there is no built-in word for "photograph" in that language`);
    } else {
      photoWord[language] = word;
    }
  }

  let cover: number | undefined;
  if (raw.cover !== undefined) {
    if (typeof raw.cover !== "number" || !Number.isSafeInteger(raw.cover) || raw.cover < 1 || raw.cover > 9999) {
      issues.push("cover, when given, must be the running number (1–9999) of the photograph to use as the cover");
    } else {
      cover = raw.cover;
    }
  }

  const sections: RallySection[] = [];
  if (!Array.isArray(raw.sections) || raw.sections.length === 0) {
    issues.push("sections must be a non-empty list");
  } else if (raw.sections.length > MAX_GALLERY_SECTIONS) {
    issues.push(`sections may hold at most ${MAX_GALLERY_SECTIONS} entries`);
  } else {
    raw.sections.forEach((entry, index) => {
      const at = `sections[${index}]`;
      if (!isPlainObject(entry)) {
        issues.push(`${at} must be an object`);
        return;
      }
      for (const field of unknownFields(entry, SECTION_FIELDS)) {
        issues.push(`${at} has an unknown field "${field}"`);
      }
      const key = entry.key;
      if (typeof key !== "string" || !SECTION_KEY_PATTERN.test(key)) {
        issues.push(`${at}.key must be the file-name section key: ASCII letters, digits, underscores, or hyphens`);
        return;
      }
      const sectionId = sectionIdFromKey(key);
      const sectionSlug = entry.slug === undefined ? sectionId : entry.slug;
      if (typeof sectionSlug !== "string" || !IDENTITY_PATTERN.test(sectionSlug)) {
        issues.push(`${at}.slug must use lowercase letters, digits, and single hyphens`);
        return;
      }
      if (sectionSlug === RESERVED_ALL_SECTION_SLUG) {
        issues.push(`${at}.slug "${RESERVED_ALL_SECTION_SLUG}" is reserved for the unfiltered view`);
        return;
      }
      const label = readLocalized(entry.label, `${at}.label`, issues);
      sameLanguages(label, languages, `${at}.label`, issues);
      if (label === undefined) return;
      sections.push({ key, sectionId, slug: sectionSlug, label });
    });
    for (const [field, values] of [
      ["key", sections.map((section) => section.key)],
      ["section id (derived from key)", sections.map((section) => section.sectionId)],
      ["slug", sections.map((section) => section.slug)],
    ] as const) {
      const seen = new Set<string>();
      for (const value of values) {
        if (seen.has(value)) issues.push(`two sections share the ${field} "${value}"`);
        seen.add(value);
      }
    }
  }

  if (issues.length > 0 || title === undefined || slug === undefined || eventDate === undefined) {
    return { manifest: undefined, issues };
  }
  return {
    manifest: {
      contentId: contentId as string,
      filePrefix: filePrefix as string,
      canonicalCategory: canonicalCategory as string,
      eventDate,
      ...(publishedAt === undefined ? {} : { publishedAt }),
      title,
      slug,
      ...(summary === undefined ? {} : { summary }),
      photoWord,
      ...(cover === undefined ? {} : { cover }),
      sections,
      languages,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

/** What the IO half learned about one file, without keeping its bytes. */
export type ScannedFile = {
  /** Path relative to the rally folder, `/`-separated. */
  readonly relativePath: string;
  readonly contentHash: string;
  /** Decoded format, when the file could be decoded as an image at all. */
  readonly format?: string;
  /** Displayed dimensions, EXIF orientation applied. */
  readonly width?: number;
  readonly height?: number;
  readonly pages?: number;
};

export type ParsedFileName =
  | { readonly ok: true; readonly sequence: number; readonly sectionKey: string; readonly format: "jpeg" | "webp" }
  | { readonly ok: false; readonly reason: string };

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Parses `<filePrefix>_<NNNN>_<sectionKey>.<ext>`; the reason names what to rename. */
export function parseRallyFileName(fileName: string, filePrefix: string): ParsedFileName {
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot + 1).toLowerCase();
  if (CAMERA_MASTER_EXTENSIONS.has(extension)) {
    return {
      ok: false,
      reason: `.${extension} is a camera master or sidecar file — export a web JPG or WebP instead`,
    };
  }
  const format = ACCEPTED_EXTENSIONS[extension];
  if (format === undefined) {
    return { ok: false, reason: "only exported .jpg, .jpeg, or .webp files are imported" };
  }
  const stem = fileName.slice(0, dot);
  if (!/^[A-Za-z0-9_-]+$/u.test(stem)) {
    return { ok: false, reason: "file names may use only ASCII letters, digits, underscores, and hyphens" };
  }
  const match = new RegExp(`^${escapeForRegExp(filePrefix)}_(\\d{4})_(.+)$`, "u").exec(stem);
  if (match === null) {
    return {
      ok: false,
      reason: `expected ${filePrefix}_<four-digit number>_<section key>.${extension}`,
    };
  }
  const sequence = Number(match[1]);
  if (sequence < 1) return { ok: false, reason: "the running number starts at 0001" };
  const sectionKey = match[2] as string;
  if (!SECTION_KEY_PATTERN.test(sectionKey)) {
    return { ok: false, reason: `"${sectionKey}" is not a valid section key` };
  }
  return { ok: true, sequence, sectionKey, format };
}

// ---------------------------------------------------------------------------
// Identities
// ---------------------------------------------------------------------------

/**
 * `mediaId` is minted opaquely and never derived from a file name (ADR-0002
 * §1). This map keeps it stable across runs by content hash, so a rerun or a
 * rename reuses the identity; a re-export changes the bytes and therefore does
 * not — the one case the owner has to carry over by hand.
 */
export type RallyIdentityMap = {
  readonly version: 1;
  readonly byContentHash: Readonly<Record<string, string>>;
};

export function emptyIdentityMap(): RallyIdentityMap {
  return { version: 1, byContentHash: {} };
}

const CONTENT_HASH = /^[0-9a-f]{64}$/u;

export function parseIdentityMap(raw: unknown): {
  readonly identities: RallyIdentityMap | undefined;
  readonly issues: readonly string[];
} {
  if (!isPlainObject(raw) || raw.version !== 1 || !isPlainObject(raw.byContentHash)) {
    return { identities: undefined, issues: ["the identity map must be {\"version\": 1, \"byContentHash\": {…}}"] };
  }
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const [hash, mediaId] of Object.entries(raw.byContentHash)) {
    if (!CONTENT_HASH.test(hash)) issues.push(`identity map key "${hash}" is not a SHA-256 hex digest`);
    if (typeof mediaId !== "string" || !IDENTITY_PATTERN.test(mediaId)) {
      issues.push(`identity map value for ${hash} is not a valid mediaId`);
    } else if (seen.has(mediaId)) {
      issues.push(`identity map names mediaId "${mediaId}" for two different files`);
    } else {
      seen.add(mediaId);
    }
  }
  return issues.length > 0
    ? { identities: undefined, issues }
    : { identities: { version: 1, byContentHash: raw.byContentHash as Record<string, string> }, issues };
}

// ---------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------

export type PlannedDocument = Readonly<Record<string, unknown>> & {
  readonly _id: string;
  readonly _type: string;
};

export type RallyAssetRequirement = {
  readonly mediaId: string;
  readonly documentId: string;
  readonly relativePath: string;
  readonly contentHash: string;
  readonly width: number;
  readonly height: number;
};

export type RallyImportPlan = {
  readonly version: typeof RALLY_IMPORT_PLAN_VERSION;
  readonly contentId: string;
  readonly languages: readonly string[];
  readonly canonicalCategory: string;
  readonly acceptedInterleavedSections: boolean;
  readonly documents: readonly PlannedDocument[];
  readonly assetRequirements: readonly RallyAssetRequirement[];
  readonly documentsDigest: string;
};

export type RallyFileRefusal = { readonly relativePath: string; readonly reason: string };

export type RallyPlanResult = {
  readonly plan: RallyImportPlan | undefined;
  readonly refusals: readonly RallyFileRefusal[];
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
  readonly identities: RallyIdentityMap;
  readonly counts: {
    readonly files: number;
    readonly photographs: number;
    readonly reusedIdentities: number;
    readonly newIdentities: number;
    readonly bySection: Readonly<Record<string, number>>;
  };
};

export function galleryDocumentId(contentId: string, language: string): string {
  return `${RALLY_ID_PREFIX}gallery-${contentId}-${language}`;
}

export function mediaDocumentId(mediaId: string): string {
  return `${RALLY_ID_PREFIX}media-${mediaId}`;
}

/** Deterministic JSON (sorted keys) for a stable digest of what will be written. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value)
      .toSorted()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function digestOf(documents: readonly PlannedDocument[], assets: readonly RallyAssetRequirement[]): string {
  return createHash("sha256").update(canonicalJson({ documents, assets })).digest("hex");
}

type AcceptedFile = {
  readonly file: ScannedFile;
  readonly sequence: number;
  readonly section: RallySection;
};

/**
 * Sections whose running-number ranges overlap, in declaration order. Usually a
 * photograph in the wrong stage; sometimes deliberate (a service-park photograph
 * between two stages), which is why it is a warning the owner may accept.
 */
export function findInterleavedSections(
  accepted: readonly { readonly sequence: number; readonly sectionKey: string }[],
): readonly string[] {
  const ranges = new Map<string, { min: number; max: number }>();
  for (const { sequence, sectionKey } of accepted) {
    const range = ranges.get(sectionKey);
    if (range === undefined) ranges.set(sectionKey, { min: sequence, max: sequence });
    else {
      range.min = Math.min(range.min, sequence);
      range.max = Math.max(range.max, sequence);
    }
  }
  const sorted = [...ranges.entries()].toSorted((a, b) => a[1].min - b[1].min);
  const warnings: string[] = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const [previousKey, previous] = sorted[index - 1] as [string, { min: number; max: number }];
    const [key, current] = sorted[index] as [string, { min: number; max: number }];
    if (current.min < previous.max) {
      warnings.push(
        `sections "${previousKey}" (${previous.min}–${previous.max}) and "${key}" (${current.min}–${current.max}) interleave`,
      );
    }
  }
  return warnings;
}

function localizedTextArray(values: LocalizedStrings, languages: readonly string[]) {
  return languages.map((language) => ({
    _key: `alt-${language}`,
    _type: "localizedText",
    language,
    value: values[language] as string,
  }));
}

/**
 * Builds the plan, or explains why not. A plan is produced only when there is
 * no refusal and no problem; warnings block too unless the owner accepted them
 * with `acceptInterleavedSections`.
 */
export function buildRallyImportPlan(input: {
  readonly manifest: RallyManifest;
  readonly files: readonly ScannedFile[];
  readonly identities: RallyIdentityMap;
  /** Used when `rally.json` gives no `publishedAt`: the time this plan was made. */
  readonly now: Date;
  readonly acceptInterleavedSections: boolean;
  /** Mints one new opaque `mediaId` for this gallery; injected so tests are deterministic. */
  readonly mintMediaId: (contentId: string) => string;
}): RallyPlanResult {
  const { manifest } = input;
  const refusals: RallyFileRefusal[] = [];
  const problems: string[] = [];
  const sectionsByKey = new Map(manifest.sections.map((section) => [section.key, section]));
  const accepted: AcceptedFile[] = [];
  const bySequence = new Map<number, string>();
  const byHash = new Map<string, string>();

  for (const file of input.files) {
    const fileName = file.relativePath.split("/").at(-1) ?? file.relativePath;
    const parsed = parseRallyFileName(fileName, manifest.filePrefix);
    if (!parsed.ok) {
      refusals.push({ relativePath: file.relativePath, reason: parsed.reason });
      continue;
    }
    const section = sectionsByKey.get(parsed.sectionKey);
    if (section === undefined) {
      refusals.push({
        relativePath: file.relativePath,
        reason: `section key "${parsed.sectionKey}" is not declared in ${RALLY_MANIFEST_FILE}`,
      });
      continue;
    }
    if (file.format !== parsed.format) {
      refusals.push({
        relativePath: file.relativePath,
        reason:
          file.format === undefined
            ? "the file could not be decoded as an image"
            : `the file is ${file.format}, not what its .${fileName.split(".").at(-1)} extension says`,
      });
      continue;
    }
    if ((file.pages ?? 1) > 1) {
      refusals.push({ relativePath: file.relativePath, reason: "animated or multi-page images are not imported" });
      continue;
    }
    if (
      file.width === undefined ||
      file.height === undefined ||
      file.width < 1 ||
      file.height < 1 ||
      Math.max(file.width, file.height) > MAX_PUBLIC_DELIVERY_DIMENSION
    ) {
      refusals.push({
        relativePath: file.relativePath,
        reason: `the longest edge must be at most ${MAX_PUBLIC_DELIVERY_DIMENSION} px (export a web derivative, never the full-size file)`,
      });
      continue;
    }
    const previousSequence = bySequence.get(parsed.sequence);
    if (previousSequence !== undefined) {
      refusals.push({
        relativePath: file.relativePath,
        reason: `running number ${String(parsed.sequence).padStart(4, "0")} is also used by ${previousSequence}`,
      });
      continue;
    }
    const previousHash = byHash.get(file.contentHash);
    if (previousHash !== undefined) {
      refusals.push({
        relativePath: file.relativePath,
        reason: `the same photograph (identical bytes) is also ${previousHash}; one photograph has one position`,
      });
      continue;
    }
    bySequence.set(parsed.sequence, file.relativePath);
    byHash.set(file.contentHash, file.relativePath);
    accepted.push({ file, sequence: parsed.sequence, section });
  }

  const bySection: Record<string, number> = {};
  for (const section of manifest.sections) bySection[section.key] = 0;
  for (const { section } of accepted) bySection[section.key] = (bySection[section.key] ?? 0) + 1;
  for (const [key, count] of Object.entries(bySection)) {
    if (count === 0) problems.push(`section "${key}" is declared but has no files`);
  }
  if (accepted.length === 0 && refusals.length === 0) {
    problems.push("the folder holds no photographs");
  }
  if (manifest.cover !== undefined && !bySequence.has(manifest.cover)) {
    problems.push(`cover ${String(manifest.cover).padStart(4, "0")} names no photograph in the folder`);
  }

  const warnings = findInterleavedSections(
    accepted.map(({ sequence, section }) => ({ sequence, sectionKey: section.key })),
  );
  if (warnings.length > 0 && !input.acceptInterleavedSections) {
    problems.push(
      "section running-number ranges interleave — move the photographs to the right stage, or rerun with --accept-interleaved-sections if that is intended",
    );
  }

  // Identities: reuse by content hash, mint the rest. Minted ids are kept
  // unique against every id already in the map.
  const byContentHash: Record<string, string> = { ...input.identities.byContentHash };
  const takenIds = new Set(Object.values(byContentHash));
  let reused = 0;
  let minted = 0;
  const ordered = accepted.toSorted((a, b) => a.sequence - b.sequence);
  const mediaIdOf = new Map<string, string>();
  for (const { file } of ordered) {
    const known = byContentHash[file.contentHash];
    if (known !== undefined) {
      mediaIdOf.set(file.contentHash, known);
      reused += 1;
      continue;
    }
    let candidate = input.mintMediaId(manifest.contentId);
    for (let attempt = 0; takenIds.has(candidate) && attempt < 10; attempt += 1) {
      candidate = input.mintMediaId(manifest.contentId);
    }
    if (takenIds.has(candidate) || !IDENTITY_PATTERN.test(candidate)) {
      throw new Error(`could not mint a unique, valid mediaId for ${file.relativePath}`);
    }
    takenIds.add(candidate);
    byContentHash[file.contentHash] = candidate;
    mediaIdOf.set(file.contentHash, candidate);
    minted += 1;
  }
  const identities: RallyIdentityMap = { version: 1, byContentHash };

  const counts = {
    files: input.files.length,
    photographs: accepted.length,
    reusedIdentities: reused,
    newIdentities: minted,
    bySection,
  };

  if (refusals.length > 0 || problems.length > 0) {
    return { plan: undefined, refusals, problems, warnings, identities, counts };
  }

  const publishedAt = manifest.publishedAt ?? input.now.toISOString();
  const mediaDocuments: PlannedDocument[] = [];
  const assetRequirements: RallyAssetRequirement[] = [];
  for (const { file, sequence, section } of ordered) {
    const mediaId = mediaIdOf.get(file.contentHash) as string;
    const documentId = mediaDocumentId(mediaId);
    const alt: Record<string, string> = {};
    for (const language of manifest.languages) {
      alt[language] =
        `${manifest.title[language]}: ${section.label[language]}, ${manifest.photoWord[language]} ${sequence}`;
    }
    mediaDocuments.push({
      _id: documentId,
      _type: "media",
      mediaId,
      mediaType: "image",
      alt: localizedTextArray(alt, manifest.languages),
      publiclyRenderable: true,
      captureSequence: {
        galleryContentId: manifest.contentId,
        sequence,
        sectionId: section.sectionId,
      },
      image: {
        _type: "image",
        asset: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}${mediaId}` },
      },
    });
    assetRequirements.push({
      mediaId,
      documentId,
      relativePath: file.relativePath,
      contentHash: file.contentHash,
      width: file.width as number,
      height: file.height as number,
    });
  }

  const coverMediaId =
    manifest.cover === undefined
      ? undefined
      : ordered.find((entry) => entry.sequence === manifest.cover)?.file.contentHash;
  const galleryDocuments: PlannedDocument[] = manifest.languages.map((language) => ({
    _id: galleryDocumentId(manifest.contentId, language),
    _type: "gallery",
    contentId: manifest.contentId,
    language,
    title: manifest.title[language],
    slug: manifest.slug[language],
    ...(manifest.summary === undefined ? {} : { summary: manifest.summary[language] }),
    publishedAt,
    eventDate: manifest.eventDate,
    canonicalCategory: {
      _type: "reference",
      _ref: `${PENDING_CATEGORY_PREFIX}${manifest.canonicalCategory}`,
    },
    orderingRule: CAPTURE_SEQUENCE_ORDERING_RULE,
    sections: manifest.sections.map((section) => ({
      _key: section.sectionId,
      sectionId: section.sectionId,
      slug: section.slug,
      label: section.label[language],
    })),
    ...(coverMediaId === undefined
      ? {}
      : {
          cover: {
            _type: "reference",
            _ref: mediaDocumentId(mediaIdOf.get(coverMediaId) as string),
          },
        }),
  }));

  const documents = [...mediaDocuments, ...galleryDocuments];
  return {
    plan: {
      version: RALLY_IMPORT_PLAN_VERSION,
      contentId: manifest.contentId,
      languages: manifest.languages,
      canonicalCategory: manifest.canonicalCategory,
      acceptedInterleavedSections: warnings.length > 0,
      documents,
      assetRequirements,
      documentsDigest: digestOf(documents, assetRequirements),
    },
    refusals,
    problems,
    warnings,
    identities,
    counts,
  };
}
