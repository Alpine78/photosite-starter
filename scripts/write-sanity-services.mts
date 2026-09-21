#!/usr/bin/env node
/**
 * Writes an owner-approved set of localized service documents to Sanity.
 *
 * Dry-run is the default and performs no network request. A real write needs
 * both `--yes` and the SHA-256 digest printed by the reviewed dry run. The
 * digest is recomputed from normalized documents, so editing the plan after
 * approval makes the write fail before a credential is read.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

import {
  parseSeedConnection,
  runSeedMutationBatches,
  runSeedQuery,
  type SeedConnection,
} from "./sanity-seed-http.mts";

export const SERVICE_WRITE_PLAN_VERSION = "sanity-service-write-plan-v1";

const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const LANGUAGE_PATTERN = /^[a-z]{2,3}$/u;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u;
const DOCUMENT_ID_MAX_LENGTH = 128;
const DOCUMENT_FIELDS = new Set([
  "_id",
  "_type",
  "serviceId",
  "language",
  "parentServiceId",
  "slug",
  "name",
  "shortDescription",
  "description",
  "order",
]);

export type ServiceWriteDocument = {
  readonly _id: string;
  readonly _type: "service";
  readonly serviceId: string;
  readonly language: string;
  readonly parentServiceId?: string;
  readonly slug: string;
  readonly name: string;
  readonly shortDescription: string;
  readonly description: readonly string[];
  readonly order: number;
};

export type ServiceWritePlan = {
  readonly version: typeof SERVICE_WRITE_PLAN_VERSION;
  readonly documents: readonly ServiceWriteDocument[];
};

type ExistingDocument = {
  readonly _id?: unknown;
  readonly _type?: unknown;
  readonly serviceId?: unknown;
  readonly language?: unknown;
  readonly parentServiceId?: unknown;
  readonly slug?: unknown;
  readonly name?: unknown;
  readonly shortDescription?: unknown;
  readonly description?: unknown;
  readonly order?: unknown;
  readonly coverMedia?: unknown;
  readonly startingPrice?: unknown;
  readonly pricing?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function publishedIdOf(id: string): string {
  return id.startsWith("drafts.") ? id.slice("drafts.".length) : id;
}

function normalizedDocument(document: ServiceWriteDocument) {
  return {
    _id: document._id,
    _type: document._type,
    serviceId: document.serviceId,
    language: document.language,
    ...(document.parentServiceId === undefined
      ? {}
      : { parentServiceId: document.parentServiceId }),
    slug: document.slug,
    name: document.name,
    shortDescription: document.shortDescription,
    description: [...document.description],
    order: document.order,
  };
}

function projectedExistingDocument(
  row: ExistingDocument,
): ServiceWriteDocument | undefined {
  if (
    typeof row._id !== "string" ||
    row._type !== "service" ||
    typeof row.serviceId !== "string" ||
    typeof row.language !== "string" ||
    typeof row.slug !== "string" ||
    typeof row.name !== "string" ||
    typeof row.shortDescription !== "string" ||
    !Array.isArray(row.description) ||
    !row.description.every((paragraph) => typeof paragraph === "string") ||
    typeof row.order !== "number"
  ) {
    return undefined;
  }
  return {
    _id: row._id,
    _type: "service",
    serviceId: row.serviceId,
    language: row.language,
    ...(typeof row.parentServiceId === "string"
      ? { parentServiceId: row.parentServiceId }
      : {}),
    slug: row.slug,
    name: row.name,
    shortDescription: row.shortDescription,
    description: row.description,
    order: row.order,
  };
}

export function serviceDocumentsDigest(
  documents: readonly ServiceWriteDocument[],
): string {
  const normalized = [...documents]
    .sort((left, right) => left._id.localeCompare(right._id))
    .map(normalizedDocument);
  return createHash("sha256")
    .update(JSON.stringify(normalized), "utf8")
    .digest("hex");
}

function validateRouteGraph(
  documents: readonly ServiceWriteDocument[],
): readonly string[] {
  const issues: string[] = [];
  const byLanguage = new Map<string, Map<string, ServiceWriteDocument>>();

  for (const document of documents) {
    const services = byLanguage.get(document.language) ?? new Map();
    if (services.has(document.serviceId)) {
      issues.push(
        `${document.language} serviceId "${document.serviceId}" is present more than once`,
      );
    } else {
      services.set(document.serviceId, document);
    }
    byLanguage.set(document.language, services);
  }

  for (const [language, services] of byLanguage) {
    const siblingSlugs = new Set<string>();
    for (const document of services.values()) {
      if (
        document.parentServiceId !== undefined &&
        !services.has(document.parentServiceId)
      ) {
        issues.push(
          `${language} service "${document.serviceId}" names missing parent "${document.parentServiceId}"`,
        );
      }
      const siblingKey = `${document.parentServiceId ?? ""}\u0000${document.slug}`;
      if (siblingSlugs.has(siblingKey)) {
        issues.push(
          `${language} sibling slug "${document.slug}" is present more than once below "${document.parentServiceId ?? "root"}"`,
        );
      }
      siblingSlugs.add(siblingKey);
    }

    const resolved = new Set<string>();
    const resolving = new Set<string>();
    const visit = (serviceId: string): void => {
      if (resolved.has(serviceId)) return;
      if (resolving.has(serviceId)) {
        issues.push(`${language} service parent graph contains a cycle at "${serviceId}"`);
        return;
      }
      const document = services.get(serviceId);
      if (document === undefined) return;
      resolving.add(serviceId);
      if (document.parentServiceId !== undefined) visit(document.parentServiceId);
      resolving.delete(serviceId);
      resolved.add(serviceId);
    };
    for (const serviceId of services.keys()) visit(serviceId);
  }

  return issues;
}

export function validateServiceDocuments(
  values: readonly unknown[],
): {
  readonly documents: readonly ServiceWriteDocument[];
  readonly issues: readonly string[];
} {
  const documents: ServiceWriteDocument[] = [];
  const issues: string[] = [];
  const ids = new Set<string>();

  for (const [index, value] of values.entries()) {
    const path = `documents[${index}]`;
    if (!isRecord(value)) {
      issues.push(`${path} is not an object`);
      continue;
    }
    const unknownFields = Object.keys(value).filter(
      (field) => !DOCUMENT_FIELDS.has(field),
    );
    if (unknownFields.length > 0) {
      issues.push(`${path} has unsupported field(s): ${unknownFields.join(", ")}`);
    }

    const {
      _id,
      _type,
      serviceId,
      language,
      parentServiceId,
      slug,
      name,
      shortDescription,
      description,
      order,
    } = value;
    if (typeof _id !== "string" || _id.length > DOCUMENT_ID_MAX_LENGTH) {
      issues.push(`${path} needs a string _id no longer than 128 characters`);
    }
    if (_type !== "service") issues.push(`${path}._type must be "service"`);
    if (typeof serviceId !== "string" || !ID_PATTERN.test(serviceId)) {
      issues.push(`${path}.serviceId is not a lowercase hyphenated identity`);
    }
    if (typeof language !== "string" || !LANGUAGE_PATTERN.test(language)) {
      issues.push(`${path}.language is not a two- or three-letter language subtag`);
    }
    if (
      parentServiceId !== undefined &&
      (typeof parentServiceId !== "string" || !ID_PATTERN.test(parentServiceId))
    ) {
      issues.push(`${path}.parentServiceId is not a lowercase hyphenated identity`);
    }
    if (
      typeof serviceId === "string" &&
      parentServiceId === serviceId
    ) {
      issues.push(`${path} cannot name itself as its parent`);
    }
    if (typeof slug !== "string" || !ID_PATTERN.test(slug)) {
      issues.push(`${path}.slug is not a lowercase hyphenated segment`);
    }
    for (const [field, text] of [
      ["name", name],
      ["shortDescription", shortDescription],
    ] as const) {
      if (typeof text !== "string" || text.trim().length === 0) {
        issues.push(`${path}.${field} must be a non-empty string`);
      }
    }
    if (
      !Array.isArray(description) ||
      description.length === 0 ||
      !description.every(
        (paragraph) =>
          typeof paragraph === "string" && paragraph.trim().length > 0,
      )
    ) {
      issues.push(`${path}.description must contain non-empty paragraphs`);
    }
    if (!Number.isSafeInteger(order)) {
      issues.push(`${path}.order must be a safe integer`);
    }

    if (
      typeof _id !== "string" ||
      _type !== "service" ||
      typeof serviceId !== "string" ||
      typeof language !== "string" ||
      typeof slug !== "string" ||
      typeof name !== "string" ||
      typeof shortDescription !== "string" ||
      !Array.isArray(description) ||
      !description.every((paragraph) => typeof paragraph === "string") ||
      typeof order !== "number"
    ) {
      continue;
    }

    const expectedId = `migrated--service--${serviceId}--${language}`;
    if (_id !== expectedId) {
      issues.push(`${path}._id must be "${expectedId}"`);
    }
    if (ids.has(_id)) issues.push(`document _id "${_id}" is present more than once`);
    ids.add(_id);
    documents.push({
      _id,
      _type,
      serviceId,
      language,
      ...(typeof parentServiceId === "string" ? { parentServiceId } : {}),
      slug,
      name,
      shortDescription,
      description,
      order,
    });
  }

  issues.push(...validateRouteGraph(documents));
  return { documents, issues: [...new Set(issues)].sort() };
}

export function validateServiceWritePlan(raw: unknown): {
  readonly plan?: ServiceWritePlan;
  readonly issues: readonly string[];
} {
  if (!isRecord(raw)) return { issues: ["the plan is not a JSON object"] };
  const issues: string[] = [];
  if (raw.version !== SERVICE_WRITE_PLAN_VERSION) {
    issues.push(
      `plan.version must be "${SERVICE_WRITE_PLAN_VERSION}"`,
    );
  }
  if (!Array.isArray(raw.documents)) {
    issues.push("plan.documents is not an array");
    return { issues };
  }
  const validated = validateServiceDocuments(raw.documents);
  issues.push(...validated.issues);
  if (issues.length > 0) return { issues };
  return {
    plan: {
      version: SERVICE_WRITE_PLAN_VERSION,
      documents: validated.documents,
    },
    issues: [],
  };
}

export function serviceWriteWaves(
  documents: readonly ServiceWriteDocument[],
): readonly (readonly ServiceWriteDocument[])[] {
  const remaining = new Map(
    documents.map((document) => [
      `${document.language}:${document.serviceId}`,
      document,
    ]),
  );
  const written = new Set<string>();
  const waves: ServiceWriteDocument[][] = [];

  while (remaining.size > 0) {
    const wave = [...remaining.entries()]
      .filter(([, document]) => {
        if (document.parentServiceId === undefined) return true;
        return written.has(`${document.language}:${document.parentServiceId}`);
      })
      .map(([, document]) => document)
      .sort((left, right) => left._id.localeCompare(right._id));
    if (wave.length === 0) {
      throw new Error("the service graph cannot be ordered into write waves");
    }
    waves.push(wave);
    for (const document of wave) {
      const key = `${document.language}:${document.serviceId}`;
      remaining.delete(key);
      written.add(key);
    }
  }
  return waves;
}

export function serviceDatasetIssues(
  existing: readonly ExistingDocument[],
  planned: readonly ServiceWriteDocument[],
): readonly string[] {
  const issues: string[] = [];
  const plannedById = new Map(planned.map((document) => [document._id, document]));
  const foreignServices: ServiceWriteDocument[] = [];

  for (const row of existing) {
    if (typeof row._id !== "string") continue;
    const publishedId = publishedIdOf(row._id);
    const replacement = plannedById.get(publishedId);
    if (replacement !== undefined) {
      if (row._id.startsWith("drafts.")) {
        issues.push(`planned document "${publishedId}" has an unpublished draft`);
      } else if (
        row._type !== "service" ||
        row.serviceId !== replacement.serviceId ||
        row.language !== replacement.language
      ) {
        issues.push(`planned _id "${publishedId}" already carries another identity`);
      } else {
        const projected = projectedExistingDocument(row);
        const hasFieldsOutsidePlan =
          row.coverMedia !== undefined ||
          row.startingPrice !== undefined ||
          row.pricing !== undefined;
        if (
          hasFieldsOutsidePlan ||
          projected === undefined ||
          serviceDocumentsDigest([projected]) !== serviceDocumentsDigest([replacement])
        ) {
          issues.push(
            `planned document "${publishedId}" already exists with different content`,
          );
        }
      }
      continue;
    }
    if (
      row._type === "service" &&
      typeof row.serviceId === "string" &&
      typeof row.language === "string" &&
      typeof row.slug === "string"
    ) {
      foreignServices.push({
        _id: publishedId,
        _type: "service",
        serviceId: row.serviceId,
        language: row.language,
        ...(typeof row.parentServiceId === "string"
          ? { parentServiceId: row.parentServiceId }
          : {}),
        slug: row.slug,
        name: "existing",
        shortDescription: "existing",
        description: ["existing"],
        order: 0,
      });
    }
  }

  issues.push(...validateRouteGraph([...foreignServices, ...planned]));
  return [...new Set(issues)].sort();
}

async function preflight(
  connection: SeedConnection,
  documents: readonly ServiceWriteDocument[],
): Promise<readonly string[]> {
  const publishedIds = documents.map((document) => document._id);
  const ids = [
    ...publishedIds,
    ...publishedIds.map((id) => `drafts.${id}`),
  ];
  const languages = [...new Set(documents.map((document) => document.language))];
  const result = await runSeedQuery(connection, {
    perspective: "raw",
    query: `*[_id in $ids || (_type == "service" && language in $languages)]{
      _id, _type, serviceId, language, parentServiceId, slug,
      name, shortDescription, description, order,
      coverMedia, startingPrice, pricing
    }`,
    params: { ids, languages },
  });
  if (!Array.isArray(result)) return ["Sanity preflight returned a malformed result"];
  return serviceDatasetIssues(result as readonly ExistingDocument[], documents);
}

async function verifyWritten(
  connection: SeedConnection,
  documents: readonly ServiceWriteDocument[],
): Promise<boolean> {
  const result = await runSeedQuery(connection, {
    query: `*[_id in $ids]{
      _id, _type, serviceId, language, parentServiceId, slug,
      name, shortDescription, description, order
    }`,
    params: { ids: documents.map((document) => document._id) },
  });
  if (!Array.isArray(result)) return false;
  const validated = validateServiceDocuments(result);
  return (
    validated.issues.length === 0 &&
    serviceDocumentsDigest(validated.documents) ===
      serviceDocumentsDigest(documents)
  );
}

type Options = {
  readonly plan: string;
  readonly approvedDigest?: string;
  readonly apply: boolean;
  readonly project?: string;
  readonly dataset?: string;
  readonly apiVersion?: string;
};

export function parseArguments(argv: readonly string[]): Options {
  const known = new Set([
    "plan",
    "approved-digest",
    "project",
    "dataset",
    "api-version",
  ]);
  const values = new Map<string, string>();
  let apply = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--yes") {
      apply = true;
      continue;
    }
    if (!argument.startsWith("--") || !known.has(argument.slice(2))) {
      throw new Error(`unknown argument "${argument}"`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`${argument} needs a value`);
    }
    values.set(argument.slice(2), value);
    index += 1;
  }
  const plan = values.get("plan");
  if (plan === undefined) throw new Error("--plan <service-write-plan.json> is required");
  return {
    plan,
    apply,
    ...(values.get("approved-digest") === undefined
      ? {}
      : { approvedDigest: values.get("approved-digest") }),
    ...(values.get("project") === undefined
      ? {}
      : { project: values.get("project") }),
    ...(values.get("dataset") === undefined
      ? {}
      : { dataset: values.get("dataset") }),
    ...(values.get("api-version") === undefined
      ? {}
      : { apiVersion: values.get("api-version") }),
  };
}

function requiredValue(value: string | undefined, message: string): string {
  if (value === undefined || value.trim().length === 0) throw new Error(message);
  return value;
}

function migrationToken(): string {
  if (process.env.NEXT_PUBLIC_SANITY_MIGRATION_TOKEN?.trim()) {
    throw new Error(
      "NEXT_PUBLIC_SANITY_MIGRATION_TOKEN must be removed; a write credential must never be public",
    );
  }
  return requiredValue(
    process.env.SANITY_MIGRATION_TOKEN,
    "SANITY_MIGRATION_TOKEN is required for --yes",
  );
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const text = await readFile(options.plan, "utf8");
  const parsed: unknown = JSON.parse(text);
  const validated = validateServiceWritePlan(parsed);
  if (validated.plan === undefined) {
    throw new Error(
      `service plan failed ${validated.issues.length} check(s): ${validated.issues.join("; ")}`,
    );
  }
  const { documents } = validated.plan;
  const digest = serviceDocumentsDigest(documents);
  const waves = serviceWriteWaves(documents);
  console.log(
    `Service plan valid: ${documents.length} document(s), ${waves.length} dependency wave(s).`,
  );
  console.log(`Approved digest: ${digest}`);

  if (!options.apply) {
    console.log("Dry run only — no network request was made.");
    return;
  }
  if (options.approvedDigest === undefined || !DIGEST_PATTERN.test(options.approvedDigest)) {
    throw new Error("--approved-digest <sha256> is required with --yes");
  }
  if (options.approvedDigest !== digest) {
    throw new Error(
      "the service plan differs from the reviewed dry run; refusing to write",
    );
  }

  const connection = parseSeedConnection({
    projectId: requiredValue(
      options.project ?? process.env.SANITY_PROJECT_ID,
      "SANITY_PROJECT_ID is required for --yes (or pass --project)",
    ),
    dataset: requiredValue(
      options.dataset ?? process.env.SANITY_DATASET,
      "SANITY_DATASET is required for --yes (or pass --dataset)",
    ),
    apiVersion: requiredValue(
      options.apiVersion ?? process.env.SANITY_API_VERSION,
      "SANITY_API_VERSION is required for --yes (or pass --api-version)",
    ),
    token: migrationToken(),
  });

  const preflightIssues = await preflight(connection, documents);
  if (preflightIssues.length > 0) {
    throw new Error(
      `target dataset failed ${preflightIssues.length} preflight check(s): ${preflightIssues.join("; ")}`,
    );
  }

  let batches = 0;
  for (const wave of waves) {
    const result = await runSeedMutationBatches(
      connection,
      wave.map((document) => ({ createIfNotExists: document })),
    );
    batches += result.batchesRun;
  }
  console.log(`Wrote ${documents.length} service document(s) in ${batches} batch(es).`);
  if (!(await verifyWritten(connection, documents))) {
    throw new Error("post-write verification did not read back the approved documents");
  }
  console.log(`Verification PASS: ${documents.length}/${documents.length} document(s).`);
}

if (import.meta.main) {
  main().catch((cause) => {
    console.error(
      `Service write failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    process.exitCode = 1;
  });
}
