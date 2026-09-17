#!/usr/bin/env node
/**
 * AB#137's owner-run write command: turns an already-approved, non-writable
 * `ImportPlan` (produced by `npm run convert:joomla -- --plan`) into real Sanity
 * documents — the one remaining agent-buildable slice of AB#137, everything else being
 * owner-run (the manifest approval, the baseline export, the temporary credential, the
 * Production run itself, the post-write audit, and credential revocation).
 *
 *   npm run write:joomla -- --plan <import-plan.json> --image-root <dir> --out <report-dir> [--yes]
 *
 * Dry-run by default, matching `seed-sanity-content.mts`'s own established guarantee:
 * without `--yes`, this command makes **no network request at all**, not even a read —
 * every step it takes is local filesystem and CPU only, so an operator can validate a
 * plan's assets are readable and decodable before ever minting a write-scoped
 * credential.
 *
 * ## What this tool resolves that the plan could not, offline
 *
 * `ImportPlan.documents` carries two kinds of placeholder reference, deliberately
 * unresolved by the offline conversion half: `migrated-pending-asset:<mediaId>` (needs
 * a real Sanity asset, which needs actual pixels) and
 * `migrated-pending-category:<categoryId>` (needs the target dataset's real category
 * document id). This tool resolves both, substitutes them in place, and writes the
 * result — see `docs/sanity-seeding.md`'s "Migrating approved content" section for the
 * full runbook.
 *
 * ## Never trusts the plan file blindly
 *
 * A plan is a JSON artifact that may be read long after it was produced, against a
 * separately-minted credential, possibly after the source files it names have moved or
 * changed. This tool re-validates the plan's own shape and every document invariant
 * `validateMigrationDocuments` already checks, re-hashes every photograph's bytes
 * immediately before uploading them (never trusting the plan's own recorded hash
 * without re-deriving it), and runs a target-dataset collision preflight before writing
 * anything — API writes bypass every Studio uniqueness rule a customer's own Studio
 * would otherwise enforce.
 *
 * ## Privacy
 *
 * A verification failure, an unresolved category, or a collision can name a private
 * source locator, a route, or a document id. That detail is written only into the
 * operator's report directory, never to the console — this project's own runbook is
 * explicit that console output is counts and digests only.
 */

import { readFile, mkdir, chmod, writeFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

import {
  parseSeedConnection,
  runSeedMutationBatches,
  uploadSeedImageAsset,
  runSeedQuery,
  type SeedConnection,
  type SeedQueryRequest,
} from "./sanity-seed-http.mts";
import type { RequestOptions } from "./sanity-read-http.mts";
import { generatePublicDerivative, ImageDerivativeError, type PublicDerivative } from "./joomla-image-derivative.mts";
import {
  IMPORT_PLAN_VERSION,
  PENDING_ASSET_PREFIX,
  PENDING_CATEGORY_PREFIX,
  validateMigrationDocuments,
  writablePlanDigest,
  type AssetRequirement,
  type CategoryRequirement,
  type ImportPlan,
  type PlannedDocument,
} from "./joomla-import-plan.mts";
import { IDENTITY_PATTERN } from "./joomla-import-manifest.mts";
import {
  ARTICLE_TYPE_NAME,
  GALLERY_PLACEMENT_TYPE_NAME,
  MAX_PUBLIC_DELIVERY_DIMENSION,
  MEDIA_TYPE_NAME,
  PUBLIC_DELIVERY_FORMATS,
  publishedIdOf,
} from "./sanity-seed-fixtures.mts";

/** Restates the identically-named, non-exported constant in `joomla-import-plan.mts`. */
const ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME = "articleEndGalleryPlacement";

function fail(message: string): never {
  console.error(`Joomla write failed: ${message}`);
  process.exit(1);
}

/**
 * Writes a private-migration-material file `0600`, not the umask-dependent default
 * `writeFile` would give it — the same helper `convert-joomla-content.mts` defines for
 * itself, duplicated rather than shared, matching this project's existing per-script
 * convention (a three-line helper does not earn a shared module).
 */
async function writePrivateFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function writeReport(outDir: string, filename: string, data: unknown): Promise<string> {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  const filePath = path.join(outDir, filename);
  await writePrivateFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
  return filePath;
}

// ---------------------------------------------------------------------------
// Reference-aware document tree walking — shared by plan-contract validation
// (collecting which pending references exist) and substitution (replacing them).
// ---------------------------------------------------------------------------

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReferenceObject(value: unknown): value is { readonly _type: "reference"; readonly _ref: string } {
  return isPlainObject(value) && value._type === "reference" && typeof value._ref === "string";
}

/** Visits every reference-shaped object (`{_type: "reference", _ref: string}`) in a document tree, read-only. */
function walkReferences(value: unknown, visit: (ref: { readonly _ref: string }) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkReferences(item, visit);
    return;
  }
  if (!isPlainObject(value)) return;
  if (isReferenceObject(value)) {
    visit(value);
    return; // a reference object's own fields need no further descent
  }
  for (const item of Object.values(value)) walkReferences(item, visit);
}

/**
 * Rebuilds a document tree, replacing only the `_ref` string of an actual
 * reference-shaped value whose target `resolve` recognizes — `{_type: "reference",
 * _ref: "..."}` stays exactly that shape, with only its `_ref` updated. An earlier
 * draft of this tool replaced a whole matched reference with `{_ref: resolvedId}`,
 * which would have nested a `_ref` string inside what must stay a `{_type:
 * "reference", ...}` object (found during AB#137 write-half plan review, Codex round
 * 1, finding 2).
 */
function substituteReferences(value: unknown, resolve: (ref: string) => string | undefined): unknown {
  if (Array.isArray(value)) return value.map((item) => substituteReferences(item, resolve));
  if (!isPlainObject(value)) return value;
  if (isReferenceObject(value)) {
    const resolved = resolve(value._ref);
    return resolved === undefined ? value : { ...value, _ref: resolved };
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) result[key] = substituteReferences(item, resolve);
  return result;
}

function collectPendingReferenceIds(documents: readonly PlannedDocument[], prefix: string): ReadonlySet<string> {
  const ids = new Set<string>();
  for (const document of documents) {
    walkReferences(document, (ref) => {
      if (ref._ref.startsWith(prefix)) ids.add(ref._ref.slice(prefix.length));
    });
  }
  return ids;
}

export function substitutePendingReferences(
  documents: readonly PlannedDocument[],
  assetIdByMediaId: ReadonlyMap<string, string>,
  categoryDocIdByCategoryId: ReadonlyMap<string, string>,
): readonly PlannedDocument[] {
  return documents.map(
    (document) =>
      substituteReferences(document, (ref) => {
        if (ref.startsWith(PENDING_ASSET_PREFIX)) return assetIdByMediaId.get(ref.slice(PENDING_ASSET_PREFIX.length));
        if (ref.startsWith(PENDING_CATEGORY_PREFIX)) return categoryDocIdByCategoryId.get(ref.slice(PENDING_CATEGORY_PREFIX.length));
        return undefined;
      }) as PlannedDocument,
  );
}

/**
 * The final, independent check before a byte is written: this must be structurally
 * impossible given a successful substitution, but a write step is exactly the wrong
 * place to trust "should be impossible" without checking — the failure mode is a live
 * broken reference in the published dataset.
 *
 * Walks only actual `_ref` values via `walkReferences`, the same reference-aware
 * traversal substitution itself uses — not a blind `JSON.stringify(documents)` string
 * search. An earlier version of this check searched the whole serialized document
 * tree, so ordinary authored text that happened to *contain* the literal string
 * `migrated-pending-asset:` (an article's own title or body, however unlikely) would
 * trip a false-positive refusal — reached *after* every asset for this run had already
 * been uploaded (step 6 runs before this check), leaving those uploads orphaned with no
 * document ever written for them and no way to retry without re-uploading (Codex round
 * 8, finding "Restrict the pending-marker scan to reference fields").
 */
export function assertNoPendingReferencesRemain(documents: readonly PlannedDocument[]): void {
  for (const document of documents) {
    walkReferences(document, (ref) => {
      if (ref._ref.startsWith(PENDING_ASSET_PREFIX) || ref._ref.startsWith(PENDING_CATEGORY_PREFIX)) {
        throw new Error(`a pending reference remains unresolved after substitution — refusing to write (document "${document._id}")`);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Plan-contract validation — the plan's own shape, not just its documents
// (Codex round 1, finding 2). Never trusts a file blindly, regardless of how it
// claims to have been produced.
// ---------------------------------------------------------------------------

const CONTENT_HASH_PATTERN = /^[0-9a-f]{64}$/u;

// ---------------------------------------------------------------------------
// Nested-shape validation (Codex round 4, finding "Validate nested plan
// structures before writing"): the top-level field allow-list closes an
// injected field on a document itself, but `body`, `alt`, `canonicalCategory`,
// `secondaryCategories`, `article`, and `media` are all nested object/array
// structures of their own, and `validateMigrationDocuments` only ever checks
// the specific fields it cares about within them, never rejecting an
// unexpected extra one. These allow-lists are exactly what
// `joomla-html-conversion.mts` and `joomla-import-plan.mts` themselves ever
// emit for each shape — verified against their actual `push`/object-literal
// call sites, not assumed.
// ---------------------------------------------------------------------------

const REFERENCE_FIELDS = new Set(["_type", "_ref", "_key"]);
const LOCALIZED_TEXT_FIELDS = new Set(["_key", "_type", "language", "value"]);
const IMAGE_FIELDS = new Set(["_type", "asset"]);
const GALLERY_IMAGE_ITEM_FIELDS = new Set(["_key", "media"]);
const TABLE_ROW_FIELDS = new Set(["_key", "cells"]);

/** Every content-block `_type` this converter emits, and exactly the fields each one carries. */
const BLOCK_FIELD_SCHEMAS: Readonly<Record<string, ReadonlySet<string>>> = {
  contentParagraphBlock: new Set(["_key", "_type", "text"]),
  contentHeadingBlock: new Set(["_key", "_type", "level", "text"]),
  contentQuoteBlock: new Set(["_key", "_type", "text"]),
  contentListBlock: new Set(["_key", "_type", "ordered", "items"]),
  contentYoutubeBlock: new Set(["_key", "_type", "videoId", "title"]),
  contentMediaBlock: new Set(["_key", "_type", "media"]),
  contentGalleryBlock: new Set(["_key", "_type", "title", "images"]),
  contentTableBlock: new Set(["_key", "_type", "caption", "headers", "rows"]),
};

function checkFieldSet(value: Record<string, unknown>, allowed: ReadonlySet<string>, path: string, issues: string[]): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) issues.push(`${path} has an unrecognized field "${key}"`);
  }
}

/**
 * `validateRef`, when given, checks the *semantic* content of `_ref` — not just its
 * shape — and returns an issue suffix (appended after `<path>._ref `) or `undefined`
 * if it is fine. Closes a gap the shape check alone cannot: a global "every pending
 * asset id has a matching requirement" check (in `validatePlanContract`'s
 * correspondence pass) cannot tell a reference used in its *correct* position from
 * one misplaced into the wrong field — a pending asset marker sitting in
 * `canonicalCategory`, or media Y's `image.asset` pointing at pending asset X's
 * placeholder instead of its own — since both are still, globally, "a pending
 * reference this plan's requirements cover" (Codex round 5, finding "Constrain
 * pending references to their expected fields").
 */
function checkReferenceShape(value: unknown, path: string, issues: string[], validateRef?: (ref: string) => string | undefined): void {
  if (value === undefined) return;
  if (!isPlainObject(value)) {
    issues.push(`${path} is not a reference object`);
    return;
  }
  checkFieldSet(value, REFERENCE_FIELDS, path, issues);
  // The field-set check above only rejects an *unexpected extra* key — it says
  // nothing about `_type`/`_ref` actually being present with the right shape.
  // Sanity treats an object with a valid-looking `_ref` but a missing or wrong
  // `_type` as not a reference at all, so dereferencing it reads back `null` —
  // silently breaking the imported article or placement rather than failing loudly
  // (Codex round 9, finding "Require actual Sanity reference objects").
  if (value._type !== "reference") {
    issues.push(`${path}._type must be "reference"`);
  }
  if (typeof value._ref !== "string" || value._ref.length === 0) {
    issues.push(`${path}._ref must be a non-empty string`);
  } else if (validateRef !== undefined) {
    const problem = validateRef(value._ref);
    if (problem !== undefined) issues.push(`${path}._ref ${problem}`);
  }
}

/** A reference that must already be a real, resolved id — never a pending marker of either kind. */
function expectResolvedRef(ref: string): string | undefined {
  if (ref.startsWith(PENDING_ASSET_PREFIX) || ref.startsWith(PENDING_CATEGORY_PREFIX)) {
    return `should already be a resolved reference but is a pending marker ("${ref}")`;
  }
  return undefined;
}

/** A category reference must be a pending *category* marker specifically — never a pending asset marker, and never already resolved (this tool always builds a fresh plan with pending category markers). */
function expectPendingCategoryRef(ref: string): string | undefined {
  return ref.startsWith(PENDING_CATEGORY_PREFIX) ? undefined : `should be a pending category reference but is "${ref}"`;
}

function checkBlockShape(block: unknown, path: string, issues: string[]): void {
  if (!isPlainObject(block) || typeof block._type !== "string") {
    issues.push(`${path} is not a well-formed content block`);
    return;
  }
  const schema = BLOCK_FIELD_SCHEMAS[block._type];
  if (schema === undefined) {
    issues.push(`${path} has an unrecognized block _type "${block._type}"`);
    return;
  }
  checkFieldSet(block, schema, path, issues);
  if (block._type === "contentMediaBlock") checkReferenceShape(block.media, `${path}.media`, issues, expectResolvedRef);
  if (block._type === "contentGalleryBlock" && Array.isArray(block.images)) {
    block.images.forEach((image: unknown, index: number) => {
      if (!isPlainObject(image)) {
        issues.push(`${path}.images[${index}] is not an object`);
        return;
      }
      checkFieldSet(image, GALLERY_IMAGE_ITEM_FIELDS, `${path}.images[${index}]`, issues);
      checkReferenceShape(image.media, `${path}.images[${index}].media`, issues, expectResolvedRef);
    });
  }
  if (block._type === "contentTableBlock" && Array.isArray(block.rows)) {
    block.rows.forEach((row: unknown, index: number) => {
      if (!isPlainObject(row)) {
        issues.push(`${path}.rows[${index}] is not an object`);
        return;
      }
      checkFieldSet(row, TABLE_ROW_FIELDS, `${path}.rows[${index}]`, issues);
    });
  }
}

/**
 * Required-field presence and type, restricted to fields `validateMigrationDocuments`
 * itself never checks (Codex round 5, finding "Reject malformed required document
 * fields") — everything else (`mediaId`, `mediaType`, `alt`, `slug`,
 * `canonicalCategory`, `publishedAt`/`eventDate`, `order`, `placementId`, the body's
 * non-empty-array requirement) is already covered there and not repeated here.
 */
function checkRequiredFieldTypes(document: Record<string, unknown>, path: string, issues: string[]): void {
  if (document._type === ARTICLE_TYPE_NAME) {
    if (typeof document.title !== "string" || document.title.trim().length === 0) {
      issues.push(`${path}.title is required and must be a non-empty string`);
    }
    if (typeof document.language !== "string" || document.language.trim().length === 0) {
      issues.push(`${path}.language is required and must be a non-empty string`);
    }
    if (!IDENTITY_PATTERN.test(String(document.contentId))) {
      issues.push(`${path}.contentId "${String(document.contentId)}" is not a valid identity`);
    }
  }
  if (document._type === ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME) {
    if (typeof document.visible !== "boolean") issues.push(`${path}.visible is required and must be a boolean`);
  }
}

function checkNestedDocumentShapes(document: Record<string, unknown>, path: string, issues: string[]): void {
  if (document._type === MEDIA_TYPE_NAME) {
    if (isPlainObject(document.image)) {
      checkFieldSet(document.image, IMAGE_FIELDS, `${path}.image`, issues);
      const ownMediaId = typeof document.mediaId === "string" ? document.mediaId : undefined;
      checkReferenceShape(document.image.asset, `${path}.image.asset`, issues, (ref) => {
        const expected = ownMediaId === undefined ? undefined : `${PENDING_ASSET_PREFIX}${ownMediaId}`;
        return expected !== undefined && ref !== expected
          ? `should reference this document's own photograph ("${expected}") but is "${ref}"`
          : undefined;
      });
    }
    if (Array.isArray(document.alt)) {
      document.alt.forEach((entry: unknown, index: number) => {
        if (!isPlainObject(entry)) {
          issues.push(`${path}.alt[${index}] is not an object`);
          return;
        }
        checkFieldSet(entry, LOCALIZED_TEXT_FIELDS, `${path}.alt[${index}]`, issues);
      });
    }
  }
  if (document._type === ARTICLE_TYPE_NAME) {
    checkReferenceShape(document.canonicalCategory, `${path}.canonicalCategory`, issues, expectPendingCategoryRef);
    if (Array.isArray(document.secondaryCategories)) {
      document.secondaryCategories.forEach((entry: unknown, index: number) =>
        checkReferenceShape(entry, `${path}.secondaryCategories[${index}]`, issues, expectPendingCategoryRef),
      );
    }
    if (Array.isArray(document.body)) {
      document.body.forEach((block: unknown, index: number) => checkBlockShape(block, `${path}.body[${index}]`, issues));
    }
  }
  if (document._type === ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME) {
    checkReferenceShape(document.article, `${path}.article`, issues, expectResolvedRef);
    checkReferenceShape(document.media, `${path}.media`, issues, expectResolvedRef);
  }
  checkRequiredFieldTypes(document, path, issues);
}

export function validatePlanContract(raw: unknown): { readonly issues: readonly string[]; readonly plan: ImportPlan | undefined } {
  if (!isPlainObject(raw)) return { issues: ["the plan file's top level is not a JSON object"], plan: undefined };

  const issues: string[] = [];
  if (raw.version !== IMPORT_PLAN_VERSION) {
    issues.push(
      `the plan's version is "${String(raw.version)}", but this tool requires "${IMPORT_PLAN_VERSION}" — regenerate the plan with the current convert:joomla`,
    );
  }
  if (!Array.isArray(raw.documents)) issues.push("plan.documents is not an array");
  if (!Array.isArray(raw.assetRequirements)) issues.push("plan.assetRequirements is not an array");
  if (!Array.isArray(raw.categoryRequirements)) issues.push("plan.categoryRequirements is not an array");
  if (!Array.isArray(raw.errors)) issues.push("plan.errors is not an array");
  if (!Array.isArray(raw.blocked)) issues.push("plan.blocked is not an array");
  if (issues.length > 0) return { issues, plan: undefined };

  // Every document's own `_id`/`_type` shape, that `_type` is one this tool actually
  // knows how to write, and that it carries no field this tool itself never emits —
  // `validateMigrationDocuments` dispatches on exact `_type` string matches with no
  // `else` branch (so an unrecognized type would silently skip every type-specific
  // check) and only ever checks the fields it cares about, never rejecting an extra
  // one — Sanity's mutate API has no schema of its own to reject one either, so a
  // corrupted or hand-edited plan carrying an added field (a private `archiveLocator`
  // slipped onto an `article`, say) would be written into a public dataset verbatim
  // and become directly queryable there (Codex round 1, finding "Reject unsupported
  // document types before writing"; widened after Codex round 3, finding "Reject
  // unknown fields before writing plan documents"). The allow-lists below are exactly
  // what `buildImportPlan` itself emits for each type — not what the Sanity schema
  // additionally allows, since anything this tool adds later (the cross-phase media
  // field merge, substitution) runs after this check, on documents already known good.
  const FIELD_ALLOW_LISTS: Readonly<Record<string, ReadonlySet<string>>> = {
    [MEDIA_TYPE_NAME]: new Set(["_id", "_type", "mediaId", "mediaType", "alt", "publiclyRenderable", "image"]),
    [ARTICLE_TYPE_NAME]: new Set([
      "_id",
      "_type",
      "contentId",
      "language",
      "title",
      "slug",
      "summary",
      "author",
      "endGalleryId",
      "publishedAt",
      "eventDate",
      "tags",
      "canonicalCategory",
      "secondaryCategories",
      "body",
    ]),
    [ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME]: new Set(["_id", "_type", "placementId", "order", "visible", "article", "media"]),
  };
  for (const [index, entry] of (raw.documents as readonly unknown[]).entries()) {
    if (!isPlainObject(entry) || typeof entry._id !== "string" || typeof entry._type !== "string") {
      issues.push(`documents[${index}] is missing a string _id or _type`);
      continue;
    }
    const allowList = FIELD_ALLOW_LISTS[entry._type];
    if (allowList === undefined) {
      issues.push(
        `documents[${index}] has an unrecognized _type "${entry._type}" — this tool only writes ${Object.keys(FIELD_ALLOW_LISTS).join(", ")}`,
      );
      continue;
    }
    const unknownFields = Object.keys(entry).filter((key) => !allowList.has(key));
    if (unknownFields.length > 0) {
      issues.push(`documents[${index}] (${entry._type}) has unrecognized field(s): ${unknownFields.join(", ")}`);
      continue;
    }
    // Nested structures — body blocks, references, localized text, gallery images,
    // table rows — are checked too, not only the document's own top-level fields
    // (Codex round 4): an unexpected field could otherwise be smuggled inside any of
    // them and still reach `createOrReplace` unchecked.
    checkNestedDocumentShapes(entry, `documents[${index}]`, issues);
  }
  if (issues.length > 0) return { issues, plan: undefined };

  const documents = raw.documents as readonly PlannedDocument[];
  const rawAssetRequirements = raw.assetRequirements as readonly unknown[];
  const rawCategoryRequirements = raw.categoryRequirements as readonly unknown[];

  const assetRequirements: AssetRequirement[] = [];
  const seenMediaIds = new Set<string>();
  for (const [index, entry] of rawAssetRequirements.entries()) {
    if (
      !isPlainObject(entry) ||
      typeof entry.mediaId !== "string" ||
      typeof entry.sourceLocator !== "string" ||
      typeof entry.contentHash !== "string"
    ) {
      issues.push(`assetRequirements[${index}] is malformed`);
      continue;
    }
    if (!IDENTITY_PATTERN.test(entry.mediaId)) issues.push(`assetRequirements[${index}].mediaId is not a valid identity`);
    if (entry.sourceLocator.trim().length === 0) issues.push(`assetRequirements[${index}].sourceLocator is empty`);
    if (!CONTENT_HASH_PATTERN.test(entry.contentHash)) {
      issues.push(`assetRequirements[${index}].contentHash is not a 64-character lowercase hex string`);
    }
    if (seenMediaIds.has(entry.mediaId)) {
      issues.push(`assetRequirements names "${entry.mediaId}" more than once`);
    } else {
      seenMediaIds.add(entry.mediaId);
      assetRequirements.push({ mediaId: entry.mediaId, sourceLocator: entry.sourceLocator, contentHash: entry.contentHash });
    }
  }

  const categoryRequirements: CategoryRequirement[] = [];
  const seenCategoryIds = new Set<string>();
  for (const [index, entry] of rawCategoryRequirements.entries()) {
    if (!isPlainObject(entry) || typeof entry.categoryId !== "string") {
      issues.push(`categoryRequirements[${index}] is malformed`);
      continue;
    }
    if (seenCategoryIds.has(entry.categoryId)) {
      issues.push(`categoryRequirements names "${entry.categoryId}" more than once`);
    } else {
      seenCategoryIds.add(entry.categoryId);
      categoryRequirements.push({ categoryId: entry.categoryId });
    }
  }

  // Exact correspondence between the requirements arrays and the actual pending
  // references in `documents`: a requirement with no matching reference would
  // upload or query for something nothing needs, and a reference with no matching
  // requirement would leave a placeholder unresolved at write time.
  const referencedMediaIds = collectPendingReferenceIds(documents, PENDING_ASSET_PREFIX);
  const referencedCategoryIds = collectPendingReferenceIds(documents, PENDING_CATEGORY_PREFIX);
  for (const mediaId of referencedMediaIds) {
    if (!seenMediaIds.has(mediaId)) issues.push(`documents reference photograph "${mediaId}" with no matching assetRequirements entry`);
  }
  for (const mediaId of seenMediaIds) {
    if (!referencedMediaIds.has(mediaId)) issues.push(`assetRequirements names photograph "${mediaId}", which no document references`);
  }
  for (const categoryId of referencedCategoryIds) {
    if (!seenCategoryIds.has(categoryId)) issues.push(`documents reference category "${categoryId}" with no matching categoryRequirements entry`);
  }
  for (const categoryId of seenCategoryIds) {
    if (!referencedCategoryIds.has(categoryId)) issues.push(`categoryRequirements names category "${categoryId}", which no document references`);
  }

  if (issues.length > 0) return { issues, plan: undefined };

  return {
    issues: [],
    plan: { ...(raw as unknown as ImportPlan), documents, assetRequirements, categoryRequirements },
  };
}

// ---------------------------------------------------------------------------
// Path containment — reject traversal and symlink escape (Codex round 1, finding 5)
// ---------------------------------------------------------------------------

export async function resolveContainedSourcePath(imageRoot: string, sourceLocator: string): Promise<string> {
  const normalized = path.normalize(sourceLocator);
  if (path.isAbsolute(sourceLocator) || normalized === ".." || normalized.startsWith(`..${path.sep}`)) {
    throw new Error(`source locator "${sourceLocator}" is absolute or escapes the image root`);
  }
  const candidate = path.join(imageRoot, sourceLocator);
  let realRoot: string;
  let realCandidate: string;
  try {
    realRoot = await realpath(imageRoot);
  } catch {
    throw new Error(`image root "${imageRoot}" does not exist`);
  }
  try {
    realCandidate = await realpath(candidate);
  } catch {
    throw new Error(`source file "${sourceLocator}" does not exist`);
  }
  const relative = path.relative(realRoot, realCandidate);
  if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) {
    throw new Error(`source locator "${sourceLocator}" resolves outside the image root (possibly via a symlink)`);
  }
  return realCandidate;
}

// ---------------------------------------------------------------------------
// Per-asset local verification + derivative generation. Reads bytes exactly once;
// the same buffer feeds both the SHA-256 check and the derivative generator, so
// there is no re-read window between "verified" and "used" (Codex round 1, finding 5).
// ---------------------------------------------------------------------------

export type AssetOutcome =
  | { readonly ok: true; readonly mediaId: string; readonly derivative: PublicDerivative }
  | { readonly ok: false; readonly mediaId: string; readonly sourceLocator: string; readonly reason: string };

export async function verifyAndDeriveAsset(imageRoot: string, requirement: AssetRequirement): Promise<AssetOutcome> {
  const { mediaId, sourceLocator, contentHash } = requirement;
  let resolvedPath: string;
  try {
    resolvedPath = await resolveContainedSourcePath(imageRoot, sourceLocator);
  } catch (error) {
    return { ok: false, mediaId, sourceLocator, reason: error instanceof Error ? error.message : String(error) };
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(resolvedPath));
  } catch {
    return { ok: false, mediaId, sourceLocator, reason: "could not read the source file" };
  }

  const actualHash = createHash("sha256").update(bytes).digest("hex");
  if (actualHash !== contentHash.toLowerCase()) {
    return {
      ok: false,
      mediaId,
      sourceLocator,
      reason: `content hash mismatch (expected ${contentHash}, found ${actualHash}) — the file may have changed since approval`,
    };
  }

  try {
    const derivative = await generatePublicDerivative(bytes);
    return { ok: true, mediaId, derivative };
  } catch (error) {
    const reason =
      error instanceof ImageDerivativeError ? `${error.reason}: ${error.message}` : error instanceof Error ? error.message : String(error);
    return { ok: false, mediaId, sourceLocator, reason };
  }
}

// ---------------------------------------------------------------------------
// Byte-budget query-id chunking (Codex round 1, finding 6). `scripts/*.mts` cannot
// import `src/lib/sanity-values.ts`'s own chunker (the `src/lib` boundary), so this
// is a second, small, independently pinned implementation of the same idea —
// conservative, well under `sanity-read-http.mts#MAX_READ_QUERY_URL_BYTES` (11 KiB),
// leaving headroom for the query text and other parameters in the same URL.
// ---------------------------------------------------------------------------

const QUERY_ID_CHUNK_BYTE_BUDGET = 6 * 1024;

/**
 * Measures the exact encoded form the real request builds — `sanity-read-http.mts`'s
 * `buildQueryUrl` sends every param through `encodeURIComponent(JSON.stringify(value))`
 * before checking the assembled URL against its own 11 KiB cap. An earlier version of
 * this chunker measured raw `JSON.stringify` byte length: `encodeURIComponent` expands
 * every JSON quote, comma, and bracket to a three-byte `%XX` escape, so that
 * under-counted the real cost and could pass a chunk through here that then failed
 * `buildQueryUrl`'s own check with "Query too large" (found in Codex review round 6).
 * `src/lib/sanity-values.ts#chunkContentIds` already measures the identical way for the
 * production adapter; `scripts/*.mts` cannot import it (the `src/lib` boundary), so this
 * is a second, small, independently pinned implementation of the same idea.
 */
function encodedIdArrayBytes(ids: readonly string[]): number {
  return new TextEncoder().encode(encodeURIComponent(JSON.stringify(ids))).length;
}

export function chunkIdsByByteBudget(ids: readonly string[]): readonly (readonly string[])[] {
  const chunks: string[][] = [];
  let current: string[] = [];
  for (const id of ids) {
    const candidate = [...current, id];
    if (current.length > 0 && encodedIdArrayBytes(candidate) > QUERY_ID_CHUNK_BYTE_BUDGET) {
      chunks.push(current);
      current = [id];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

// ---------------------------------------------------------------------------
// Category resolution (network, read-only, published perspective — an article must
// bind to a *live* category, not a draft-only one).
// ---------------------------------------------------------------------------

/**
 * Every language that actually needs a category — derived from the plan's own
 * article documents, since a category referenced only by an `en` article does not
 * need an `fi` label/slug. Reference values are still `migrated-pending-category:…`
 * at this point (category resolution runs before substitution), matched the same
 * way `articleCanonicalCategoryDocId` does below.
 */
export function collectRequiredCategoryLanguages(
  documents: readonly PlannedDocument[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const result = new Map<string, Set<string>>();
  const add = (categoryId: string, language: string): void => {
    const set = result.get(categoryId) ?? new Set<string>();
    set.add(language);
    result.set(categoryId, set);
  };
  for (const document of documents) {
    if (document._type !== ARTICLE_TYPE_NAME || typeof document.language !== "string") continue;
    const refs = [document.canonicalCategory, ...(Array.isArray(document.secondaryCategories) ? document.secondaryCategories : [])];
    for (const ref of refs) {
      if (isReferenceObject(ref) && ref._ref.startsWith(PENDING_CATEGORY_PREFIX)) {
        add(ref._ref.slice(PENDING_CATEGORY_PREFIX.length), document.language);
      }
    }
  }
  return result;
}

export type CategoryResolution = {
  readonly resolved: ReadonlyMap<string, string>;
  readonly issues: readonly string[];
};

/**
 * `validateProspectivePlacement` (`content-placement-validation.ts`) refuses a
 * Studio publish whose canonical or secondary category has no published label
 * *and* slug in the document's own language — a category that exists but is not
 * yet localized there is, for that language, the same as not existing. An API
 * write bypasses that guard, so this tool checks it too (Codex round 1, finding
 * "Require localized target categories before resolving"): resolving a category
 * id to a document id alone is not enough — every language actually referencing
 * it must have both fields.
 */
export async function resolveCategoryReferences(
  connection: SeedConnection,
  categoryRequirements: readonly CategoryRequirement[],
  requiredLanguagesByCategoryId: ReadonlyMap<string, ReadonlySet<string>>,
  options?: RequestOptions,
): Promise<CategoryResolution> {
  const ids = categoryRequirements.map((requirement) => requirement.categoryId);
  const resolved = new Map<string, string>();
  const issues: string[] = [];

  function localizedValues(entries: unknown, language: string): string[] {
    if (!Array.isArray(entries)) return [];
    const values: string[] = [];
    for (const entry of entries) {
      if (isPlainObject(entry) && entry.language === language && typeof entry.value === "string") values.push(entry.value);
    }
    return values;
  }

  for (const idsChunk of chunkIdsByByteBudget(ids)) {
    const rows = (await runSeedQuery(
      connection,
      { query: `*[_type == "category" && categoryId in $ids]{_id, categoryId, label, slug}`, params: { ids: idsChunk } },
      options,
    )) as readonly { readonly _id?: unknown; readonly categoryId?: unknown; readonly label?: unknown; readonly slug?: unknown }[];
    for (const row of rows) {
      if (typeof row._id !== "string" || typeof row.categoryId !== "string") continue;
      const existing = resolved.get(row.categoryId);
      if (existing !== undefined && existing !== row._id) {
        issues.push(`category "${row.categoryId}" is ambiguous: both "${existing}" and "${row._id}" claim it`);
        continue;
      }
      const requiredLanguages = requiredLanguagesByCategoryId.get(row.categoryId) ?? new Set<string>();
      // `content-tree.ts` rejects a published category with a blank label or a
      // slug not matching its own `SLUG_PATTERN` (identical to `IDENTITY_PATTERN`
      // — both `/^[a-z0-9]+(?:-[a-z0-9]+)*$/`) the moment any route reads the
      // whole tree — a category *language key present but the value blank or
      // malformed* would pass a presence-only check and still take the whole
      // public tree down the first time a visitor's request builds it, well
      // after this migration already wrote content depending on it (Codex round
      // 8, finding "Validate localized category values, not just language keys").
      const invalidLanguages = [...requiredLanguages].filter((language) => {
        const label = localizedValues(row.label, language)[0];
        const slug = localizedValues(row.slug, language)[0];
        return label === undefined || label.trim().length === 0 || slug === undefined || !IDENTITY_PATTERN.test(slug);
      });
      if (invalidLanguages.length > 0) {
        issues.push(
          `category "${row.categoryId}" has no valid published label and slug in ${invalidLanguages.length === 1 ? "language" : "languages"} "${invalidLanguages.join(", ")}" — an article needs it there`,
        );
        continue;
      }
      resolved.set(row.categoryId, row._id);
    }
  }
  for (const categoryId of ids) {
    if (!resolved.has(categoryId)) issues.push(`category "${categoryId}" was not found, fully and validly localized, in the target dataset's published tree`);
  }
  return { resolved, issues };
}

// ---------------------------------------------------------------------------
// The local-slug-namespace algorithm, restated from `sanity/schemas/content-
// placement-validation.ts` (`article-validation.ts`/`gallery-validation.ts`'s own
// Studio publish guard) — not imported. That file's own `./validation` import has no
// file extension, which Sanity Studio's bundler resolves but plain Node's ESM loader
// does not: `node scripts/write-joomla-content.mts` crashed with `ERR_MODULE_NOT_FOUND`
// on a real subprocess run, even though `tsc --noEmit` and Vitest's own resolver both
// tolerated it — the identical class of "passes under a transpiler, fails for real"
// trap this project has already documented once for a Node native-type-stripping crash
// (AB#116). Restating is the same choice `sanity-seed-fixtures.mts` already makes for
// `publishedIdOf`, for the same reason: `scripts/*.mts` runs under plain Node with no
// bundler and no build step.
//
// This restates the algorithm exactly, not an approximation of it — an earlier version
// of this file's own collision preflight checked only the direct children of the
// categories this plan targets, which `findProspectiveLocalSlugCollision`'s real
// ancestry walk showed was insufficient: migrating content into a previously dormant
// category branch can make that branch, and everything above it up to the root,
// public for the first time, exposing a slug collision anywhere in that ancestry, not
// only immediately beneath the target category (Codex round 7, finding "Check
// collisions for newly public category ancestors").
// ---------------------------------------------------------------------------

type ProspectiveCategoryNode = {
  readonly categoryId: string;
  readonly parentId: string | null;
  readonly slugInLanguage?: string;
};

type ProspectivePlacement = {
  readonly contentId: string;
  readonly slug: string;
  readonly canonicalCategoryId: string | null;
  readonly secondaryCategoryIds: readonly string[];
};

type ProspectivePlacementFields = {
  readonly documentId: string;
  readonly contentId: string;
  readonly language: string;
  readonly slug: string;
  readonly canonicalCategoryId: string | null;
  readonly secondaryCategoryIds: readonly string[];
};

type PublishedPlacementSnapshot = {
  readonly language: string;
  readonly slug: string;
  readonly canonicalCategoryId: string | null;
};

/** See `content-placement-validation.ts`'s identically-named constant. */
const UNRESOLVED_CATEGORY_PREFIX = "unresolved-ref:";

function resolveProspectiveCategoryId(ref: string, categoryIdsByDocumentId: ReadonlyMap<string, string>): string {
  return categoryIdsByDocumentId.get(ref) ?? `${UNRESOLVED_CATEGORY_PREFIX}${ref}`;
}

function readProspectiveLanguageValue(entries: unknown, language: string): string | undefined {
  if (!Array.isArray(entries)) return undefined;
  for (const entry of entries) {
    if (isPlainObject(entry) && entry.language === language && typeof entry.value === "string") return entry.value;
  }
  return undefined;
}

function parseProspectiveCategories(
  rows: readonly Record<string, unknown>[],
  language: string,
): ReadonlyMap<string, ProspectiveCategoryNode> {
  const categoryIdsByDocumentId = new Map<string, string>();
  for (const row of rows) {
    if (typeof row._id === "string" && typeof row.categoryId === "string") categoryIdsByDocumentId.set(row._id, row.categoryId);
  }

  const nodes = new Map<string, ProspectiveCategoryNode>();
  for (const row of rows) {
    if (typeof row.categoryId !== "string") continue;
    const parentRef = typeof row.parentRef === "string" ? row.parentRef : undefined;
    const parentId = parentRef === undefined ? null : resolveProspectiveCategoryId(parentRef, categoryIdsByDocumentId);
    const slugValue = readProspectiveLanguageValue(row.slug, language);
    const hasLabel = readProspectiveLanguageValue(row.label, language) !== undefined;
    nodes.set(row.categoryId, {
      categoryId: row.categoryId,
      parentId,
      ...(slugValue !== undefined && hasLabel ? { slugInLanguage: slugValue } : {}),
    });
  }
  return nodes;
}

function resolveProspectivePublicCategoryIds(
  categories: ReadonlyMap<string, ProspectiveCategoryNode>,
  placements: readonly ProspectivePlacement[],
): ReadonlySet<string> {
  const withContent = new Set<string>();
  for (const placement of placements) {
    if (placement.canonicalCategoryId !== null) withContent.add(placement.canonicalCategoryId);
    for (const categoryId of placement.secondaryCategoryIds) withContent.add(categoryId);
  }
  const isPublic = new Set<string>();
  for (const categoryId of withContent) {
    const visited = new Set<string>();
    let current: string | null = categoryId;
    while (current !== null && !visited.has(current)) {
      visited.add(current);
      isPublic.add(current);
      current = categories.get(current)?.parentId ?? null;
    }
  }
  return isPublic;
}

function prospectiveCategoryAncestryChain(categoryId: string, categories: ReadonlyMap<string, ProspectiveCategoryNode>): readonly string[] {
  const chain: string[] = [];
  const visited = new Set<string>();
  let current: string | null = categoryId;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    chain.push(current);
    current = categories.get(current)?.parentId ?? null;
  }
  return chain;
}

type ProspectiveLocalSlugCollision = {
  readonly conflictingKind: "category" | "content";
  readonly conflictingId: string;
  readonly slug: string;
};

function findProspectiveLocalSlugCollision(
  current: ProspectivePlacementFields,
  categories: ReadonlyMap<string, ProspectiveCategoryNode>,
  publicCategoryIds: ReadonlySet<string>,
  placements: readonly ProspectivePlacement[],
): ProspectiveLocalSlugCollision | undefined {
  type Claim = { readonly kind: "category" | "content"; readonly id: string; readonly slug: string; readonly key: string };
  const claims: Claim[] = [];

  for (const node of categories.values()) {
    if (node.slugInLanguage === undefined || !publicCategoryIds.has(node.categoryId)) continue;
    claims.push({ kind: "category", id: node.categoryId, slug: node.slugInLanguage, key: `${node.parentId ?? ""} ${node.slugInLanguage}` });
  }
  for (const placement of placements) {
    if (placement.canonicalCategoryId === null) continue;
    claims.push({ kind: "content", id: placement.contentId, slug: placement.slug, key: `${placement.canonicalCategoryId} ${placement.slug}` });
  }

  const toCheck: { readonly kind: "category" | "content"; readonly id: string }[] = [{ kind: "content", id: current.contentId }];
  const checkedCategoryIds = new Set<string>();
  for (const categoryId of [...(current.canonicalCategoryId === null ? [] : [current.canonicalCategoryId]), ...current.secondaryCategoryIds]) {
    for (const ancestorId of prospectiveCategoryAncestryChain(categoryId, categories)) {
      if (checkedCategoryIds.has(ancestorId)) continue;
      checkedCategoryIds.add(ancestorId);
      toCheck.push({ kind: "category", id: ancestorId });
    }
  }

  for (const checked of toCheck) {
    const claim = claims.find((candidate) => candidate.kind === checked.kind && candidate.id === checked.id);
    if (claim === undefined) continue;
    const collision = claims.find((candidate) => (candidate.kind !== claim.kind || candidate.id !== claim.id) && candidate.key === claim.key);
    if (collision !== undefined) return { conflictingKind: collision.kind, conflictingId: collision.id, slug: claim.slug };
  }
  return undefined;
}

function changesPublishedUrlFields(published: PublishedPlacementSnapshot, current: PublishedPlacementSnapshot): boolean {
  return published.language !== current.language || published.slug !== current.slug || published.canonicalCategoryId !== current.canonicalCategoryId;
}

// ---------------------------------------------------------------------------
// Target-dataset collision preflight (Codex round 1, finding 4) — API writes bypass
// every Studio uniqueness/route rule, so this tool checks for itself, raw
// perspective (a draft claiming an identity is still a claim on it).
// ---------------------------------------------------------------------------

function articleCanonicalCategoryDocId(
  document: PlannedDocument,
  categoryDocIdByCategoryId: ReadonlyMap<string, string>,
): string | undefined {
  const reference = document.canonicalCategory;
  if (!isReferenceObject(reference)) return undefined;
  if (reference._ref.startsWith(PENDING_CATEGORY_PREFIX)) {
    return categoryDocIdByCategoryId.get(reference._ref.slice(PENDING_CATEGORY_PREFIX.length));
  }
  return reference._ref;
}

export async function runCollisionPreflight(
  connection: SeedConnection,
  documents: readonly PlannedDocument[],
  categoryDocIdByCategoryId: ReadonlyMap<string, string>,
  options?: RequestOptions,
): Promise<{ readonly collisions: readonly string[] }> {
  const plannedIds = new Set(documents.map((document) => document._id));
  const collisions: string[] = [];

  async function runQuery(request: SeedQueryRequest): Promise<readonly Record<string, unknown>[]> {
    const result = await runSeedQuery(connection, { ...request, perspective: "raw" }, options);
    return Array.isArray(result) ? (result as readonly Record<string, unknown>[]) : [];
  }

  // Every planned `_id`, checked directly. Every other check below is
  // identity-scoped (mediaId, contentId+language, placementId) and filters its own
  // query by that identity — so if some other process (a bug, a partial earlier run,
  // a manual mistake) already put a *different kind* of document at one of this
  // plan's own deterministic ids, none of those checks would ever see it, since they
  // never query by raw `_id`. `createOrReplace` addresses purely by `_id`, though, and
  // would silently destroy whatever it finds there regardless of what any other check
  // concluded (Codex round 8, finding "Reject incompatible documents occupying planned
  // IDs"). The `migrated--` namespace being this tool's own, single-writer namespace is
  // exactly the assumption this check exists to not simply trust.
  const documentByPlannedId = new Map(documents.map((document) => [document._id, document]));
  for (const idsChunk of chunkIdsByByteBudget([...plannedIds])) {
    const rows = await runQuery({
      query: `*[_id in $ids]{_id, _type, mediaId, contentId, language, placementId}`,
      params: { ids: idsChunk },
    });
    for (const row of rows) {
      if (typeof row._id !== "string") continue;
      const planned = documentByPlannedId.get(publishedIdOf(row._id));
      if (planned === undefined) continue;
      if (row._type !== planned._type) {
        collisions.push(
          `a "${String(row._type)}" document already exists at "${row._id}", but this plan would write a "${planned._type}" there — refusing to overwrite an incompatible document`,
        );
        continue;
      }
      const identityMismatch =
        (planned._type === MEDIA_TYPE_NAME && row.mediaId !== planned.mediaId) ||
        (planned._type === ARTICLE_TYPE_NAME && (row.contentId !== planned.contentId || row.language !== planned.language)) ||
        (planned._type === ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME && row.placementId !== planned.placementId);
      if (identityMismatch) {
        collisions.push(`a document already exists at "${row._id}" with a different identity than this plan intends — refusing to overwrite it`);
      }
    }
  }

  // mediaId
  const mediaIds = documents.filter((document) => document._type === MEDIA_TYPE_NAME).map((document) => String(document.mediaId));
  for (const idsChunk of chunkIdsByByteBudget(mediaIds)) {
    const rows = await runQuery({ query: `*[_type == "media" && mediaId in $ids]{_id, mediaId}`, params: { ids: idsChunk } });
    for (const row of rows) {
      if (typeof row._id !== "string") continue;
      if (!plannedIds.has(publishedIdOf(row._id))) {
        collisions.push(`a media document already exists at "${row._id}" claiming mediaId "${String(row.mediaId)}"`);
      }
    }
  }

  // contentId — site-wide across BOTH articles and galleries
  // (`content-tree.ts`'s `duplicate-content-id` check, restated for Studio by
  // `makeContentIdentityValidator`'s `siblingTypes`): a same-language collision is a
  // duplicate; a different-language collision where the existing document's `_type`
  // is not `article` is a variant mismatch (a `contentId`'s variant cannot change
  // between its own language versions). This plan never writes a `gallery` document,
  // so *any* existing gallery sharing one of our contentIds is always foreign — the
  // original article-only query (Codex round 1, finding "Include galleries in
  // content identity checks") could see neither case.
  const articles = documents.filter((document) => document._type === ARTICLE_TYPE_NAME);
  const contentKeys = new Set(articles.map((document) => `${String(document.contentId)}:${String(document.language)}`));
  const contentIds = [...new Set(articles.map((document) => String(document.contentId)))];
  for (const idsChunk of chunkIdsByByteBudget(contentIds)) {
    const rows = await runQuery({
      query: `*[_type in ["article", "gallery"] && contentId in $ids]{_id, _type, contentId, language}`,
      params: { ids: idsChunk },
    });
    for (const row of rows) {
      if (
        typeof row._id !== "string" ||
        typeof row._type !== "string" ||
        typeof row.contentId !== "string" ||
        typeof row.language !== "string"
      ) {
        continue;
      }
      if (contentKeys.has(`${row.contentId}:${row.language}`)) {
        if (!plannedIds.has(publishedIdOf(row._id))) {
          collisions.push(`an article document already exists at "${row._id}" claiming contentId "${row.contentId}" and language "${row.language}"`);
        }
      } else if (row._type !== ARTICLE_TYPE_NAME) {
        // The query's own `contentId in $ids` filter already guarantees `row.contentId`
        // is one of ours — reaching this branch means it's the wrong variant.
        collisions.push(
          `contentId "${row.contentId}" is already used by a ${row._type} at "${row._id}" in language "${row.language}" — this migration writes it as ${ARTICLE_TYPE_NAME}, and a contentId's variant cannot change between language versions`,
        );
      }
    }
  }

  // route: the one local slug namespace ADR-0003 decision 6 gives every parent's
  // public child categories *and* its canonically placed content together
  // (`findProspectiveLocalSlugCollision`) — so this has to check galleries sharing
  // the namespace, not only other articles, and child categories of each category
  // this plan places into, not only content (Codex round 1, finding "Validate the
  // complete local slug namespace").
  const plannedRoutes = new Set(
    articles
      .map((document) => {
        const categoryDocId = articleCanonicalCategoryDocId(document, categoryDocIdByCategoryId);
        return categoryDocId === undefined ? undefined : `${String(document.language)}:${categoryDocId}:${String(document.slug)}`;
      })
      .filter((route): route is string => route !== undefined),
  );
  const slugs = [...new Set(articles.map((document) => String(document.slug)))];
  for (const idsChunk of chunkIdsByByteBudget(slugs)) {
    const rows = await runQuery({
      query: `*[_type in ["article", "gallery"] && slug in $slugs]{_id, language, slug, "categoryRef": canonicalCategory._ref}`,
      params: { slugs: idsChunk },
    });
    for (const row of rows) {
      if (
        typeof row._id !== "string" ||
        typeof row.language !== "string" ||
        typeof row.slug !== "string" ||
        typeof row.categoryRef !== "string"
      ) {
        continue;
      }
      const route = `${row.language}:${row.categoryRef}:${row.slug}`;
      if (!plannedRoutes.has(route)) continue;
      if (!plannedIds.has(publishedIdOf(row._id))) {
        collisions.push(`a document already exists at "${row._id}" claiming the route "${route}"`);
      }
    }
  }

  const targetCategoryDocIds = [...new Set(articles.map((document) => articleCanonicalCategoryDocId(document, categoryDocIdByCategoryId)).filter((id): id is string => id !== undefined))];
  for (const idsChunk of chunkIdsByByteBudget(targetCategoryDocIds)) {
    const rows = await runQuery({
      query: `*[_type == "category" && parent._ref in $ids]{_id, "parentRef": parent._ref, slug[]{language, value}}`,
      params: { ids: idsChunk },
    });
    for (const row of rows) {
      if (typeof row._id !== "string" || typeof row.parentRef !== "string" || !Array.isArray(row.slug)) continue;
      for (const entry of row.slug) {
        if (!isPlainObject(entry) || typeof entry.language !== "string" || typeof entry.value !== "string") continue;
        const route = `${entry.language}:${row.parentRef}:${entry.value}`;
        if (plannedRoutes.has(route)) {
          collisions.push(`a category already exists at "${row._id}" claiming the route "${route}" this migration would place content at`);
        }
      }
    }
  }

  // placementId (end-gallery placements) — site-wide, including a curated
  // gallery's own `galleryPlacement` documents (ADR-0002 §1's "public and
  // site-wide unique"), never only the end-gallery type this plan itself writes
  // (Codex round 1, finding "Check placement IDs against curated placements"). An
  // `articleEndGalleryPlacement` match outside this plan's own ids is not
  // automatically a collision, though: `article-end-gallery-placement.ts`'s own
  // Studio validator explicitly allows two documents to share one `placementId`
  // when they are the *same occurrence*'s sibling language versions — the article's
  // `contentId`, its `endGalleryId`, and the placement's `media` reference all
  // match, with a different `article` reference. This matters across phases
  // specifically: a translation pair's two language versions can land in different
  // phased writes, so the earlier phase's placement is never in *this* plan's own
  // `plannedIds` even though it is entirely legitimate (Codex round 2, finding
  // "Allow matching translated placements from earlier phases"). The query
  // dereferences the existing placement's own article the same way that Studio
  // validator does, so this can be decided in one round trip.
  const ownEndGalleryOccurrences = new Map<string, { readonly contentId: string; readonly endGalleryId: string; readonly mediaRef: string }>();
  const articlesById = new Map(articles.map((document) => [document._id, document]));
  for (const document of documents) {
    if (document._type !== ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME) continue;
    const placementId = typeof document.placementId === "string" ? document.placementId : undefined;
    const articleRef = isReferenceObject(document.article) ? document.article._ref : undefined;
    const mediaRef = isReferenceObject(document.media) ? document.media._ref : undefined;
    const article = articleRef === undefined ? undefined : articlesById.get(articleRef);
    const contentId = typeof article?.contentId === "string" ? article.contentId : undefined;
    const endGalleryId = typeof article?.endGalleryId === "string" ? article.endGalleryId : undefined;
    if (placementId !== undefined && contentId !== undefined && endGalleryId !== undefined && mediaRef !== undefined) {
      ownEndGalleryOccurrences.set(placementId, { contentId, endGalleryId, mediaRef });
    }
  }

  const placementIds = [...ownEndGalleryOccurrences.keys()];
  for (const idsChunk of chunkIdsByByteBudget(placementIds)) {
    const rows = await runQuery({
      query: `*[_type in ["${ARTICLE_END_GALLERY_PLACEMENT_TYPE_NAME}", "${GALLERY_PLACEMENT_TYPE_NAME}"] && placementId in $ids]{_id, _type, placementId, "mediaRef": media._ref, "containerContentId": article->contentId, "endGalleryId": article->endGalleryId}`,
      params: { ids: idsChunk },
    });
    for (const row of rows) {
      if (typeof row._id !== "string") continue;
      if (row._type === GALLERY_PLACEMENT_TYPE_NAME) {
        // Always foreign — this plan never writes that type.
        collisions.push(`a ${String(row._type)} document already exists at "${row._id}" claiming placementId "${String(row.placementId)}"`);
        continue;
      }
      if (plannedIds.has(publishedIdOf(row._id))) continue; // this plan's own document (a safe re-run)
      const ownOccurrence = typeof row.placementId === "string" ? ownEndGalleryOccurrences.get(row.placementId) : undefined;
      const isSameOccurrence =
        ownOccurrence !== undefined &&
        row.containerContentId === ownOccurrence.contentId &&
        row.endGalleryId === ownOccurrence.endGalleryId &&
        row.mediaRef === ownOccurrence.mediaRef;
      if (!isSameOccurrence) {
        collisions.push(`a ${String(row._type)} document already exists at "${row._id}" claiming placementId "${String(row.placementId)}"`);
      }
    }
  }

  // A published article's language, slug, and canonical category are frozen once
  // published (`article-validation.ts`'s own `changesPublishedUrlFields`, restated
  // here since this API write bypasses that Studio guard entirely): rerunning a
  // migration for an article that already exists must never silently change any of
  // the three, since that would retire the existing URL with no redirect (Codex round
  // 7, finding "Preserve published routes when rerunning an article").
  const articleIds = articles.map((document) => document._id);
  for (const idsChunk of chunkIdsByByteBudget(articleIds)) {
    const rows = await runQuery({
      query: `*[_id in $ids]{_id, language, slug, "canonicalCategoryId": canonicalCategory->categoryId}`,
      params: { ids: idsChunk },
    });
    for (const row of rows) {
      if (typeof row._id !== "string" || typeof row.language !== "string" || typeof row.slug !== "string") continue;
      const planned = articles.find((document) => document._id === row._id);
      if (planned === undefined) continue;
      const plannedCategoryId = isReferenceObject(planned.canonicalCategory) && planned.canonicalCategory._ref.startsWith(PENDING_CATEGORY_PREFIX)
        ? planned.canonicalCategory._ref.slice(PENDING_CATEGORY_PREFIX.length)
        : null;
      const current: ProspectivePlacementFields = {
        documentId: row._id,
        contentId: String(planned.contentId),
        language: typeof planned.language === "string" ? planned.language : "",
        slug: typeof planned.slug === "string" ? planned.slug : "",
        canonicalCategoryId: plannedCategoryId,
        secondaryCategoryIds: [],
      };
      if (
        changesPublishedUrlFields(
          { language: row.language, slug: row.slug, canonicalCategoryId: typeof row.canonicalCategoryId === "string" ? row.canonicalCategoryId : null },
          current,
        )
      ) {
        collisions.push(
          `article "${row._id}" is already published at language "${row.language}", slug "${row.slug}" — this plan would change its published language, slug, or canonical category, silently retiring the existing URL with no redirect`,
        );
      }
    }
  }

  // The shared local slug namespace (ADR-0003 decision 6): a public child category and
  // canonically placed content beneath the same parent share one namespace, and this
  // migration can make a previously dormant category branch public for the first time
  // by placing content into it — exposing a slug collision with a sibling category or
  // existing content anywhere in that branch's ancestry, not only among the direct
  // children of the categories this plan targets (which the route check above already
  // covers). Reusing `resolveProspectivePublicCategoryIds`/
  // `findProspectiveLocalSlugCollision` — the exact functions the Studio publish guard
  // runs — is what makes this correct without reimplementing their ancestry walk
  // (Codex round 7, finding "Check collisions for newly public category ancestors").
  // Both queries below have no growing parameter list (a static type filter only), so
  // neither needs the byte-budget chunker.
  const languages = [...new Set(articles.map((document) => String(document.language)))];
  for (const language of languages) {
    const categoryRows = await runQuery({ query: `*[_type == "category"]{_id, categoryId, "parentRef": parent._ref, slug, label}` });
    const categories = parseProspectiveCategories(categoryRows, language);

    const existingRows = await runQuery({
      query: `*[_type in ["article", "gallery"] && language == $language]{contentId, slug, "canonicalCategoryId": canonicalCategory->categoryId, "secondaryCategoryIds": secondaryCategories[]->categoryId}`,
      params: { language },
    });
    const existingPlacements: ProspectivePlacement[] = existingRows
      .filter((row): row is Record<string, unknown> => typeof row.contentId === "string" && typeof row.slug === "string")
      .map((row) => ({
        contentId: row.contentId as string,
        slug: row.slug as string,
        canonicalCategoryId: typeof row.canonicalCategoryId === "string" ? row.canonicalCategoryId : null,
        secondaryCategoryIds: Array.isArray(row.secondaryCategoryIds) ? row.secondaryCategoryIds.filter((id): id is string => typeof id === "string") : [],
      }));

    const plannedInLanguage = articles.filter((document) => document.language === language);
    const plannedPlacements: ProspectivePlacement[] = plannedInLanguage.map((document) => ({
      contentId: String(document.contentId),
      slug: String(document.slug),
      canonicalCategoryId: isReferenceObject(document.canonicalCategory) && document.canonicalCategory._ref.startsWith(PENDING_CATEGORY_PREFIX)
        ? document.canonicalCategory._ref.slice(PENDING_CATEGORY_PREFIX.length)
        : null,
      secondaryCategoryIds: Array.isArray(document.secondaryCategories)
        ? (document.secondaryCategories as readonly unknown[])
            .map((entry) => (isReferenceObject(entry) && entry._ref.startsWith(PENDING_CATEGORY_PREFIX) ? entry._ref.slice(PENDING_CATEGORY_PREFIX.length) : undefined))
            .filter((id): id is string => id !== undefined)
        : [],
    }));

    const allPlacements = [...existingPlacements, ...plannedPlacements];
    const publicCategoryIds = resolveProspectivePublicCategoryIds(categories, allPlacements);

    for (const [index, document] of plannedInLanguage.entries()) {
      const current: ProspectivePlacementFields = {
        documentId: document._id,
        language,
        ...plannedPlacements[index]!,
      };
      const collision = findProspectiveLocalSlugCollision(current, categories, publicCategoryIds, allPlacements);
      if (collision !== undefined) {
        collisions.push(
          `article "${document._id}" (contentId "${current.contentId}") collides with ${collision.conflictingKind} "${collision.conflictingId}" on slug "${collision.slug}" beneath the same category — the shared local slug namespace (ADR-0003 decision 6)`,
        );
      }
    }
  }

  return { collisions };
}

// ---------------------------------------------------------------------------
// Cross-phase media field preservation (Codex round 2, finding "Preserve existing
// media fields across phased writes"; widened after Codex round 3, finding "Preserve
// existing media visibility during phased writes"). `docs/sanity-seeding.md` documents
// the approved-manifest workflow as one phase per plan (`--phase launch`/`--phase
// later`/…): a photograph reused across phases gets a *separate* plan each time, and
// `buildImportPlan`'s own `media` document only ever carries the fields this tool
// itself authors (`mediaId`, `mediaType`, `alt`, `publiclyRenderable`, `image`) — it
// has no visibility into a `caption`, `credit`, `capturedAt`, or `enquiryEligible` an
// editor added by hand after an earlier phase's write, or an `archiveLocator` a private
// dataset carries. Writing that document with a plain `createOrReplace` would silently
// delete all of it, since the mutate API replaces the whole document rather than
// patching it. Worse, an editor's explicit `publiclyRenderable: false` — deliberately
// hiding a published photograph without unpublishing it — would be silently reset to
// this tool's own unconditional `true`, republishing something an editor chose to hide.
// ---------------------------------------------------------------------------

type LocalizedAltEntry = { readonly language: string; readonly value: string };

function readAltEntries(value: unknown): readonly LocalizedAltEntry[] {
  if (!Array.isArray(value)) return [];
  const entries: LocalizedAltEntry[] = [];
  for (const entry of value) {
    if (isPlainObject(entry) && typeof entry.language === "string" && typeof entry.value === "string") {
      entries.push({ language: entry.language, value: entry.value });
    }
  }
  return entries;
}

/** Fields this tool never authors — an editor's own value, once present, is always carried over unchanged. */
const CARRIED_MEDIA_FIELDS = ["caption", "credit", "capturedAt", "enquiryEligible", "archiveLocator"] as const;

export type MediaFieldMergeResult = {
  readonly documents: readonly PlannedDocument[];
  readonly issues: readonly string[];
};

/**
 * Fetches every planned `media` document's currently-published fields (published
 * perspective — exactly what a plain `createOrReplace` is about to overwrite) and
 * merges them into the plan's own document:
 * - `alt` is merged by language — this tool *does* have an authoritative opinion on
 *   it, since it is derived from real approved translations across phases. A language
 *   this plan does not itself contribute is carried over unchanged; a language both
 *   sides already provide but genuinely *disagree* on is an authoring conflict this
 *   tool refuses to silently resolve, the same posture every other conflict class in
 *   this feature already takes, rather than guessing which phase is "right."
 * - `caption`/`credit`/`capturedAt`/`enquiryEligible`/`archiveLocator` are fields this
 *   tool has no opinion on at all — an existing value, once present, is carried over
 *   unchanged rather than deleted.
 * - `publiclyRenderable` is the one field where "false wins": an existing document
 *   already hidden (`false`) stays hidden regardless of this plan's own value, since
 *   only an editor should reverse that choice.
 */
export async function mergeExistingMediaFields(
  connection: SeedConnection,
  documents: readonly PlannedDocument[],
  options?: RequestOptions,
): Promise<MediaFieldMergeResult> {
  const mediaIds = documents.filter((document) => document._type === MEDIA_TYPE_NAME).map((document) => document._id);
  const existingById = new Map<string, Record<string, unknown>>();
  for (const idsChunk of chunkIdsByByteBudget(mediaIds)) {
    const rows = (await runSeedQuery(
      connection,
      {
        query: `*[_type == "${MEDIA_TYPE_NAME}" && _id in $ids]{_id, alt, ${CARRIED_MEDIA_FIELDS.join(", ")}, publiclyRenderable}`,
        params: { ids: idsChunk },
      },
      options,
    )) as readonly Record<string, unknown>[];
    for (const row of rows) {
      if (typeof row._id === "string") existingById.set(row._id, row);
    }
  }

  const issues: string[] = [];
  const merged = documents.map((document): PlannedDocument => {
    if (document._type !== MEDIA_TYPE_NAME) return document;
    const existing = existingById.get(document._id);
    if (existing === undefined) return document;

    const byLanguage = new Map(readAltEntries(document.alt).map((entry) => [entry.language, entry.value]));
    for (const entry of readAltEntries(existing.alt)) {
      const current = byLanguage.get(entry.language);
      if (current === undefined) {
        byLanguage.set(entry.language, entry.value);
      } else if (current !== entry.value) {
        issues.push(
          `media "${document._id}" already has a published "${entry.language}" alt text ("${entry.value}") that disagrees with this plan's own value ("${current}") — resolve manually before writing`,
        );
      }
    }
    const alt = [...byLanguage]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([language, value], index) => ({ _key: `alt-${String(index + 1).padStart(2, "0")}`, _type: "localizedText", language, value }));

    const carried: Record<string, unknown> = {};
    for (const field of CARRIED_MEDIA_FIELDS) {
      if (existing[field] !== undefined) carried[field] = existing[field];
    }
    const publiclyRenderable = existing.publiclyRenderable === false ? false : document.publiclyRenderable;

    return { ...document, ...carried, alt, publiclyRenderable };
  });

  return { documents: merged, issues };
}

// ---------------------------------------------------------------------------
// Write ordering — media first, everything else after (Codex round 1, finding 1):
// Sanity's mutate API requires a strong reference's target to exist in an *earlier*
// transaction, and `docs/sanity-seeding.md` already documents this exact constraint
// for the demo seeder's own write.
// ---------------------------------------------------------------------------

export function splitIntoWaves(documents: readonly PlannedDocument[]): readonly (readonly PlannedDocument[])[] {
  const media = documents.filter((document) => document._type === MEDIA_TYPE_NAME);
  const rest = documents.filter((document) => document._type !== MEDIA_TYPE_NAME);
  return [media, rest];
}

export async function verifyWrittenDocuments(
  connection: SeedConnection,
  documentIds: readonly string[],
  options?: RequestOptions,
): Promise<{ readonly expected: number; readonly found: number }> {
  let found = 0;
  for (const idsChunk of chunkIdsByByteBudget(documentIds)) {
    if (idsChunk.length === 0) continue;
    const count = await runSeedQuery(connection, { query: `count(*[_id in $ids])`, params: { ids: idsChunk } }, options);
    found += typeof count === "number" ? count : 0;
  }
  return { expected: documentIds.length, found };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export type Options = {
  readonly plan: string;
  readonly imageRoot: string;
  readonly out: string;
  readonly approvedDigest: string;
  readonly apply: boolean;
  readonly project?: string;
  readonly dataset?: string;
  readonly apiVersion?: string;
};

const KNOWN_OPTIONS = new Set(["plan", "image-root", "out", "approved-digest", "project", "dataset", "api-version"]);

export function parseArguments(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--yes") {
      apply = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      fail(`unexpected argument "${argument}" — every option is spelled --<name> <value>`);
    }
    const name = argument.slice(2);
    if (!KNOWN_OPTIONS.has(name)) {
      fail(`unknown option "${argument}" — known options are ${[...KNOWN_OPTIONS].map((known) => `--${known}`).join(", ")}, --yes`);
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) fail(`${argument} needs a value`);
    values.set(name, next);
    index += 1;
  }
  const plan = values.get("plan");
  const imageRoot = values.get("image-root");
  const out = values.get("out");
  const approvedDigest = values.get("approved-digest");
  if (plan === undefined) fail("--plan <import-plan.json> is required");
  if (imageRoot === undefined) fail("--image-root <dir> is required");
  if (out === undefined) fail("--out <report-dir> is required");
  if (approvedDigest === undefined) {
    fail(
      "--approved-digest <sha256> is required — the digest convert:joomla --plan printed as documentsDigest, confirming this is the exact plan that was reviewed",
    );
  }
  return {
    plan,
    imageRoot,
    out,
    approvedDigest,
    apply,
    ...(values.get("project") === undefined ? {} : { project: values.get("project") as string }),
    ...(values.get("dataset") === undefined ? {} : { dataset: values.get("dataset") as string }),
    ...(values.get("api-version") === undefined ? {} : { apiVersion: values.get("api-version") as string }),
  };
}

function requiredSetting(options: Options, flagKey: "project" | "dataset" | "apiVersion", flagName: string, envName: string): string {
  const value = options[flagKey] ?? process.env[envName];
  if (value === undefined) fail(`${envName} is required (or pass --${flagName})`);
  return value;
}

/** Used only for the write-scoped token — never accepted as a flag, so it never lands in shell history or a process listing. */
/**
 * A value mirrored under a `NEXT_PUBLIC_` name is refused rather than ignored, the
 * exact rule `src/lib/sanity-config.ts#parseReadToken` already enforces for the
 * runtime app's own read token: Next.js inlines `NEXT_PUBLIC_`-prefixed values into
 * the browser bundle, so its presence means an Editor-scoped write credential is
 * already on its way to every visitor, and quietly preferring the correctly-scoped
 * copy would leave the leak in place (Codex round 9, finding "Reject a public copy of
 * the migration token").
 */
function requiredEnvSetting(envName: string): string {
  const publicName = `NEXT_PUBLIC_${envName}`;
  if (process.env[publicName]?.trim()) {
    fail(
      `${publicName} is set: a NEXT_PUBLIC_ prefixed value is compiled into the browser bundle, so this write-scoped credential must never be set under that name. Remove it and set ${envName} instead.`,
    );
  }
  const value = process.env[envName];
  if (value === undefined || value.trim().length === 0) fail(`${envName} is required (this tool never accepts a token as a flag)`);
  return value;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));

  // --- step 1: load & validate the plan's shape (local filesystem only) ---
  const planText = await readFile(options.plan, "utf8").catch(() => fail(`could not read ${options.plan}`));
  let rawPlan: unknown;
  try {
    rawPlan = JSON.parse(planText);
  } catch {
    fail(`${options.plan} is not valid JSON`);
  }
  const { issues: contractIssues, plan } = validatePlanContract(rawPlan);
  if (plan === undefined) {
    const reportPath = await writeReport(options.out, "plan-validation-errors.json", contractIssues);
    console.error(`The plan failed ${contractIssues.length} contract check(s). See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }
  if (plan.errors.length > 0 || plan.blocked.length > 0) {
    fail(
      `the plan carries ${plan.errors.length} unresolved error(s) and ${plan.blocked.length} blocked article(s) — fix and regenerate it with convert:joomla before writing`,
    );
  }
  const documentViolations = validateMigrationDocuments(plan.documents);
  if (documentViolations.length > 0) {
    const reportPath = await writeReport(options.out, "plan-validation-errors.json", documentViolations);
    console.error(`The plan's documents failed ${documentViolations.length} invariant check(s). See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }

  // Recomputed from the loaded plan's own `documents` and compared against the
  // operator-supplied `--approved-digest` — never against `plan.documentsDigest` read
  // from the file itself, which a hand-edit could update to match its own tampered
  // content just as easily as the documents it describes. Every check so far proves
  // the plan is *well-formed*; this is the one that proves it is *the plan that was
  // reviewed* — the manifest's own digests bind an approval to what the conversion
  // produced, but neither is re-checked once `import-plan.json` is written to disk, and
  // this write step has no access to the manifest, source export, or resolution file to
  // re-derive them (Codex round 5, finding "Verify the write plan against the approved
  // payload").
  const actualDigest = writablePlanDigest(plan.documents, plan.assetRequirements, plan.errors, plan.blocked);
  if (actualDigest !== options.approvedDigest) {
    fail(
      `the plan's documents digest is ${actualDigest}, but --approved-digest supplied ${options.approvedDigest} — this is not the exact plan that was reviewed (or the wrong digest was passed); regenerate or re-review it before writing`,
    );
  }

  // --- step 2: verify every asset locally, one at a time (local only, no network) ---
  // Only a lightweight summary is retained past each iteration — never the full
  // `AssetOutcome`, which on success carries a real, possibly multi-megabyte
  // derivative buffer. Sequential processing alone does not bound memory if the
  // result of every iteration is then kept alive in a long-lived array; this pass
  // exists only to prove every asset verifies and derives cleanly before any
  // credential is read, not to cache bytes for later (Codex review round 1, finding 6).
  const failures: { readonly mediaId: string; readonly sourceLocator: string; readonly reason: string }[] = [];
  for (const requirement of plan.assetRequirements) {
    const outcome = await verifyAndDeriveAsset(options.imageRoot, requirement);
    if (!outcome.ok) failures.push({ mediaId: outcome.mediaId, sourceLocator: outcome.sourceLocator, reason: outcome.reason });
  }
  if (failures.length > 0) {
    const reportPath = await writeReport(options.out, "asset-verification-failures.json", failures);
    console.error(`${failures.length} of ${plan.assetRequirements.length} photograph(s) failed local verification. See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `Plan loaded: ${plan.documents.length} document(s), ${plan.assetRequirements.length} photograph(s) verified locally, ${plan.categoryRequirements.length} categor${plan.categoryRequirements.length === 1 ? "y" : "ies"} to resolve.`,
  );

  // --- step 3: dry run stops here — no network request has been made ---
  if (!options.apply) {
    console.log("\nDry run only — no network request was made. Re-run with --yes to write.");
    return;
  }

  const connection = parseSeedConnection({
    projectId: requiredSetting(options, "project", "project", "SANITY_PROJECT_ID"),
    dataset: requiredSetting(options, "dataset", "dataset", "SANITY_DATASET"),
    apiVersion: requiredSetting(options, "apiVersion", "api-version", "SANITY_API_VERSION"),
    token: requiredEnvSetting("SANITY_MIGRATION_TOKEN"),
  });

  // --- step 4: resolve categories ---
  const categoryResolution = await resolveCategoryReferences(
    connection,
    plan.categoryRequirements,
    collectRequiredCategoryLanguages(plan.documents),
  );
  if (categoryResolution.issues.length > 0) {
    const reportPath = await writeReport(options.out, "unresolved-categories.json", categoryResolution.issues);
    console.error(`${categoryResolution.issues.length} categor${categoryResolution.issues.length === 1 ? "y issue" : "y issues"}. See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Resolved ${categoryResolution.resolved.size} categor${categoryResolution.resolved.size === 1 ? "y" : "ies"} against the target dataset.`);

  // --- step 5: target-dataset collision preflight ---
  const preflight = await runCollisionPreflight(connection, plan.documents, categoryResolution.resolved);
  if (preflight.collisions.length > 0) {
    const reportPath = await writeReport(options.out, "target-collisions.json", preflight.collisions);
    console.error(
      `${preflight.collisions.length} identity collision(s) with existing, differently-identified content. See ${reportPath}. If these are a previous run of this same plan under a changed contentId, resolve manually before re-running.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log("No target-dataset collisions found.");

  // --- step 6: merge each media document's currently-published editor-owned fields
  // (alt text, caption, credit, capture date, enquiry eligibility, archive location,
  // and a "hidden" publiclyRenderable), so a reused photograph does not silently lose
  // an earlier phase's or an editor's own values to this phase's necessarily narrower
  // plan, and a deliberately hidden photograph is never silently republished ---
  const mediaMerge = await mergeExistingMediaFields(connection, plan.documents);
  if (mediaMerge.issues.length > 0) {
    const reportPath = await writeReport(options.out, "media-field-conflicts.json", mediaMerge.issues);
    console.error(`${mediaMerge.issues.length} media field conflict(s) with already-published content. See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }
  const documentsWithMergedMediaFields = mediaMerge.documents;

  // --- step 7: verify + derive + upload every asset again, one at a time, discarding
  // each derivative once its upload completes ---
  const assetIdByMediaId = new Map<string, string>();
  const uploadFailures: { readonly mediaId: string; readonly reason: string }[] = [];
  for (const requirement of plan.assetRequirements) {
    const outcome = await verifyAndDeriveAsset(options.imageRoot, requirement);
    if (!outcome.ok) {
      uploadFailures.push({ mediaId: outcome.mediaId, reason: outcome.reason });
      break; // the file changed between the dry pass and now — stop rather than upload a mix of runs
    }
    try {
      const uploaded = await uploadSeedImageAsset(connection, outcome.derivative, {
        maxDimension: MAX_PUBLIC_DELIVERY_DIMENSION,
        formatsByExtension: PUBLIC_DELIVERY_FORMATS,
      });
      assetIdByMediaId.set(outcome.mediaId, uploaded.assetId);
    } catch (error) {
      uploadFailures.push({ mediaId: outcome.mediaId, reason: error instanceof Error ? error.message : String(error) });
      break; // already-uploaded assets in this run are not rolled back; see docs/sanity-seeding.md
    }
  }
  if (uploadFailures.length > 0) {
    const reportPath = await writeReport(options.out, "upload-failures.json", uploadFailures);
    console.error(
      `Upload failed after ${assetIdByMediaId.size} asset(s). See ${reportPath}. Assets already uploaded in this run were not rolled back — see docs/sanity-seeding.md.`,
    );
    process.exitCode = 1;
    return;
  }
  console.log(`Uploaded ${assetIdByMediaId.size} photograph(s).`);

  // --- step 8: substitute placeholders, reference-aware, then defensively re-scan ---
  const substituted = substitutePendingReferences(documentsWithMergedMediaFields, assetIdByMediaId, categoryResolution.resolved);
  assertNoPendingReferencesRemain(substituted);

  // --- step 9: write in dependency waves — media first, then everything else ---
  const waves = splitIntoWaves(substituted);
  let batchesRun = 0;
  for (const wave of waves) {
    if (wave.length === 0) continue;
    const summary = await runSeedMutationBatches(
      connection,
      wave.map((document) => ({ createOrReplace: document })),
    );
    batchesRun += summary.batchesRun;
  }
  console.log(`Wrote ${substituted.length} document(s) in ${batchesRun} batch(es).`);

  // --- step 10: post-write verification ---
  const verification = await verifyWrittenDocuments(
    connection,
    substituted.map((document) => document._id),
  );
  if (verification.found === verification.expected) {
    console.log(`Verification PASS: ${verification.found}/${verification.expected} document(s) read back.`);
  } else {
    console.error(`Verification FAIL: only ${verification.found}/${verification.expected} document(s) read back.`);
    process.exitCode = 1;
  }
}

// Guarded so importing this module for its exported functions does not execute the
// command. `import.meta.main` is Node's own entry-point signal (available on the
// pinned Node 24 major) — the same guard `convert-joomla-content.mts` already uses.
// Unlike that offline tool, this one performs real network I/O (`parseSeedConnection`,
// `runSeedQuery`, `runSeedMutationBatches` can all throw on a malformed setting or a
// transport failure), so `main()` is also wrapped the same way
// `seed-sanity-content.mts` wraps its own: any otherwise-uncaught error becomes one
// clean `fail()` message instead of a raw Node stack trace.
if (import.meta.main) {
  main().catch((cause) => {
    fail(cause instanceof Error ? cause.message : String(cause));
  });
}
