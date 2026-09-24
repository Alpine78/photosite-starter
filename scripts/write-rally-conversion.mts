/**
 * AB#170: `npm run write:rally-conversion -- --plan <conversion-plan.json> --folder <renamed copy> --out <dir> --approved-digest <hash> --backup-archive <path> [--yes]`.
 *
 * Writes an approved rally gallery conversion (`npm run plan:rally-conversion`,
 * AB#169) to Sanity: existing photographs gain their `captureSequence`, any
 * owner-approved new photographs are created, the old `galleryPlacement`
 * documents are deleted, and both language galleries switch to
 * `orderingRule: capture-sequence`. `rally-conversion-write.mts` decides
 * everything; this file performs the reads, uploads, and writes.
 *
 * 1. Load the plan, validate its contract, and recompute its digest against
 *    `--approved-digest` — never against the plan's own field.
 * 2. Require `--backup-archive`: an existing, non-trivial, recently modified
 *    file — evidence of a `sanity datasets export` taken before this run.
 *    This tool cannot invoke that command itself (`docs/sanity-seeding.md`'s
 *    "Export and recovery" already names it as the owner's own tool), so this
 *    is the one check it *can* make: that some real, recent archive exists.
 * 3. Verify every new photograph's file locally, exactly as `write:rally`
 *    does.
 * 4. **Without `--yes`, stop.** No credential has been read and no network
 *    request has been made.
 * 5. With `--yes`: read a fresh, raw-perspective snapshot of the gallery, its
 *    placements, and the media the plan touches, and reconcile it against the
 *    plan (`reconcileRallyConversion`). Anything the plan did not expect
 *    refuses the whole run before a single mutation is sent. Anything the
 *    plan expected that has already happened — because an earlier run of
 *    this same command was interrupted — is treated as done, not redone.
 * 6. Upload any new photographs' derivatives, then write media (new
 *    documents, then patches), then each gallery's remaining placement
 *    deletions with its `orderingRule` switch folded into the final batch.
 * 7. Read back both galleries and compare with the plan.
 */

import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { generatePublicDerivative, type PublicDerivative } from "./joomla-image-derivative.mts";
import type { RallyConversionPlan } from "./rally-conversion-plan.mts";
import {
  buildGalleryDeletionAndSwitchBatches,
  buildMediaWaves,
  evaluateConversionReadBack,
  publishedIdOf,
  reconcileRallyConversion,
  recomputeConversionPlanDigest,
  validateRallyConversionPlanContract,
  type CurrentGalleryState,
  type CurrentMediaState,
  type RallyConversionSnapshot,
} from "./rally-conversion-write.mts";
import { MAX_PUBLIC_DELIVERY_DIMENSION, PUBLIC_DELIVERY_FORMATS } from "./sanity-seed-fixtures.mts";
import {
  parseSeedConnection,
  runSeedMutationBatches,
  runSeedQuery,
  uploadSeedImageAsset,
  type SeedConnection,
} from "./sanity-seed-http.mts";
import type { RequestOptions } from "./sanity-read-http.mts";
import { chunkIdsByByteBudget, resolveContainedSourcePath } from "./write-joomla-content.mts";

class RallyConversionWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RallyConversionWriteError";
  }
}

function fail(message: string): never {
  throw new RallyConversionWriteError(message);
}

export type Options = {
  readonly plan: string;
  readonly folder: string;
  readonly out: string;
  readonly approvedDigest: string;
  readonly backupArchive: string;
  readonly backupMaxAgeHours: number;
  readonly apply: boolean;
  readonly project?: string;
  readonly dataset?: string;
  readonly apiVersion?: string;
};

const KNOWN_OPTIONS = new Set([
  "plan", "folder", "out", "approved-digest", "backup-archive", "backup-max-age-hours",
  "project", "dataset", "api-version",
]);
const DEFAULT_BACKUP_MAX_AGE_HOURS = 24;
/** Rules out an empty or placeholder file standing in for a real export archive. */
const MIN_BACKUP_ARCHIVE_BYTES = 4096;

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
  const plan = values.get("plan") ?? fail("--plan <conversion-plan.json> is required");
  const folder = values.get("folder") ?? fail("--folder <renamed rally folder> is required");
  const out = values.get("out") ?? fail("--out <report folder> is required");
  const approvedDigest = values.get("approved-digest");
  if (approvedDigest === undefined || !/^[0-9a-f]{64}$/u.test(approvedDigest)) {
    fail("--approved-digest <sha256> is required — the conversionDigest plan:rally-conversion printed for the plan you reviewed");
  }
  const backupArchive = values.get("backup-archive") ?? fail("--backup-archive <path> is required — evidence of a recent `sanity datasets export`");
  let backupMaxAgeHours = DEFAULT_BACKUP_MAX_AGE_HOURS;
  if (values.has("backup-max-age-hours")) {
    const raw = Number(values.get("backup-max-age-hours"));
    if (!Number.isFinite(raw) || raw <= 0) fail("--backup-max-age-hours must be a positive number");
    backupMaxAgeHours = raw;
  }
  return {
    plan,
    folder,
    out,
    approvedDigest,
    backupArchive,
    backupMaxAgeHours,
    apply,
    ...(values.get("project") === undefined ? {} : { project: values.get("project") as string }),
    ...(values.get("dataset") === undefined ? {} : { dataset: values.get("dataset") as string }),
    ...(values.get("api-version") === undefined ? {} : { apiVersion: values.get("api-version") as string }),
  };
}

async function writeReport(outDir: string, fileName: string, data: unknown): Promise<string> {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await chmod(outDir, 0o700);
  const filePath = path.join(outDir, fileName);
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
  return filePath;
}

/**
 * The one check this tool can make on `--backup-archive`: a real, recent,
 * non-trivial file. It cannot confirm the archive is actually an export of
 * *this* dataset — inspecting a Sanity export archive's contents is the
 * owner-run `sanity` CLI's job, not this tool's, and adding that inspection
 * here would mean parsing a third-party archive format this project does not
 * otherwise depend on. Disclosed, not silently assumed.
 */
async function checkBackupArchive(archivePath: string, maxAgeHours: number): Promise<void> {
  let stats: Awaited<ReturnType<typeof stat>>;
  try {
    stats = await stat(archivePath);
  } catch {
    fail(`--backup-archive "${archivePath}" was not found — export the dataset first (see "Export and recovery" in docs/sanity-seeding.md)`);
  }
  if (!stats.isFile()) fail(`--backup-archive "${archivePath}" is not a file`);
  if (stats.size < MIN_BACKUP_ARCHIVE_BYTES) {
    fail(`--backup-archive "${archivePath}" is only ${stats.size} byte(s) — too small to be a real dataset export`);
  }
  const ageHours = (Date.now() - stats.mtimeMs) / (60 * 60 * 1000);
  if (ageHours > maxAgeHours) {
    fail(
      `--backup-archive "${archivePath}" is ${ageHours.toFixed(1)} hour(s) old, past --backup-max-age-hours ${maxAgeHours} — export a fresh one immediately before this run`,
    );
  }
}

type DerivedAsset = { readonly ok: true; readonly derivative: PublicDerivative } | { readonly ok: false; readonly reason: string };

async function deriveAsset(folder: string, requirement: { readonly relativePath: string; readonly contentHash: string }): Promise<DerivedAsset> {
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(await resolveContainedSourcePath(folder, requirement.relativePath)));
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== requirement.contentHash) {
    return { ok: false, reason: "the file has changed since the plan was made — re-run plan:rally-conversion and review again" };
  }
  try {
    return { ok: true, derivative: await generatePublicDerivative(bytes) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

function requiredSetting(value: string | undefined, envName: string, flag: string): string {
  const resolved = value ?? process.env[envName];
  if (resolved === undefined || resolved.trim().length === 0) fail(`${envName} is required (or pass --${flag})`);
  return resolved;
}

function requiredToken(envName: string): string {
  if (process.env[`NEXT_PUBLIC_${envName}`]?.trim()) {
    fail(`NEXT_PUBLIC_${envName} is set: a NEXT_PUBLIC_ value is compiled into the browser bundle, so this write credential must never use that name. Remove it and set ${envName} instead.`);
  }
  const value = process.env[envName];
  if (value === undefined || value.trim().length === 0) fail(`${envName} is required (this tool never accepts a token as a flag)`);
  return value;
}

/**
 * A fresh, raw-perspective snapshot of exactly what the plan touches. Every id
 * list goes into a GET URL, which Sanity caps (`sanity-read-http.mts`'s 11 KiB),
 * so ids are sent in byte-budgeted chunks rather than as one array: a 107-photo
 * gallery already needs 214 ids for media and their drafts, past the cap in a
 * single request. `options` exists so a test can inject a fake transport.
 */
export async function readSnapshot(
  connection: SeedConnection,
  plan: RallyConversionPlan,
  options?: RequestOptions,
): Promise<RallyConversionSnapshot> {
  const galleryIds = plan.galleries.map((gallery) => gallery._id);
  const mediaIds = [
    ...plan.mediaPatches.map((patch) => patch._id),
    ...plan.newMediaDocuments.map((document) => document._id),
  ];
  const draftCandidateIds = [...galleryIds, ...mediaIds].map((id) => `drafts.${id}`);

  const ask = async (query: string, ids: readonly string[]): Promise<readonly unknown[]> => {
    const rows = await runSeedQuery(connection, { query, params: { ids }, perspective: "raw" }, options);
    if (!Array.isArray(rows)) fail("the dataset answered a snapshot query with something other than a list");
    return rows;
  };

  const galleries = (await ask(
    `*[_id in $ids]{
      _id,
      orderingRule,
      "placementIds": *[_type == "galleryPlacement" && gallery._ref == ^._id]._id
    }`,
    galleryIds,
  )) as CurrentGalleryState[];

  const media: CurrentMediaState[] = [];
  for (const ids of chunkIdsByByteBudget(mediaIds)) {
    media.push(...((await ask(`*[_id in $ids]{_id, mediaId, captureSequence}`, ids)) as CurrentMediaState[]));
  }

  const draftIds: string[] = [];
  for (const ids of chunkIdsByByteBudget(draftCandidateIds)) {
    draftIds.push(...((await ask(`*[_id in $ids]._id`, ids)) as string[]));
  }

  return { galleries, media, unpublishedCopyIds: draftIds.map((id) => publishedIdOf(id)) };
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const folder = path.resolve(options.folder);

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(options.plan, "utf8"));
  } catch {
    fail(`could not read ${options.plan} as JSON`);
  }
  const { plan, issues } = validateRallyConversionPlanContract(raw);
  if (plan === undefined) {
    const reportPath = await writeReport(options.out, "rally-conversion-plan-validation-errors.json", issues);
    console.error(`The plan failed ${issues.length} contract check(s). See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }
  const digest = recomputeConversionPlanDigest(plan);
  if (digest !== options.approvedDigest) {
    fail("the plan's content does not match --approved-digest — this is not the exact plan that was reviewed");
  }

  await checkBackupArchive(path.resolve(options.backupArchive), options.backupMaxAgeHours);
  console.log(`Backup archive OK: ${options.backupArchive}`);

  const failures: { readonly relativePath: string; readonly reason: string }[] = [];
  for (const requirement of plan.newAssetRequirements) {
    const outcome = await deriveAsset(folder, requirement);
    if (!outcome.ok) failures.push({ relativePath: requirement.relativePath, reason: outcome.reason });
  }
  if (failures.length > 0) {
    const reportPath = await writeReport(options.out, "rally-conversion-asset-failures.json", failures);
    console.error(`${failures.length} of ${plan.newAssetRequirements.length} new photograph(s) failed local verification. See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `Plan approved. ${plan.mediaPatches.length} existing photograph(s), ${plan.newMediaDocuments.length} new photograph(s) verified locally, ${plan.placementDeletions.length} placement(s) to delete.`,
  );

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

  const snapshot = await readSnapshot(connection, plan);
  const { work, conflicts } = reconcileRallyConversion(plan, snapshot);
  if (conflicts.length > 0) {
    const reportPath = await writeReport(options.out, "rally-conversion-conflicts.json", conflicts);
    console.error(`${conflicts.length} conflict(s) with the current dataset state; nothing was written. See ${reportPath}.`);
    process.exitCode = 1;
    return;
  }
  if (
    work.mediaPatchesRemaining.length === 0 &&
    work.newMediaRemaining.length === 0 &&
    work.deletionsRemainingByGallery.size === 0 &&
    work.galleriesToSwitch.size === 0
  ) {
    console.log("Nothing left to do — an earlier run already completed this conversion.");
  } else {
    console.log(
      `Remaining: ${work.mediaPatchesRemaining.length} photograph patch(es), ${work.newMediaRemaining.length} new photograph(s), ${[...work.deletionsRemainingByGallery.values()].reduce((sum, ids) => sum + ids.length, 0)} placement deletion(s), ${work.galleriesToSwitch.size} gallery switch(es).`,
    );
  }

  const assetIdByMediaId = new Map<string, string>();
  for (const document of work.newMediaRemaining) {
    const mediaId = document.mediaId as string;
    const requirement = plan.newAssetRequirements.find((entry) => entry.mediaId === mediaId);
    if (requirement === undefined) fail(`no asset requirement for new photograph ${mediaId}`);
    const outcome = await deriveAsset(folder, requirement);
    if (!outcome.ok) {
      const reportPath = await writeReport(options.out, "rally-conversion-upload-failures.json", [
        { relativePath: requirement.relativePath, reason: outcome.reason },
      ]);
      console.error(`A file changed during the run; no document was written for it. See ${reportPath}.`);
      process.exitCode = 1;
      return;
    }
    const uploaded = await uploadSeedImageAsset(connection, outcome.derivative, {
      maxDimension: MAX_PUBLIC_DELIVERY_DIMENSION,
      formatsByExtension: PUBLIC_DELIVERY_FORMATS,
    });
    assetIdByMediaId.set(mediaId, uploaded.assetId);
  }

  const { newMediaBatches, patchBatches } = buildMediaWaves(work, assetIdByMediaId);
  for (const batch of newMediaBatches) await runSeedMutationBatches(connection, batch, { batchSize: batch.length });
  for (const batch of patchBatches) await runSeedMutationBatches(connection, batch, { batchSize: batch.length });
  console.log(`Media written: ${newMediaBatches.flat().length} created, ${patchBatches.flat().length} patched.`);

  for (const gallery of plan.galleries) {
    const remaining = work.deletionsRemainingByGallery.get(gallery._id) ?? [];
    const needsSwitch = work.galleriesToSwitch.has(gallery._id);
    if (remaining.length === 0 && !needsSwitch) continue;
    const batches = buildGalleryDeletionAndSwitchBatches(gallery._id, remaining, needsSwitch);
    for (const batch of batches) await runSeedMutationBatches(connection, batch, { batchSize: batch.length });
    console.log(`${gallery._id}: deleted ${remaining.length} placement(s)${needsSwitch ? ", switched to capture-sequence" : ""}.`);
  }

  const readBackResult = (await runSeedQuery(connection, {
    query: `{
      "galleries": *[_id in $galleryIds]{_id, orderingRule},
      "remainingPlacementCount": count(*[_type == "galleryPlacement" && gallery._ref in $galleryIds]),
      "memberMediaCount": count(*[_type == "media" && captureSequence.galleryContentId == $contentId])
    }`,
    params: { galleryIds: plan.galleries.map((gallery) => gallery._id), contentId: plan.contentId },
  })) as { galleries?: { _id: string; orderingRule?: string | null }[]; remainingPlacementCount?: number; memberMediaCount?: number } | null;
  const readBackIssues = evaluateConversionReadBack(plan, {
    galleries: readBackResult?.galleries ?? [],
    remainingPlacementCount: readBackResult?.remainingPlacementCount ?? -1,
    memberMediaCount: readBackResult?.memberMediaCount ?? -1,
  });
  await writeReport(options.out, "rally-conversion-write-report.json", { work: summarizeWork(work), readBackIssues });
  if (readBackIssues.length > 0) {
    console.error(`The read-back disagrees with the plan in ${readBackIssues.length} way(s). See ${path.join(options.out, "rally-conversion-write-report.json")}.`);
    process.exitCode = 1;
    return;
  }
  console.log("Read-back matches the plan. Both galleries are now capture-sequence.");
}

function summarizeWork(work: {
  readonly mediaPatchesRemaining: readonly unknown[];
  readonly newMediaRemaining: readonly unknown[];
  readonly deletionsRemainingByGallery: ReadonlyMap<string, readonly string[]>;
  readonly galleriesToSwitch: ReadonlySet<string>;
}) {
  return {
    mediaPatched: work.mediaPatchesRemaining.length,
    newMediaCreated: work.newMediaRemaining.length,
    placementsDeleted: [...work.deletionsRemainingByGallery.values()].reduce((sum, ids) => sum + ids.length, 0),
    galleriesSwitched: [...work.galleriesToSwitch],
  };
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((cause: unknown) => {
    console.error(`Rally conversion write failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  });
}
