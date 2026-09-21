#!/usr/bin/env node
/**
 * Writes an owner-approved category tree fragment to Sanity.
 *
 * The command is intentionally separate from content import. Categories own the
 * public route tree, so a dry run validates their identities, localised path
 * segments and parent dependency order before a gallery writer can bind to one.
 * The default performs no network request. `--yes` additionally requires the
 * SHA-256 digest printed by that reviewed dry run.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import {
  parseSeedConnection,
  runSeedMutationBatches,
  runSeedQuery,
  type SeedConnection,
} from "./sanity-seed-http.mts";

export const CATEGORY_WRITE_PLAN_VERSION = "sanity-category-write-plan-v1";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LANGUAGE_PATTERN = /^[a-z]{2,3}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const DOCUMENT_ID_PATTERN = /^migrated--category-[a-z0-9-]+$/u;
const DOCUMENT_ID_MAX_LENGTH = 128;
const DOCUMENT_FIELDS = new Set([
  "_id", "_type", "categoryId", "parent", "slug", "label", "description", "order",
]);
const LOCALIZED_FIELDS = new Set(["_key", "_type", "language", "value"]);
const DESCRIPTION_FIELDS = new Set(["_key", "_type", "language", "blocks"]);
const PARAGRAPH_FIELDS = new Set(["_key", "_type", "spans"]);
const SPAN_FIELDS = new Set(["_key", "_type", "text", "marks", "href"]);

export type LocalizedValue = {
  readonly _key: string;
  readonly _type: "localizedSlug" | "localizedText";
  readonly language: string;
  readonly value: string;
};

export type CategoryDescription = readonly {
  readonly _key: string;
  readonly _type: "categoryDescription";
  readonly language: string;
  readonly blocks: readonly {
    readonly _key: string;
    readonly _type: "categoryDescriptionParagraph";
    readonly spans: readonly {
      readonly _key: string;
      readonly _type: "categoryDescriptionInlineSpan";
      readonly text: string;
    }[];
  }[];
}[];

export type CategoryWriteDocument = {
  readonly _id: string;
  readonly _type: "category";
  readonly categoryId: string;
  readonly parent?: { readonly _type: "reference"; readonly _ref: string };
  readonly slug: readonly LocalizedValue[];
  readonly label: readonly LocalizedValue[];
  readonly description?: CategoryDescription;
  readonly order: number;
};

export type CategoryWritePlan = {
  readonly version: typeof CATEGORY_WRITE_PLAN_VERSION;
  readonly documents: readonly CategoryWriteDocument[];
};

type ExistingDocument = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publishedIdOf(id: string): string {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}

function sortedObject<T extends { readonly _id: string }>(documents: readonly T[]): readonly T[] {
  return [...documents].sort((left, right) => left._id.localeCompare(right._id));
}

function normalizedDocument(document: CategoryWriteDocument) {
  return {
    _id: document._id,
    _type: document._type,
    categoryId: document.categoryId,
    ...(document.parent === undefined ? {} : { parent: document.parent }),
    slug: [...document.slug],
    label: [...document.label],
    ...(document.description === undefined ? {} : { description: document.description }),
    order: document.order,
  };
}

export function categoryDocumentsDigest(
  documents: readonly CategoryWriteDocument[],
): string {
  return createHash("sha256")
    .update(JSON.stringify(sortedObject(documents).map(normalizedDocument)), "utf8")
    .digest("hex");
}

function validateLocalized(
  value: unknown,
  expectedType: "localizedSlug" | "localizedText",
  path: string,
  issues: string[],
): readonly LocalizedValue[] | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${path} must be a non-empty localized array`);
    return undefined;
  }
  const languages = new Set<string>();
  const result: LocalizedValue[] = [];
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) {
      issues.push(`${entryPath} is not an object`);
      continue;
    }
    const unknown = Object.keys(entry).filter((field) => !LOCALIZED_FIELDS.has(field));
    if (unknown.length > 0) issues.push(`${entryPath} has unsupported field(s): ${unknown.join(", ")}`);
    const { _key, _type, language, value: text } = entry;
    if (typeof _key !== "string" || _key !== language) issues.push(`${entryPath}._key must equal its language`);
    if (_type !== expectedType) issues.push(`${entryPath}._type must be "${expectedType}"`);
    if (typeof language !== "string" || !LANGUAGE_PATTERN.test(language)) issues.push(`${entryPath}.language is invalid`);
    if (typeof text !== "string" || text.trim().length === 0) issues.push(`${entryPath}.value must be non-empty`);
    if (expectedType === "localizedSlug" && (typeof text !== "string" || !ID_PATTERN.test(text))) {
      issues.push(`${entryPath}.value must be a lowercase hyphenated path segment`);
    }
    if (typeof language === "string" && languages.has(language)) issues.push(`${path} repeats language "${language}"`);
    if (typeof language === "string") languages.add(language);
    if (typeof _key === "string" && typeof language === "string" && typeof text === "string" &&
        (_type === expectedType)) {
      result.push({ _key, _type: expectedType, language, value: text });
    }
  }
  return result.length === value.length ? result : undefined;
}

function validateDescription(
  value: unknown,
  path: string,
  issues: string[],
): CategoryDescription | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(`${path} must be a non-empty localized description array when present`);
    return undefined;
  }
  const languages = new Set<string>();
  const result: CategoryDescription[number][] = [];
  for (const [index, entry] of value.entries()) {
    const entryPath = `${path}[${index}]`;
    if (!isRecord(entry)) { issues.push(`${entryPath} is not an object`); continue; }
    const unknown = Object.keys(entry).filter((field) => !DESCRIPTION_FIELDS.has(field));
    if (unknown.length > 0) issues.push(`${entryPath} has unsupported field(s): ${unknown.join(", ")}`);
    const { _key, _type, language, blocks } = entry;
    if (typeof _key !== "string" || _key !== language) issues.push(`${entryPath}._key must equal its language`);
    if (_type !== "categoryDescription") issues.push(`${entryPath}._type must be "categoryDescription"`);
    if (typeof language !== "string" || !LANGUAGE_PATTERN.test(language)) issues.push(`${entryPath}.language is invalid`);
    if (typeof language === "string" && languages.has(language)) issues.push(`${path} repeats language "${language}"`);
    if (typeof language === "string") languages.add(language);
    if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > 6) {
      issues.push(`${entryPath}.blocks must contain 1–6 blocks`);
      continue;
    }
    const parsedBlocks: Array<CategoryDescription[number]["blocks"][number]> = [];
    for (const [blockIndex, block] of blocks.entries()) {
      const blockPath = `${entryPath}.blocks[${blockIndex}]`;
      if (!isRecord(block)) { issues.push(`${blockPath} is not an object`); continue; }
      const blockUnknown = Object.keys(block).filter((field) => !PARAGRAPH_FIELDS.has(field));
      if (blockUnknown.length > 0) issues.push(`${blockPath} has unsupported field(s): ${blockUnknown.join(", ")}`);
      if (block._type !== "categoryDescriptionParagraph") issues.push(`${blockPath}._type must be "categoryDescriptionParagraph"`);
      if (typeof block._key !== "string" || block._key.trim().length === 0) issues.push(`${blockPath}._key must be non-empty`);
      if (!Array.isArray(block.spans) || block.spans.length === 0 || block.spans.length > 20) {
        issues.push(`${blockPath}.spans must contain 1–20 spans`);
        continue;
      }
      const spans: Array<CategoryDescription[number]["blocks"][number]["spans"][number]> = [];
      for (const [spanIndex, span] of block.spans.entries()) {
        const spanPath = `${blockPath}.spans[${spanIndex}]`;
        if (!isRecord(span)) { issues.push(`${spanPath} is not an object`); continue; }
        const spanUnknown = Object.keys(span).filter((field) => !SPAN_FIELDS.has(field));
        if (spanUnknown.length > 0) issues.push(`${spanPath} has unsupported field(s): ${spanUnknown.join(", ")}`);
        if (span._type !== "categoryDescriptionInlineSpan") issues.push(`${spanPath}._type must be "categoryDescriptionInlineSpan"`);
        if (typeof span._key !== "string" || span._key.trim().length === 0) issues.push(`${spanPath}._key must be non-empty`);
        if (typeof span.text !== "string" || span.text.trim().length === 0 || span.text.length > 300) issues.push(`${spanPath}.text must be non-empty and at most 300 characters`);
        if (span.marks !== undefined || span.href !== undefined) issues.push(`${spanPath} may not add marks or links to an import description`);
        if (typeof span._key === "string" && typeof span.text === "string" && span._type === "categoryDescriptionInlineSpan") {
          spans.push({ _key: span._key, _type: "categoryDescriptionInlineSpan", text: span.text });
        }
      }
      if (typeof block._key === "string" && block._type === "categoryDescriptionParagraph" && spans.length === block.spans.length) {
        parsedBlocks.push({ _key: block._key, _type: "categoryDescriptionParagraph", spans });
      }
    }
    if (typeof _key === "string" && typeof language === "string" && _type === "categoryDescription" && parsedBlocks.length === blocks.length) {
      result.push({ _key, _type: "categoryDescription", language, blocks: parsedBlocks });
    }
  }
  return result.length === value.length ? result : undefined;
}

function categoriesByLanguageIssues(documents: readonly CategoryWriteDocument[]): readonly string[] {
  const issues: string[] = [];
  const byId = new Map(documents.map((document) => [document._id, document]));
  for (const language of new Set(documents.flatMap((document) => document.slug.map((entry) => entry.language)))) {
    const siblingSlugs = new Set<string>();
    for (const document of documents) {
      const slug = document.slug.find((entry) => entry.language === language)?.value;
      const label = document.label.find((entry) => entry.language === language)?.value;
      if (slug === undefined && label === undefined) continue;
      if (slug === undefined || label === undefined) {
        issues.push(`${language} category "${document.categoryId}" must have both a slug and label`);
        continue;
      }
      if (document.parent !== undefined && byId.has(document.parent._ref)) {
        const parentSlug = byId.get(document.parent._ref)?.slug.find((entry) => entry.language === language)?.value;
        const parentLabel = byId.get(document.parent._ref)?.label.find((entry) => entry.language === language)?.value;
        if (parentSlug === undefined || parentLabel === undefined) {
          issues.push(`${language} category "${document.categoryId}" has a parent without that locale`);
        }
      }
      const siblingKey = `${document.parent?._ref ?? ""}\u0000${slug}`;
      if (siblingSlugs.has(siblingKey)) issues.push(`${language} sibling slug "${slug}" is present more than once`);
      siblingSlugs.add(siblingKey);
    }
  }
  return issues;
}

export function validateCategoryDocuments(values: readonly unknown[]): {
  readonly documents: readonly CategoryWriteDocument[];
  readonly issues: readonly string[];
} {
  const issues: string[] = [];
  const documents: CategoryWriteDocument[] = [];
  const ids = new Set<string>();
  const categoryIds = new Set<string>();
  for (const [index, value] of values.entries()) {
    const path = `documents[${index}]`;
    if (!isRecord(value)) { issues.push(`${path} is not an object`); continue; }
    const unknown = Object.keys(value).filter((field) => !DOCUMENT_FIELDS.has(field));
    if (unknown.length > 0) issues.push(`${path} has unsupported field(s): ${unknown.join(", ")}`);
    const { _id, _type, categoryId, parent, slug, label, description, order } = value;
    if (typeof _id !== "string" || _id.length > DOCUMENT_ID_MAX_LENGTH || !DOCUMENT_ID_PATTERN.test(_id)) issues.push(`${path}._id must be a migrated category identifier`);
    if (_type !== "category") issues.push(`${path}._type must be "category"`);
    if (typeof categoryId !== "string" || !ID_PATTERN.test(categoryId)) issues.push(`${path}.categoryId is not a lowercase hyphenated identity`);
    if (!Number.isSafeInteger(order)) issues.push(`${path}.order must be a safe integer`);
    let parsedParent: CategoryWriteDocument["parent"];
    if (parent !== undefined) {
      if (!isRecord(parent) || parent._type !== "reference" || typeof parent._ref !== "string" || parent._ref.trim().length === 0 || Object.keys(parent).some((field) => field !== "_type" && field !== "_ref")) {
        issues.push(`${path}.parent must be a plain category reference`);
      } else {
        parsedParent = { _type: "reference", _ref: parent._ref };
        if (parent._ref === _id) issues.push(`${path} cannot name itself as its parent`);
      }
    }
    const parsedSlug = validateLocalized(slug, "localizedSlug", `${path}.slug`, issues);
    const parsedLabel = validateLocalized(label, "localizedText", `${path}.label`, issues);
    const parsedDescription = validateDescription(description, `${path}.description`, issues);
    if (typeof _id !== "string" || _type !== "category" || typeof categoryId !== "string" || typeof order !== "number" || parsedSlug === undefined || parsedLabel === undefined || (description !== undefined && parsedDescription === undefined)) continue;
    if (ids.has(_id)) issues.push(`document _id "${_id}" is present more than once`);
    ids.add(_id);
    if (categoryIds.has(categoryId)) issues.push(`categoryId "${categoryId}" is present more than once`);
    categoryIds.add(categoryId);
    documents.push({ _id, _type: "category", categoryId, ...(parsedParent === undefined ? {} : { parent: parsedParent }), slug: parsedSlug, label: parsedLabel, ...(parsedDescription === undefined ? {} : { description: parsedDescription }), order });
  }
  issues.push(...categoriesByLanguageIssues(documents));
  return { documents, issues: [...new Set(issues)].sort() };
}

export function validateCategoryWritePlan(raw: unknown): {
  readonly plan?: CategoryWritePlan;
  readonly issues: readonly string[];
} {
  if (!isRecord(raw)) return { issues: ["the plan is not a JSON object"] };
  const issues: string[] = [];
  if (raw.version !== CATEGORY_WRITE_PLAN_VERSION) issues.push(`plan.version must be "${CATEGORY_WRITE_PLAN_VERSION}"`);
  if (!Array.isArray(raw.documents)) return { issues: [...issues, "plan.documents is not an array"] };
  const validated = validateCategoryDocuments(raw.documents);
  if (validated.issues.length > 0) return { issues: [...issues, ...validated.issues] };
  return { plan: { version: CATEGORY_WRITE_PLAN_VERSION, documents: validated.documents }, issues };
}

export function categoryWriteWaves(documents: readonly CategoryWriteDocument[]): readonly (readonly CategoryWriteDocument[])[] {
  const remaining = new Map(documents.map((document) => [document._id, document]));
  const written = new Set<string>();
  const waves: CategoryWriteDocument[][] = [];
  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter((document) => document.parent === undefined || !remaining.has(document.parent._ref) || written.has(document.parent._ref)).sort((left, right) => left._id.localeCompare(right._id));
    if (wave.length === 0) throw new Error("the category graph cannot be ordered into write waves");
    waves.push(wave);
    for (const document of wave) { remaining.delete(document._id); written.add(document._id); }
  }
  return waves;
}

function projectExistingDocument(row: ExistingDocument): CategoryWriteDocument | undefined {
  const validated = validateCategoryDocuments([row]);
  return validated.issues.length === 0 ? validated.documents[0] : undefined;
}

/** Rejects any identity collision or owner edit; an exact previous run is safe. */
export function categoryDatasetIssues(existing: readonly ExistingDocument[], planned: readonly CategoryWriteDocument[]): readonly string[] {
  const issues: string[] = [];
  const plannedById = new Map(planned.map((document) => [document._id, document]));
  const plannedByCategoryId = new Map(planned.map((document) => [document.categoryId, document]));
  for (const row of existing) {
    if (typeof row._id !== "string") continue;
    const publishedId = publishedIdOf(row._id);
    const replacement = plannedById.get(publishedId);
    if (replacement !== undefined) {
      if (row._id.startsWith("drafts.")) issues.push(`planned document "${publishedId}" has an unpublished draft`);
      else {
        const projected = projectExistingDocument(row);
        if (projected === undefined || categoryDocumentsDigest([projected]) !== categoryDocumentsDigest([replacement])) issues.push(`planned document "${publishedId}" already exists with different content`);
      }
      continue;
    }
    if (typeof row.categoryId === "string" && plannedByCategoryId.has(row.categoryId)) {
      issues.push(`categoryId "${row.categoryId}" is already owned by "${publishedId}"`);
    }
  }
  return [...new Set(issues)].sort();
}

async function preflight(connection: SeedConnection, documents: readonly CategoryWriteDocument[]): Promise<readonly string[]> {
  const result = await runSeedQuery(connection, {
    perspective: "raw",
    query: `*[_type == "category"]{_id, _type, categoryId, parent, slug, label, description, order}`,
  });
  if (!Array.isArray(result)) return ["Sanity preflight returned a malformed result"];
  return categoryDatasetIssues(result as readonly ExistingDocument[], documents);
}

async function verifyWritten(connection: SeedConnection, documents: readonly CategoryWriteDocument[]): Promise<boolean> {
  const result = await runSeedQuery(connection, {
    query: `*[_id in $ids]{_id, _type, categoryId, parent, slug, label, description, order}`,
    params: { ids: documents.map((document) => document._id) },
  });
  if (!Array.isArray(result)) return false;
  const validated = validateCategoryDocuments(result);
  return validated.issues.length === 0 && categoryDocumentsDigest(validated.documents) === categoryDocumentsDigest(documents);
}

type Options = { readonly plan: string; readonly approvedDigest?: string; readonly apply: boolean; readonly project?: string; readonly dataset?: string; readonly apiVersion?: string };

export function parseArguments(argv: readonly string[]): Options {
  const known = new Set(["plan", "approved-digest", "project", "dataset", "api-version"]);
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--yes") { apply = true; continue; }
    if (!argument.startsWith("--") || !known.has(argument.slice(2))) throw new Error(`unknown argument "${argument}"`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${argument} needs a value`);
    values.set(argument.slice(2), value); index += 1;
  }
  const plan = values.get("plan");
  if (plan === undefined) throw new Error("--plan <category-write-plan.json> is required");
  return { plan, apply, ...(values.get("approved-digest") === undefined ? {} : { approvedDigest: values.get("approved-digest") }), ...(values.get("project") === undefined ? {} : { project: values.get("project") }), ...(values.get("dataset") === undefined ? {} : { dataset: values.get("dataset") }), ...(values.get("api-version") === undefined ? {} : { apiVersion: values.get("api-version") }) };
}

function requiredValue(value: string | undefined, message: string): string {
  if (value === undefined || value.trim().length === 0) throw new Error(message);
  return value;
}

function migrationToken(): string {
  if (process.env.NEXT_PUBLIC_SANITY_MIGRATION_TOKEN?.trim()) throw new Error("NEXT_PUBLIC_SANITY_MIGRATION_TOKEN must be removed; a write credential must never be public");
  return requiredValue(process.env.SANITY_MIGRATION_TOKEN, "SANITY_MIGRATION_TOKEN is required for --yes");
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const validated = validateCategoryWritePlan(JSON.parse(await readFile(options.plan, "utf8")) as unknown);
  if (validated.plan === undefined) throw new Error(`category plan failed ${validated.issues.length} check(s): ${validated.issues.join("; ")}`);
  const { documents } = validated.plan;
  const digest = categoryDocumentsDigest(documents);
  const waves = categoryWriteWaves(documents);
  console.log(`Category plan valid: ${documents.length} document(s), ${waves.length} dependency wave(s).`);
  console.log(`Approved digest: ${digest}`);
  if (!options.apply) { console.log("Dry run only — no network request was made."); return; }
  if (options.approvedDigest === undefined || !DIGEST_PATTERN.test(options.approvedDigest)) throw new Error("--approved-digest <sha256> is required with --yes");
  if (options.approvedDigest !== digest) throw new Error("the category plan differs from the reviewed dry run; refusing to write");
  const connection = parseSeedConnection({
    projectId: requiredValue(options.project ?? process.env.SANITY_PROJECT_ID, "SANITY_PROJECT_ID is required for --yes (or pass --project)"),
    dataset: requiredValue(options.dataset ?? process.env.SANITY_DATASET, "SANITY_DATASET is required for --yes (or pass --dataset)"),
    apiVersion: requiredValue(options.apiVersion ?? process.env.SANITY_API_VERSION, "SANITY_API_VERSION is required for --yes (or pass --api-version)"),
    token: migrationToken(),
  });
  const issues = await preflight(connection, documents);
  if (issues.length > 0) throw new Error(`target dataset failed ${issues.length} preflight check(s): ${issues.join("; ")}`);
  let batches = 0;
  for (const wave of waves) batches += (await runSeedMutationBatches(connection, wave.map((document) => ({ createIfNotExists: document })))).batchesRun;
  console.log(`Wrote ${documents.length} category document(s) in ${batches} batch(es).`);
  if (!(await verifyWritten(connection, documents))) throw new Error("post-write verification did not read back the approved documents");
  console.log(`Verification PASS: ${documents.length}/${documents.length} document(s).`);
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((cause) => { console.error(`Category write failed: ${cause instanceof Error ? cause.message : String(cause)}`); process.exitCode = 1; });
}
