/**
 * AB#138's pure audit logic: no network, no `process.argv`/`process.env` —
 * everything here is a function of its arguments, so it is fully exercised
 * by `scripts/sanity-audit.test.mts` against a fake `runQuery`. The CLI/IO
 * wiring (`scripts/audit-sanity-content.mts`) is deliberately thin around
 * this file, the same split `sanity-seed-fixtures.mts`/`seed-sanity-content.mts`
 * already use.
 *
 * ## What this audits, and how
 *
 * One keyset-paginated, `perspective: "raw"` scan over the *entire* dataset
 * (`*[]`, no `_type` filter) rather than one query per known application
 * type. A known-type allow-list would silently omit exactly what a
 * pre-launch audit exists to catch: an obsolete type, a plugin/system
 * document, or content nobody expects to be there. Every row this scan sees
 * is classified after the fact, dynamically, by its `_id` and `_type` — see
 * `classifySanityDocumentId` — so a published document, an unpublished draft
 * (`drafts.<id>`), a document copied into a content release
 * (`versions.<release>.<id>`, distinct from the `system.release` record
 * itself), and any unrecognized type are all counted, never silently
 * dropped. GROQ pagination follows Sanity's own documented cursor idiom
 * (`_id > $after`, `order(_id)[0...$limit]`) rather than offset slicing,
 * which Sanity's own performance guidance warns against for exactly this
 * kind of walk — the same idiom this repository's `gallery-sections.ts`
 * already uses for a curated gallery's own keyset pagination.
 *
 * Pagination correctness is checked, not assumed: every page must advance
 * strictly (each row's `_id` greater than the last seen), never return more
 * than the requested page size, and the final collected count must match an
 * initial `count(*[])` snapshot taken before the scan started. A mismatch
 * means the dataset changed while this audit was running — a document was
 * created or deleted mid-scan — and is reported as a distinct
 * `AuditConsistencyError` rather than a silently short or padded report.
 *
 * ## What this never does
 *
 * This module has no mutate/upload capability to call: it is built entirely
 * against `RunQuery`, a caller-supplied `(request) => Promise<unknown>`
 * function, and this file imports nothing from `sanity-read-http.mts`
 * itself. The CLI wires `runReadQuery` (GET-only; see that module) into
 * `RunQuery` — there is no path from this file to a POST request.
 *
 * It also never reads or reports a private field's *value* — only whether
 * one is present. `SENSITIVE_MEDIA_METADATA_FIELDS` below is the audit's own
 * policy for which `media` document fields count as private/internal; the
 * page query only ever asks GROQ for `defined(<field>)`, a boolean, never
 * the field itself.
 */

import type { ReadQueryRequest } from "./sanity-read-http.mts";

/** One request/response round trip per page. Kept well under Sanity's documented 1,000-attribute-per-document ceiling and the 11 KB GET budget even with this row shape. */
export const AUDIT_PAGE_SIZE = 200;

/**
 * Slack beyond `ceil(expectedTotal / pageSize)` pages. At least 1 is
 * required to observe the confirming short/empty page after an exact
 * multiple of `pageSize` documents (200 documents at a page size of 200 is
 * two full pages, and a third, empty page is what proves there is no
 * third page of real data) — the rest is headroom for a few documents
 * legitimately added while the scan runs, before this is treated as a
 * pagination defect rather than ordinary drift.
 */
const AUDIT_PAGE_SAFETY_MARGIN = 3;

/**
 * The `sanity/schemas/media.ts` fields this audit treats as private/internal
 * and never reports a value for — only presence. This constant is the
 * audit's own authoritative policy, restated here rather than derived from
 * the schema (which has no per-field "private" marker to read); the
 * schema's own module comment documents why each one is excluded from the
 * public projection. Whoever adds a new non-public field to that document
 * type must add it here too — `scripts/sanity-audit.test.mts` pins today's
 * set against the schema's declared field names as a reminder, but cannot
 * detect a *new* field on its own.
 */
export const SENSITIVE_MEDIA_METADATA_FIELDS = ["archiveLocator", "capturedAt"] as const;

const IMAGE_ASSET_TYPE = "sanity.imageAsset";
const FILE_ASSET_TYPE = "sanity.fileAsset";
const RELEASE_RECORD_TYPE = "system.release";
/** Restated from `sanity-seed-fixtures.mts`'s own `MEDIA_TYPE_NAME`, matching this codebase's established `scripts/` ↔ `sanity/schemas/` restate-don't-import convention. */
const MEDIA_TYPE = "media";

export class AuditConfigurationError extends Error {
  constructor(message: string) {
    super(`[sanity-audit] ${message}`);
    this.name = "AuditConfigurationError";
  }
}

/** A response shape this audit did not expect — a malformed row, a non-array page, or a non-numeric count. Never a false empty result. */
export class AuditQueryError extends Error {
  constructor(message: string) {
    super(`[sanity-audit] ${message}`);
    this.name = "AuditQueryError";
  }
}

/** The scanned dataset changed while this audit was running, so its report cannot be trusted as a single consistent snapshot. */
export class AuditConsistencyError extends Error {
  constructor(message: string) {
    super(`[sanity-audit] ${message}`);
    this.name = "AuditConsistencyError";
  }
}

// ---------------------------------------------------------------------------
// Configuration resolution — fails closed on missing or ambiguous input
// ---------------------------------------------------------------------------

/**
 * Resolves one target-identifying setting (project id, dataset, or API
 * version) from a CLI flag and/or an environment variable. Missing from
 * both is refused; present in both but disagreeing is refused as ambiguous
 * rather than silently preferring one — this is deliberately stricter than
 * `scripts/seed-sanity-content.mts`'s own flag-wins convention, because a
 * launch-facing audit tool should never guess which of two conflicting
 * targets an operator meant. Values are trimmed before comparison, so
 * incidental whitespace never counts as a real disagreement; a
 * whitespace-only value counts as absent, not present.
 */
export function resolveAuditSetting(input: {
  readonly envName: string;
  readonly flagName: string;
  readonly flagValue: string | undefined;
  readonly envValue: string | undefined;
}): string {
  const flag = input.flagValue?.trim();
  const env = input.envValue?.trim();
  const flagPresent = flag !== undefined && flag.length > 0;
  const envPresent = env !== undefined && env.length > 0;

  if (!flagPresent && !envPresent) {
    throw new AuditConfigurationError(
      `Missing ${input.envName}: pass --${input.flagName} <value> or set the ${input.envName} environment variable`,
    );
  }
  if (flagPresent && envPresent && flag !== env) {
    throw new AuditConfigurationError(
      `Ambiguous ${input.envName}: --${input.flagName} ("${flag}") and the ${input.envName} environment variable ("${env}") disagree. Set only one, or make them match.`,
    );
  }
  return (flagPresent ? flag : env) as string;
}

// ---------------------------------------------------------------------------
// Document identity classification
// ---------------------------------------------------------------------------

export type DocumentIdentity =
  | { readonly kind: "published"; readonly publishedId: string }
  | { readonly kind: "draft"; readonly publishedId: string }
  | { readonly kind: "release-version"; readonly publishedId: string; readonly releaseId: string };

/**
 * Restates `sanity/schemas/validation.ts`'s `publishedIdOf`, extended to
 * also report which of the three id shapes was seen (that file only ever
 * needed the published identity itself). Restated rather than imported,
 * matching this codebase's established `scripts/` ↔ `sanity/schemas/`
 * convention (see e.g. `sanity-seed-fixtures.mts`'s own `MEDIA_TYPE_NAME`).
 */
export function classifySanityDocumentId(id: string): DocumentIdentity {
  if (id.startsWith("drafts.")) {
    return { kind: "draft", publishedId: id.slice("drafts.".length) };
  }
  if (id.startsWith("versions.")) {
    const withoutPrefix = id.slice("versions.".length);
    const separator = withoutPrefix.indexOf(".");
    const releaseId = separator === -1 ? withoutPrefix : withoutPrefix.slice(0, separator);
    const publishedId = separator === -1 ? withoutPrefix : withoutPrefix.slice(separator + 1);
    return { kind: "release-version", publishedId, releaseId };
  }
  return { kind: "published", publishedId: id };
}

// ---------------------------------------------------------------------------
// Query construction (pure — returns request shapes, issues no request)
// ---------------------------------------------------------------------------

export function buildAuditSnapshotCountQuery(): ReadQueryRequest {
  return { query: "count(*[])", perspective: "raw" };
}

export function buildAuditPageQuery(after: string | undefined, pageSize: number): ReadQueryRequest {
  const source = after === undefined ? "*[]" : "*[_id > $after]";
  return {
    query: `${source} | order(_id) [0...$limit] {
      _id,
      _type,
      "hasOriginalFilename": defined(originalFilename),
      "width": metadata.dimensions.width,
      "height": metadata.dimensions.height,
      "hasArchiveLocator": defined(archiveLocator),
      "hasCapturedAt": defined(capturedAt)
    }`,
    params: after === undefined ? { limit: pageSize } : { after, limit: pageSize },
    perspective: "raw",
  };
}

// ---------------------------------------------------------------------------
// Response shape validation
// ---------------------------------------------------------------------------

function parseCount(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new AuditQueryError(
      `Expected ${context} to be a non-negative integer, received ${JSON.stringify(value)}`,
    );
  }
  return value;
}

export type AuditRawRow = {
  readonly _id: string;
  readonly _type: string;
  readonly hasOriginalFilename: boolean;
  readonly width: number | null;
  readonly height: number | null;
  readonly hasArchiveLocator: boolean;
  readonly hasCapturedAt: boolean;
};

function requireBoolean(value: unknown, field: string, context: string): boolean {
  if (typeof value !== "boolean") {
    throw new AuditQueryError(`Expected ${context}.${field} to be a boolean, received ${JSON.stringify(value)}`);
  }
  return value;
}

function requireNumberOrNull(value: unknown, field: string, context: string): number | null {
  if (value !== null && typeof value !== "number") {
    throw new AuditQueryError(`Expected ${context}.${field} to be a number or null, received ${JSON.stringify(value)}`);
  }
  return value;
}

function parseAuditRawRow(value: unknown, context: string): AuditRawRow {
  if (typeof value !== "object" || value === null) {
    throw new AuditQueryError(`Expected ${context} to be an object, received ${JSON.stringify(value)}`);
  }
  const row = value as Record<string, unknown>;
  const { _id, _type } = row;
  if (typeof _id !== "string" || _id.length === 0) {
    throw new AuditQueryError(`Expected ${context}._id to be a non-empty string, received ${JSON.stringify(_id)}`);
  }
  if (typeof _type !== "string" || _type.length === 0) {
    throw new AuditQueryError(`Expected ${context}._type to be a non-empty string, received ${JSON.stringify(_type)}`);
  }
  return {
    _id,
    _type,
    hasOriginalFilename: requireBoolean(row.hasOriginalFilename, "hasOriginalFilename", context),
    width: requireNumberOrNull(row.width, "width", context),
    height: requireNumberOrNull(row.height, "height", context),
    hasArchiveLocator: requireBoolean(row.hasArchiveLocator, "hasArchiveLocator", context),
    hasCapturedAt: requireBoolean(row.hasCapturedAt, "hasCapturedAt", context),
  };
}

function parseAuditPage(value: unknown): readonly AuditRawRow[] {
  if (!Array.isArray(value)) {
    throw new AuditQueryError(`Expected a page of documents to be an array, received ${JSON.stringify(value)}`);
  }
  return value.map((item, index) => parseAuditRawRow(item, `row ${index}`));
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export type RunQuery = (request: ReadQueryRequest) => Promise<unknown>;

/** One row of the "every document" inventory AC2 asks for — published, draft, or a version copied into a content release. */
export type AuditDocumentEntry = {
  readonly id: string;
  readonly type: string;
  readonly kind: "published" | "draft" | "release-version";
  readonly releaseId?: string;
};

/** One row of the "every image/file asset" inventory. `hasOriginalFilename` is presence-only — see this module's doc comment. */
export type AuditAssetEntry = {
  readonly id: string;
  readonly type: typeof IMAGE_ASSET_TYPE | typeof FILE_ASSET_TYPE;
  readonly width: number | null;
  readonly height: number | null;
  readonly hasOriginalFilename: boolean;
};

/** One `media` document that carries at least one of `SENSITIVE_MEDIA_METADATA_FIELDS` — presence-only, never a value. */
export type AuditMediaMetadataEntry = {
  readonly id: string;
  readonly hasArchiveLocator: boolean;
  readonly hasCapturedAt: boolean;
};

export type ContentAuditReport = {
  readonly totalDocuments: number;
  readonly documents: readonly AuditDocumentEntry[];
  readonly assets: readonly AuditAssetEntry[];
  readonly mediaMetadata: readonly AuditMediaMetadataEntry[];
  readonly documentTypeCounts: ReadonlyMap<string, number>;
  readonly pageCount: number;
};

/**
 * Runs the full audit scan and returns a report. Throws `AuditQueryError`
 * for any malformed response and `AuditConsistencyError` if pagination
 * cannot be trusted (see this module's own doc comment) — never returns a
 * report built from a partial or inconsistent read.
 *
 * Every document and every asset the scan sees is retained in full in the
 * returned report (AC2 asks for "every" one, not a sample) — this is a
 * one-off, owner-run CLI tool over a launch-scale dataset (AB#84's own
 * fixture, the scale this tool is sized against, is under 500 documents),
 * so holding a lightweight `{id, type, ...}` tuple per document in memory
 * for the run's duration is not the concern the earlier network-pagination
 * bound (`AUDIT_PAGE_SIZE`, keyset cursors) exists to guard against; that
 * bound is about never issuing one unbounded request, not about how much a
 * single run may accumulate in memory across many bounded ones.
 */
export async function runContentAudit(
  runQuery: RunQuery,
  options?: { readonly pageSize?: number },
): Promise<ContentAuditReport> {
  const pageSize = options?.pageSize ?? AUDIT_PAGE_SIZE;
  if (!Number.isInteger(pageSize) || pageSize <= 0) {
    throw new TypeError(`[sanity-audit] pageSize must be a positive integer, received ${pageSize}`);
  }

  const expectedTotal = parseCount(await runQuery(buildAuditSnapshotCountQuery()), "document count");
  const maxPages = Math.ceil(Math.max(expectedTotal, 1) / pageSize) + AUDIT_PAGE_SAFETY_MARGIN;

  let after: string | undefined;
  let collected = 0;
  let pageCount = 0;

  const documents: AuditDocumentEntry[] = [];
  const assets: AuditAssetEntry[] = [];
  const mediaMetadata: AuditMediaMetadataEntry[] = [];
  const documentTypeCounts = new Map<string, number>();

  let terminated = false;

  while (!terminated) {
    if (pageCount >= maxPages) {
      throw new AuditConsistencyError(
        `Pagination did not terminate within ${maxPages} page(s) (page size ${pageSize}, initial snapshot count ${expectedTotal}). ` +
          "Either the dataset is significantly larger than its own snapshot count, or pagination is not advancing correctly. " +
          "Investigate before trusting any report from this run.",
      );
    }

    const page = parseAuditPage(await runQuery(buildAuditPageQuery(after, pageSize)));
    pageCount += 1;

    if (page.length > pageSize) {
      throw new AuditQueryError(
        `Page ${pageCount} returned ${page.length} rows, more than the requested page size of ${pageSize}`,
      );
    }

    let previousId = after;
    for (const row of page) {
      if (previousId !== undefined && !(row._id > previousId)) {
        throw new AuditQueryError(
          `Pagination did not advance strictly: expected an _id greater than "${previousId}", received "${row._id}"`,
        );
      }
      previousId = row._id;
      collected += 1;

      documentTypeCounts.set(row._type, (documentTypeCounts.get(row._type) ?? 0) + 1);

      const identity = classifySanityDocumentId(row._id);
      documents.push(
        identity.kind === "release-version"
          ? { id: row._id, type: row._type, kind: identity.kind, releaseId: identity.releaseId }
          : { id: row._id, type: row._type, kind: identity.kind },
      );

      // Scoped to the two known asset types: a coincidental `originalFilename`
      // field on an unrelated document type would misreport it as an asset
      // here. An unexpected type is never hidden by this scoping, though —
      // it always shows up in `documentTypeCounts` and `documents` above,
      // which is a complete, dynamic scan over every `_type` regardless.
      if (row._type === IMAGE_ASSET_TYPE || row._type === FILE_ASSET_TYPE) {
        assets.push({
          id: row._id,
          type: row._type,
          width: row.width,
          height: row.height,
          hasOriginalFilename: row.hasOriginalFilename,
        });
      }

      // Scoped to `media` documents specifically, for the same reason.
      if (row._type === MEDIA_TYPE && (row.hasArchiveLocator || row.hasCapturedAt)) {
        mediaMetadata.push({
          id: row._id,
          hasArchiveLocator: row.hasArchiveLocator,
          hasCapturedAt: row.hasCapturedAt,
        });
      }
    }

    if (page.length > 0) after = page[page.length - 1]!._id;
    if (page.length < pageSize) terminated = true;
  }

  // Known, disclosed limitation rather than solved here: this only detects a
  // net change in the document count between the initial snapshot and the
  // completed scan. A delete and an unrelated insert landing during the same
  // scan window, leaving the total count unchanged, is not detectable from a
  // count alone — closing that would mean a second full identity-comparing
  // scan, doubling this tool's read cost, to guard against a coincidence a
  // manual, owner-run audit against a quiet dataset (see
  // docs/sanity-seeding.md's "Content audit" section) is not expected to hit
  // in practice. What this check does catch — any net growth or shrinkage —
  // is the far more likely failure mode.
  if (collected !== expectedTotal) {
    throw new AuditConsistencyError(
      `Collected ${collected} document(s), but the initial snapshot reported ${expectedTotal}. ` +
        "The dataset most likely changed while this audit was running (a document was created or deleted mid-scan). " +
        "Re-run the audit against a quiet dataset before trusting its report.",
    );
  }

  return { totalDocuments: collected, documents, assets, mediaMetadata, documentTypeCounts, pageCount };
}

// ---------------------------------------------------------------------------
// Report formatting — counts, ids, dimensions, and booleans only. Never a
// field value from SENSITIVE_MEDIA_METADATA_FIELDS or an asset filename.
//
// Every document and every asset the scan saw is listed individually, not
// just counted or sampled: AC2 asks this tool to report on "every"
// published document, draft, release version, and image/file asset, which
// an aggregate count alone cannot answer for the operator question this
// tool exists to inform — "is any of this actually approved launch
// content?" cannot be checked against a number.
// ---------------------------------------------------------------------------

function formatDocumentEntry(entry: AuditDocumentEntry): string {
  const suffix = entry.kind === "release-version" ? ` (release: ${entry.releaseId})` : "";
  return `  ${entry.id}  [${entry.type}]  ${entry.kind}${suffix}`;
}

function formatAssetEntry(entry: AuditAssetEntry): string {
  // A file asset legitimately has no image dimensions (see the same
  // distinction in `runContentAudit`'s asset handling above) — only a
  // missing dimension on an image asset is a defect worth flagging.
  const hasMissingDimension = entry.width === null || entry.height === null;
  const dimensions =
    entry.type === FILE_ASSET_TYPE
      ? "n/a (file asset)"
      : hasMissingDimension
        ? "MISSING DIMENSIONS"
        : `${entry.width}x${entry.height}`;
  const filename = entry.hasOriginalFilename ? "yes" : "no";
  return `  ${entry.id}  [${entry.type}]  ${dimensions}  storedFilename:${filename}`;
}

export function formatContentAuditReport(report: ContentAuditReport): string {
  const published = report.documents.filter((entry) => entry.kind === "published");
  const drafts = report.documents.filter((entry) => entry.kind === "draft");
  const releaseVersions = report.documents.filter((entry) => entry.kind === "release-version");
  const releaseRecordCount = report.documentTypeCounts.get(RELEASE_RECORD_TYPE) ?? 0;
  const imageAssets = report.assets.filter((entry) => entry.type === IMAGE_ASSET_TYPE);
  const fileAssets = report.assets.filter((entry) => entry.type === FILE_ASSET_TYPE);
  const assetsMissingDimensions = imageAssets.filter((entry) => entry.width === null || entry.height === null);
  const assetsWithStoredFilename = report.assets.filter((entry) => entry.hasOriginalFilename);

  const lines: string[] = [];
  lines.push(`Documents scanned: ${report.totalDocuments} (across ${report.pageCount} page(s))`);
  lines.push(
    `  published: ${published.length}  drafts: ${drafts.length}  release versions: ${releaseVersions.length}  release records (${RELEASE_RECORD_TYPE}): ${releaseRecordCount}`,
  );
  lines.push("By type:");
  for (const [type, count] of [...report.documentTypeCounts].sort(([left], [right]) => left.localeCompare(right))) {
    lines.push(`  ${type}: ${count}`);
  }

  lines.push("");
  lines.push(`Documents (${report.documents.length}):`);
  for (const entry of [...report.documents].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(formatDocumentEntry(entry));
  }

  lines.push("");
  lines.push(
    `Assets (${report.assets.length} total: ${imageAssets.length} image, ${fileAssets.length} file):`,
  );
  for (const entry of [...report.assets].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(formatAssetEntry(entry));
  }
  lines.push(
    `Image assets missing public derivative dimensions: ${assetsMissingDimensions.length}` +
      (assetsMissingDimensions.length > 0
        ? ` (${assetsMissingDimensions.map((entry) => entry.id).join(", ")})`
        : ""),
  );
  lines.push(
    `Assets with a stored original filename (policy: should be 0 — see sanity/schemas/media.ts): ${assetsWithStoredFilename.length}` +
      (assetsWithStoredFilename.length > 0
        ? ` (${assetsWithStoredFilename.map((entry) => entry.id).join(", ")})`
        : ""),
  );

  lines.push("");
  lines.push(
    `Media documents carrying private/internal metadata (${report.mediaMetadata.length} — presence only, values never reported):`,
  );
  for (const entry of [...report.mediaMetadata].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(`  ${entry.id}  archiveLocator:${entry.hasArchiveLocator ? "yes" : "no"}  capturedAt:${entry.hasCapturedAt ? "yes" : "no"}`);
  }

  return lines.join("\n");
}
