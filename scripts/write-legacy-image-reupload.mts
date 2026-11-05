/**
 * AB#391, owner-run: `npm run write:legacy-image-reupload -- --plan <published.json> --image-root <dir>
 * --out <new-private-dir> [--sensitive <list>] [--delete-replaced] [--approved-digest <hash> --yes]`.
 *
 * Replaces each planned medium's public asset with one prepared under ADR-0039 decision 8: a JPEG within
 * 2048 px keeps its image data, keywords and the creator's postal address go, everything else stays. A medium on
 * `--sensitive` also loses its location. Without `--yes` it prepares every file and uploads nothing.
 *
 * Each medium is patched under the revision the plan read, so an edit since then stops the run rather
 * than being overwritten. Re-running needs a fresh plan; a medium already holding the prepared asset is
 * skipped, because uploading the same bytes yields the same asset. Every new asset is a new document
 * and old assets stay unless `--delete-replaced` removes each one right after its medium moves, so check the
 * plan's document and storage limits first. The token is `SANITY_MIGRATION_TOKEN`, from the environment.
 */

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

import { createImportMetadataTool, ImportMetadataError, prepareJpegForImport, type ImportMetadataTool } from "./image-import-metadata-edit.mts";
import { parseSensitiveList, reuploadApprovalDigest, type PublishedReuploadPlan, type ReuploadPlanned, assertReuploadPlan } from "./legacy-image-reupload-match.mts";
import { MAX_PUBLIC_DELIVERY_DIMENSION, PUBLIC_DELIVERY_FORMATS } from "./sanity-seed-fixtures.mts";
import { parseSeedConnection, runSeedMutationBatches, uploadSeedImageAsset } from "./sanity-seed-http.mts";

export type ReuploadPort = Readonly<{
  readSource: (sourceLocator: string) => Promise<Uint8Array>;
  upload: (bytes: Uint8Array) => Promise<Readonly<{ assetId: string; width: number; height: number }>>;
  patchAsset: (medium: ReuploadPlanned, assetId: string) => Promise<void>;
  deleteAsset: (assetId: string) => Promise<void>;
}>;

export type ReuploadResult = Readonly<{
  /** `interrupted`: a write failed in a way that says nothing about the next one, so the run stopped. */
  outcome: "prepared" | "written" | "conflict" | "interrupted";
  digest: string;
  prepared: number;
  preparedBytes: number;
  failed: readonly Readonly<{ mediaId: string; code: string }>[];
  written: number;
  alreadyDone: number;
  deleted: number;
  /** Something else still refers to it, so it stayed. */
  keptReferenced: number;
  /**
   * The medium moved but its old asset could not be deleted. A fresh plan knows only the new asset, so
   * this list is the one record of what `--delete-replaced` still owes.
   */
  undeleted: readonly Readonly<{ mediaId: string; assetRef: string }>[];
}>;

const codeOf = (error: unknown): string => (error instanceof ImportMetadataError ? error.code : typeof (error as { code?: unknown }).code === "string" ? (error as { code: string }).code : "PREPARATION_FAILED");

/** Bytes a re-run would refuse should stop this run too, so preparing never trusts the plan's hash. */
async function prepare(row: ReuploadPlanned, sensitive: boolean, port: ReuploadPort, tool: ImportMetadataTool) {
  const source = await port.readSource(row.sourceLocator);
  if (createHash("sha256").update(source).digest("hex") !== row.contentHash) throw Object.assign(new Error("changed"), { code: "SOURCE_CHANGED" });
  const { bytes } = await prepareJpegForImport(source, tool, { removeLocation: sensitive });
  const { width, height } = await sharp(bytes).metadata();
  return { bytes, width, height };
}

export async function runLegacyImageReupload(
  plan: PublishedReuploadPlan,
  sensitive: ReadonlySet<string>,
  port: ReuploadPort,
  tool: ImportMetadataTool,
  options: Readonly<{ yes?: boolean; approvedDigest?: string; deleteReplaced?: boolean }> = {},
): Promise<ReuploadResult> {
  assertReuploadPlan(plan);
  const digest = reuploadApprovalDigest(plan.planned, sensitive, options.deleteReplaced === true);
  if (options.yes === true && options.approvedDigest !== digest) throw new Error("DIGEST_MISMATCH");
  const failed: { mediaId: string; code: string }[] = [];
  const undeleted: { mediaId: string; assetRef: string }[] = [];
  let prepared = 0, preparedBytes = 0, written = 0, alreadyDone = 0, deleted = 0, keptReferenced = 0;
  const totals = () => ({ digest, prepared, preparedBytes, failed, written, alreadyDone, deleted, keptReferenced, undeleted });
  // One at a time, so no more than one prepared photograph is held in memory.
  for (const row of plan.planned) {
    let output: Awaited<ReturnType<typeof prepare>>;
    try {
      output = await prepare(row, sensitive.has(row.mediaId), port, tool);
    } catch (error) {
      failed.push({ mediaId: row.mediaId, code: codeOf(error) });
      continue;
    }
    prepared += 1;
    preparedBytes += output.bytes.length;
    if (options.yes !== true) continue;
    let uploaded: Awaited<ReturnType<ReuploadPort["upload"]>>;
    try {
      uploaded = await port.upload(output.bytes);
    } catch {
      failed.push({ mediaId: row.mediaId, code: "WRITE_INTERRUPTED" });
      return { outcome: "interrupted", ...totals() };
    }
    if (uploaded.width !== output.width || uploaded.height !== output.height) {
      failed.push({ mediaId: row.mediaId, code: "UPLOADED_DIMENSIONS_DIFFER" });
      continue;
    }
    if (uploaded.assetId === row.assetRef) {
      alreadyDone += 1;
      continue;
    }
    try {
      await port.patchAsset(row, uploaded.assetId);
    } catch (error) {
      if ((error as { status?: unknown }).status === 409) return { outcome: "conflict", ...totals() };
      failed.push({ mediaId: row.mediaId, code: "WRITE_INTERRUPTED" });
      return { outcome: "interrupted", ...totals() };
    }
    written += 1;
    if (options.deleteReplaced === true && row.assetRef !== null) {
      try {
        await port.deleteAsset(row.assetRef);
        deleted += 1;
      } catch (error) {
        // Sanity refuses to delete an asset something still refers to. That is the outcome wanted.
        if ((error as { status?: unknown }).status === 409) keptReferenced += 1;
        else undeleted.push({ mediaId: row.mediaId, assetRef: row.assetRef });
      }
    }
  }
  return { outcome: options.yes === true ? "written" : "prepared", ...totals() };
}

export function parseArguments(argv: readonly string[]) {
  const values = new Map<string, string>();
  let yes = false, deleteReplaced = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--yes") { yes = true; continue; }
    if (name === "--delete-replaced") { deleteReplaced = true; continue; }
    const value = argv[++index];
    if (!["--plan", "--image-root", "--out", "--sensitive", "--approved-digest"].includes(name) || values.has(name) || !value || value.startsWith("--")) throw new Error("ARGUMENTS_INVALID");
    values.set(name, value);
  }
  const plan = values.get("--plan"), imageRoot = values.get("--image-root"), out = values.get("--out");
  if (!plan || !imageRoot || !out) throw new Error("ARGUMENTS_INVALID");
  if (yes && !values.has("--approved-digest")) throw new Error("APPROVED_DIGEST_REQUIRED");
  return { plan, imageRoot, out, sensitive: values.get("--sensitive"), approvedDigest: values.get("--approved-digest"), yes, deleteReplaced };
}

/** A locator comes from a private plan, but it still must not walk out of the image root. */
export function resolveSource(imageRoot: string, sourceLocator: string): string {
  const root = path.resolve(imageRoot), full = path.resolve(root, sourceLocator);
  if (!full.startsWith(`${root}${path.sep}`)) throw Object.assign(new Error("outside"), { code: "SOURCE_OUTSIDE_ROOT" });
  return full;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") throw new Error(`${name}_REQUIRED`);
  return value;
}

export async function main(argv: readonly string[]): Promise<ReuploadResult> {
  const options = parseArguments(argv);
  const plan = JSON.parse(await readFile(options.plan, "utf8")) as PublishedReuploadPlan;
  assertReuploadPlan(plan);
  const sensitive = options.sensitive === undefined ? new Set<string>() : parseSensitiveList(await readFile(options.sensitive, "utf8"), plan.planned);
  const out = path.resolve(options.out);
  await mkdir(out, { mode: 0o700 });
  const connection = options.yes ? parseSeedConnection({
    projectId: requiredEnvironment("SANITY_PROJECT_ID"),
    dataset: requiredEnvironment("SANITY_DATASET"),
    apiVersion: requiredEnvironment("SANITY_API_VERSION"),
    token: requiredEnvironment("SANITY_MIGRATION_TOKEN"),
  }) : undefined;
  const port: ReuploadPort = {
    readSource: async (sourceLocator) => new Uint8Array(await readFile(resolveSource(options.imageRoot, sourceLocator))),
    upload: async (bytes) => uploadSeedImageAsset(connection!, { bytes, contentType: "image/jpeg" }, { maxDimension: MAX_PUBLIC_DELIVERY_DIMENSION, formatsByExtension: PUBLIC_DELIVERY_FORMATS }),
    patchAsset: async (medium, assetId) => {
      await runSeedMutationBatches(connection!, [{ patch: { id: medium._id, ifRevisionID: medium._rev, set: { "image.asset._ref": assetId } } }], { batchSize: 1 });
    },
    deleteAsset: async (assetId) => {
      await runSeedMutationBatches(connection!, [{ delete: { id: assetId } }], { batchSize: 1 });
    },
  };
  const tool = createImportMetadataTool();
  try {
    const result = await runLegacyImageReupload(plan, sensitive, port, tool, { yes: options.yes, deleteReplaced: options.deleteReplaced, ...(options.approvedDigest === undefined ? {} : { approvedDigest: options.approvedDigest }) });
    await writeFile(path.join(out, "legacy-image-reupload-result.json"), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    return result;
  } finally {
    await tool.end();
  }
}

/** A run with failures is not a finished run, even though it reports what it did. */
export function reuploadExitCode(result: Pick<ReuploadResult, "outcome" | "failed" | "undeleted">): number {
  if (result.outcome === "conflict") return 3;
  return result.outcome === "interrupted" || result.failed.length > 0 || result.undeleted.length > 0 ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (result) => { console.log(JSON.stringify({ ...result, failed: result.failed.length, undeleted: result.undeleted.length })); process.exitCode = reuploadExitCode(result); },
    (error: Error) => { console.error(`[write-legacy-image-reupload] ${error.message}`); process.exitCode = 2; },
  );
}
