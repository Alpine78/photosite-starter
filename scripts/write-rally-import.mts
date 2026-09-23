/**
 * AB#168: `npm run write:rally -- --plan <plan> --folder <rally folder> --out <dir> --approved-digest <hash> [--yes]`.
 *
 * Writes an approved rally import plan (`npm run plan:rally`, AB#167) to
 * Sanity. `rally-import-write.mts` decides everything; this file performs the
 * reads, uploads, and writes, in this order:
 *
 * 1. Load the plan, validate its contract, and recompute its digest against
 *    `--approved-digest` — never against the plan's own `documentsDigest`.
 * 2. Re-read every file, check its SHA-256 against the plan, and generate the
 *    public derivative (EXIF/GPS stripped, never cropped or upscaled) whose
 *    dimensions must equal the planned ones. Nothing is kept in memory past
 *    each file.
 * 3. **Without `--yes`, stop.** No credential has been read and no network
 *    request has been made.
 * 4. Resolve the category, read the preflight snapshot (raw perspective, so
 *    drafts count), and refuse the whole write on any collision.
 * 5. Upload each derivative, then write media, then galleries.
 * 6. Read back the galleries and the gallery's photograph count.
 *
 * The write token is `SANITY_MIGRATION_TOKEN`, from the environment only. A
 * `NEXT_PUBLIC_` mirror of it is refused. Reports are private files under
 * `--out`; the console carries counts only.
 */

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { generatePublicDerivative, type PublicDerivative } from "./joomla-image-derivative.mts";
import type { RallyAssetRequirement, RallyImportPlan } from "./rally-import-plan.mts";
import {
  buildRallyWriteMutations,
  evaluateRallyPreflight,
  evaluateRallyReadBack,
  recomputeRallyPlanDigest,
  validateRallyPlanContract,
  type ExistingDocument,
  type RallyPreflightSnapshot,
} from "./rally-import-write.mts";
import { MAX_PUBLIC_DELIVERY_DIMENSION, PUBLIC_DELIVERY_FORMATS } from "./sanity-seed-fixtures.mts";
import {
  parseSeedConnection,
  runSeedMutationBatches,
  runSeedQuery,
  uploadSeedImageAsset,
  type SeedConnection,
} from "./sanity-seed-http.mts";
import {
  chunkIdsByByteBudget,
  resolveCategoryReferences,
  resolveContainedSourcePath,
} from "./write-joomla-content.mts";

class RallyWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RallyWriteError";
  }
}

function fail(message: string): never {
  throw new RallyWriteError(message);
}

export type Options = {
  readonly plan: string;
  readonly folder: string;
  readonly out: string;
  readonly approvedDigest: string;
  readonly apply: boolean;
  readonly project?: string;
  readonly dataset?: string;
  readonly apiVersion?: string;
};

const KNOWN_OPTIONS = new Set(["plan", "folder", "out", "approved-digest", "project", "dataset", "api-version"]);

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
  const folder = values.get("folder");
  const out = values.get("out");
  const approvedDigest = values.get("approved-digest");
  if (plan === undefined) fail("--plan <rally-import-plan.json> is required");
  if (folder === undefined) fail("--folder <rally folder> is required");
  if (out === undefined) fail("--out <report folder> is required");
  if (approvedDigest === undefined || !/^[0-9a-f]{64}$/u.test(approvedDigest)) {
    fail("--approved-digest <sha256> is required — the documentsDigest plan:rally printed for the plan you reviewed");
  }
  return {
    plan,
    folder,
    out,
    approvedDigest,
    apply,
    ...(values.get("project") === undefined ? {} : { project: values.get("project") as string }),
    ...(values.get("dataset") === undefined ? {} : { dataset: values.get("dataset") as string }),
    ...(values.get("api-version") === undefined ? {} : { apiVersion: values.get("api-version") as string }),
  };
}

function requiredSetting(value: string | undefined, envName: string, flagName: string): string {
  const resolved = value ?? process.env[envName];
  if (resolved === undefined || resolved.trim().length === 0) fail(`${envName} is required (or pass --${flagName})`);
  return resolved;
}

/** The write token is never a flag, so it never lands in shell history or a process listing. */
function requiredToken(envName: string): string {
  if (process.env[`NEXT_PUBLIC_${envName}`]?.trim()) {
    fail(
      `NEXT_PUBLIC_${envName} is set: a NEXT_PUBLIC_ value is compiled into the browser bundle, so this write credential must never use that name. Remove it and set ${envName} instead.`,
    );
  }
  const value = process.env[envName];
  if (value === undefined || value.trim().length === 0) fail(`${envName} is required (this tool never accepts a token as a flag)`);
  return value;
}

async function writeReport(outDir: string, fileName: string, data: unknown): Promise<string> {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await chmod(outDir, 0o700);
  const filePath = path.join(outDir, fileName);
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
  return filePath;
}

type DerivedAsset =
  | { readonly ok: true; readonly derivative: PublicDerivative }
  | { readonly ok: false; readonly reason: string };

/**
 * Reads the file once, checks it is the file the plan approved, and derives the
 * public copy. The derivative must keep the planned dimensions: the plan was
 * approved against them, and a file under the ceiling is never resized.
 */
async function deriveAsset(folder: string, requirement: RallyAssetRequirement): Promise<DerivedAsset> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(await resolveContainedSourcePath(folder, requirement.relativePath)));
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== requirement.contentHash) {
    return { ok: false, reason: "the file has changed since the plan was made — re-run plan:rally and review again" };
  }
  let derivative: PublicDerivative;
  try {
    derivative = await generatePublicDerivative(bytes);
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const metadata = await sharp(derivative.bytes).metadata();
  if (metadata.width !== requirement.width || metadata.height !== requirement.height) {
    return {
      ok: false,
      reason: `the public copy is ${metadata.width}×${metadata.height}, the plan says ${requirement.width}×${requirement.height}`,
    };
  }
  return { ok: true, derivative };
}

async function queryChunked<T>(
  connection: SeedConnection,
  ids: readonly string[],
  query: string,
  extraParams: Readonly<Record<string, unknown>> = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (const chunk of chunkIdsByByteBudget(ids)) {
    const result = await runSeedQuery(connection, {
      query,
      params: { ids: chunk, ...extraParams },
      perspective: "raw",
    });
    if (!Array.isArray(result)) fail("the dataset answered a preflight query with something other than a list");
    rows.push(...(result as T[]));
  }
  return rows;
}

async function readPreflightSnapshot(
  connection: SeedConnection,
  plan: RallyImportPlan,
  categoryDocumentId: string,
): Promise<RallyPreflightSnapshot> {
  const plannedIds = plan.documents.map((document) => document._id);
  const galleryIds = plan.documents.filter((document) => document._type === "gallery").map((document) => document._id);
  const mediaIds = plan.documents
    .filter((document) => document._type === "media")
    .map((document) => document.mediaId as string);
  const slugs = [...new Set(
    plan.documents.filter((document) => document._type === "gallery").map((document) => document.slug as string),
  )];

  const plannedIdDocuments = await queryChunked<ExistingDocument>(
    connection,
    [...plannedIds, ...plannedIds.map((id) => `drafts.${id}`)],
    `*[_id in $ids]{_id, _type, contentId, language, slug, "categoryRef": canonicalCategory._ref, orderingRule, mediaId, sections, "hasCover": defined(cover)}`,
  );
  const mediaIdClaims = await queryChunked<{ _id: string; mediaId: string }>(
    connection,
    mediaIds,
    `*[_type == "media" && mediaId in $ids]{_id, mediaId}`,
  );
  const single = async (query: string, params: Readonly<Record<string, unknown>>): Promise<unknown> =>
    runSeedQuery(connection, { query, params, perspective: "raw" });

  const rest = (await single(
    `{
      "contentIdClaims": *[_type in ["gallery", "article"] && contentId == $contentId]{_id, _type},
      "routeClaims": *[_type in ["gallery", "article"] && canonicalCategory._ref == $category && slug in $slugs]{_id, language, slug},
      "childCategories": *[_type == "category" && parent._ref == $category]{_id, slug},
      "placementCount": count(*[_type == "galleryPlacement" && gallery._ref in $galleryIds]),
      "memberMedia": *[_type == "media" && captureSequence.galleryContentId == $contentId]{_id, mediaId}
    }`,
    { contentId: plan.contentId, category: categoryDocumentId, slugs, galleryIds },
  )) as Omit<RallyPreflightSnapshot, "plannedIdDocuments" | "mediaIdClaims"> | null;
  if (rest === null || typeof rest !== "object") fail("the dataset answered the preflight query unexpectedly");

  return {
    plannedIdDocuments,
    mediaIdClaims,
    contentIdClaims: rest.contentIdClaims ?? [],
    routeClaims: rest.routeClaims ?? [],
    childCategories: rest.childCategories ?? [],
    placementCount: typeof rest.placementCount === "number" ? rest.placementCount : 0,
    memberMedia: rest.memberMedia ?? [],
  };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const folder = path.resolve(options.folder);

  // --- 1: the plan, and proof it is the reviewed one ---
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(options.plan, "utf8"));
  } catch {
    fail(`could not read ${options.plan} as JSON`);
  }
  const { plan, issues } = validateRallyPlanContract(raw);
  if (plan === undefined) {
    const reportPath = await writeReport(options.out, "rally-plan-validation-errors.json", issues);
    console.error(`The plan failed ${issues.length} contract check(s). See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }
  const digest = recomputeRallyPlanDigest(plan);
  if (digest !== options.approvedDigest) {
    fail("the plan's content does not match --approved-digest — this is not the exact plan that was reviewed");
  }

  // --- 2: every file, locally ---
  const failures: { readonly relativePath: string; readonly reason: string }[] = [];
  for (const requirement of plan.assetRequirements) {
    const outcome = await deriveAsset(folder, requirement);
    if (!outcome.ok) failures.push({ relativePath: requirement.relativePath, reason: outcome.reason });
  }
  if (failures.length > 0) {
    const reportPath = await writeReport(options.out, "rally-asset-failures.json", failures);
    console.error(`${failures.length} of ${plan.assetRequirements.length} photograph(s) failed local verification. See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Plan approved and ${plan.assetRequirements.length} photograph(s) verified locally.`);

  // --- 3: dry run ends here ---
  if (!options.apply) {
    console.log("Dry run only — no credential was read and no network request was made. Re-run with --yes to write.");
    return;
  }

  const connection = parseSeedConnection({
    projectId: requiredSetting(options.project, "SANITY_PROJECT_ID", "project"),
    dataset: requiredSetting(options.dataset, "SANITY_DATASET", "dataset"),
    apiVersion: requiredSetting(options.apiVersion, "SANITY_API_VERSION", "api-version"),
    token: requiredToken("SANITY_MIGRATION_TOKEN"),
  });

  // --- 4: category and preflight ---
  const categoryResolution = await resolveCategoryReferences(
    connection,
    [{ categoryId: plan.canonicalCategory }],
    new Map([[plan.canonicalCategory, new Set(plan.languages)]]),
  );
  const categoryDocumentId = categoryResolution.resolved.get(plan.canonicalCategory);
  if (categoryResolution.issues.length > 0 || categoryDocumentId === undefined) {
    const reportPath = await writeReport(options.out, "rally-category-issues.json", categoryResolution.issues);
    console.error(`The category could not be used. See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }
  const preflight = evaluateRallyPreflight(
    plan,
    await readPreflightSnapshot(connection, plan, categoryDocumentId),
    categoryDocumentId,
  );
  if (preflight.collisions.length > 0) {
    const reportPath = await writeReport(options.out, "rally-collisions.json", preflight.collisions);
    console.error(`${preflight.collisions.length} collision(s) with the target dataset; nothing was written. See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }

  // --- 5: upload, then write media before galleries ---
  const assetIdByMediaId = new Map<string, string>();
  for (const requirement of plan.assetRequirements) {
    const outcome = await deriveAsset(folder, requirement);
    if (!outcome.ok) {
      const reportPath = await writeReport(options.out, "rally-upload-failures.json", [
        { relativePath: requirement.relativePath, reason: outcome.reason },
      ]);
      console.error(
        `A file changed during the run after ${assetIdByMediaId.size} upload(s); no document was written. See ${reportPath}.`,
      );
      process.exitCode = 1;
      return;
    }
    const uploaded = await uploadSeedImageAsset(connection, outcome.derivative, {
      maxDimension: MAX_PUBLIC_DELIVERY_DIMENSION,
      formatsByExtension: PUBLIC_DELIVERY_FORMATS,
    });
    assetIdByMediaId.set(requirement.mediaId, uploaded.assetId);
  }
  console.log(`Uploaded ${assetIdByMediaId.size} image(s).`);

  const mutations = buildRallyWriteMutations(plan, {
    categoryDocumentId,
    assetIdByMediaId,
    existingMediaDocumentIds: preflight.existingMediaDocumentIds,
    existingGalleries: preflight.existingGalleries,
  });
  if (mutations.mediaWave.length > 0) await runSeedMutationBatches(connection, mutations.mediaWave);
  if (mutations.galleryWave.length > 0) await runSeedMutationBatches(connection, mutations.galleryWave);
  const { summary } = mutations;
  console.log(
    `Media: ${summary.mediaCreated} created, ${summary.mediaUpdated} updated. Galleries: ${summary.galleriesCreated} created, ${summary.galleriesUpdated} updated (${summary.sectionsAdded} section(s) added).`,
  );

  // --- 6: read back ---
  const galleryIds = plan.documents.filter((document) => document._type === "gallery").map((document) => document._id);
  const readBack = (await runSeedQuery(connection, {
    query: `{
      "galleries": *[_id in $galleryIds]{_id, orderingRule},
      "memberMediaCount": count(*[_type == "media" && captureSequence.galleryContentId == $contentId])
    }`,
    params: { galleryIds, contentId: plan.contentId },
  })) as { galleries?: { _id: string; orderingRule?: string | null }[]; memberMediaCount?: number } | null;
  const readBackIssues = evaluateRallyReadBack(plan, {
    galleries: readBack?.galleries ?? [],
    memberMediaCount: readBack?.memberMediaCount ?? -1,
  });
  await writeReport(options.out, "rally-write-report.json", { summary, readBackIssues });
  if (readBackIssues.length > 0) {
    console.error(`The read-back disagrees with the plan in ${readBackIssues.length} way(s). See ${path.join(options.out, "rally-write-report.json")}.`);
    process.exitCode = 1;
    return;
  }
  console.log("Read-back matches the plan.");
}

// Guarded so importing this module for `parseArguments` does not run the command.
if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((cause: unknown) => {
    console.error(`Rally write failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  });
}
