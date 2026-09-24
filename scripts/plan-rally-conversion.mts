/**
 * AB#169: `npm run plan:rally-conversion -- --gallery <contentId> --folder <renamed copy> --artifacts <dir> --out <dir>`.
 *
 * The IO half of planning a placement-based rally gallery's conversion to a
 * capture-sequence gallery (ADR-0022 §7). It reads:
 *
 * - the owner's renamed copy of the gallery's files and its `rally.json`;
 * - every `*.json` import artifact in `--artifacts` that carries
 *   `assetRequirements` (`mediaId`, `contentHash`, `sourceLocator`);
 * - the published gallery, through a **tokenless, published-perspective**
 *   query — nothing a visitor could not already see.
 *
 * `rally-conversion-plan.mts` decides everything. This command writes nothing
 * to Sanity; its plan, report, and deviation list go under `--out` as private
 * files, and the console carries counts and the digest only.
 */

import { randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { listFiles, readJsonFile, scanFile } from "./plan-rally-import.mts";
import {
  buildRallyConversionPlan,
  type ArtifactAsset,
  type ProductionGallery,
  type ProductionSnapshot,
} from "./rally-conversion-plan.mts";
import { parseRallyManifest, RALLY_MANIFEST_FILE, type ScannedFile } from "./rally-import-plan.mts";
import { parsePublicReadTarget, runPublicReadQuery, type PublicReadTarget } from "./sanity-read-http.mts";

const PLAN_FILE = "rally-conversion-plan.json";
const REPORT_FILE = "rally-conversion-report.json";

class RallyConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RallyConversionError";
  }
}

function fail(message: string): never {
  throw new RallyConversionError(message);
}

export type Options = {
  readonly gallery: string;
  readonly folder: string;
  readonly artifacts: string;
  readonly out: string;
  readonly acceptInterleavedSections: boolean;
  readonly acceptRemovedDuplicates: boolean;
  readonly allowNewPhotographs: boolean;
  readonly project?: string;
  readonly dataset?: string;
  readonly apiVersion?: string;
};

const VALUE_OPTIONS = new Set(["gallery", "folder", "artifacts", "out", "project", "dataset", "api-version"]);
const FLAG_OPTIONS = new Set(["accept-interleaved-sections", "accept-removed-duplicates", "allow-new-photographs"]);

export function parseArguments(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (!argument.startsWith("--")) fail(`unexpected argument "${argument}"`);
    const name = argument.slice(2);
    if (FLAG_OPTIONS.has(name)) {
      flags.add(name);
      continue;
    }
    if (!VALUE_OPTIONS.has(name)) {
      fail(
        `unknown option "${argument}" — known options are ${[...VALUE_OPTIONS, ...FLAG_OPTIONS].map((known) => `--${known}`).join(", ")}`,
      );
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) fail(`${argument} needs a value`);
    values.set(name, next);
    index += 1;
  }
  const required = (name: string): string => values.get(name) ?? fail(`--${name} is required`);
  const folder = required("folder");
  const out = required("out");
  if (path.resolve(out) === path.resolve(folder) || path.resolve(out).startsWith(`${path.resolve(folder)}${path.sep}`)) {
    fail("--out must be outside --folder, so reports never mix with the photographs");
  }
  return {
    gallery: required("gallery"),
    folder,
    artifacts: required("artifacts"),
    out,
    acceptInterleavedSections: flags.has("accept-interleaved-sections"),
    acceptRemovedDuplicates: flags.has("accept-removed-duplicates"),
    allowNewPhotographs: flags.has("allow-new-photographs"),
    ...(values.has("project") ? { project: values.get("project") as string } : {}),
    ...(values.has("dataset") ? { dataset: values.get("dataset") as string } : {}),
    ...(values.has("api-version") ? { apiVersion: values.get("api-version") as string } : {}),
  };
}

async function writeJson(outDir: string, fileName: string, data: unknown): Promise<void> {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await chmod(outDir, 0o700);
  const filePath = path.join(outDir, fileName);
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
}

/** Every `assetRequirements` entry in the artifact folder's JSON files. */
export function collectArtifactAssets(documents: readonly unknown[]): ArtifactAsset[] {
  const assets: ArtifactAsset[] = [];
  for (const document of documents) {
    if (typeof document !== "object" || document === null) continue;
    const requirements = (document as { assetRequirements?: unknown }).assetRequirements;
    if (!Array.isArray(requirements)) continue;
    for (const entry of requirements) {
      if (
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as ArtifactAsset).mediaId === "string" &&
        typeof (entry as ArtifactAsset).contentHash === "string" &&
        typeof (entry as ArtifactAsset).sourceLocator === "string"
      ) {
        const { mediaId, contentHash, sourceLocator } = entry as ArtifactAsset;
        assets.push({ mediaId, contentHash: contentHash.toLowerCase(), sourceLocator });
      }
    }
  }
  return assets;
}

async function readArtifacts(directory: string): Promise<ArtifactAsset[]> {
  const documents: unknown[] = [];
  for (const name of (await readdir(directory)).toSorted()) {
    if (!name.endsWith(".json")) continue;
    try {
      documents.push(JSON.parse(await readFile(path.join(directory, name), "utf8")));
    } catch {
      // Not every JSON file in an audit folder is an import artifact.
    }
  }
  return collectArtifactAssets(documents);
}

const GALLERY_QUERY = `*[_type == "gallery" && contentId == $contentId]{
  _id,
  language,
  orderingRule,
  "sections": sections[]{sectionId, slug, label},
  "placements": *[_type == "galleryPlacement" && gallery._ref == ^._id]{
    _id,
    placementId,
    order,
    sectionId,
    visible,
    pinned,
    altOverride,
    captionOverride,
    "mediaDocumentId": media._ref,
    "mediaId": media->mediaId,
    "mediaCaptureGallery": media->captureSequence.galleryContentId,
    "mediaAlt": media->alt[]{_key, language, value},
    "mediaCaption": media->caption[]{_key, language, value}
  }
}`;

const ELSEWHERE_QUERY = `*[
  _type == "galleryPlacement" &&
  !(gallery._ref in $galleryIds) &&
  media._ref in *[_type == "galleryPlacement" && gallery._ref in $galleryIds].media._ref
]{ "mediaId": media->mediaId, "galleryContentId": gallery->contentId }`;

export async function readProductionSnapshot(
  target: PublicReadTarget,
  contentId: string,
): Promise<ProductionSnapshot> {
  const galleries = await runPublicReadQuery(target, { query: GALLERY_QUERY, params: { contentId } });
  if (!Array.isArray(galleries)) fail("the dataset answered the gallery query unexpectedly");
  for (const gallery of galleries as ProductionGallery[]) {
    for (const placement of gallery.placements ?? []) {
      if (typeof placement.mediaId !== "string" || typeof placement.mediaDocumentId !== "string") {
        fail(`placement ${placement.placementId} has no resolvable photograph`);
      }
    }
  }
  const galleryIds = (galleries as ProductionGallery[]).map((gallery) => gallery._id);
  const elsewhere =
    galleryIds.length === 0
      ? []
      : await runPublicReadQuery(target, { query: ELSEWHERE_QUERY, params: { galleryIds } });
  if (!Array.isArray(elsewhere)) fail("the dataset answered the reuse query unexpectedly");
  return {
    galleries: (galleries as ProductionGallery[]).map((gallery) => ({
      ...gallery,
      sections: gallery.sections ?? [],
      placements: gallery.placements ?? [],
    })),
    placementsElsewhere: elsewhere as ProductionSnapshot["placementsElsewhere"],
  };
}

function setting(value: string | undefined, envName: string, flag: string): string {
  const resolved = value ?? process.env[envName];
  if (resolved === undefined || resolved.trim().length === 0) fail(`${envName} is required (or pass --${flag})`);
  return resolved;
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2));
  const folder = path.resolve(options.folder);
  const out = path.resolve(options.out);

  const { manifest, issues } = parseRallyManifest(
    await readJsonFile(path.join(folder, RALLY_MANIFEST_FILE), RALLY_MANIFEST_FILE),
  );
  if (manifest === undefined) {
    await writeJson(out, REPORT_FILE, { manifestIssues: issues });
    console.error(`${RALLY_MANIFEST_FILE} has ${issues.length} issue(s). Details: ${path.join(out, REPORT_FILE)}`);
    process.exitCode = 1;
    return;
  }
  if (manifest.contentId !== options.gallery) {
    fail(`rally.json describes ${manifest.contentId}, not --gallery ${options.gallery}`);
  }

  const target = parsePublicReadTarget({
    projectId: setting(options.project, "SANITY_PROJECT_ID", "project"),
    dataset: setting(options.dataset, "SANITY_DATASET", "dataset"),
    apiVersion: setting(options.apiVersion, "SANITY_API_VERSION", "api-version"),
  });

  const artifacts = await readArtifacts(path.resolve(options.artifacts));
  const files: ScannedFile[] = [];
  for (const relativePath of await listFiles(folder)) files.push(await scanFile(folder, relativePath));
  const production = await readProductionSnapshot(target, options.gallery);
  if (production.galleries.length === 0) fail(`no published gallery has the contentId ${options.gallery}`);

  const result = buildRallyConversionPlan({
    manifest,
    files,
    artifacts,
    production,
    acceptInterleavedSections: options.acceptInterleavedSections,
    acceptRemovedDuplicates: options.acceptRemovedDuplicates,
    allowNewPhotographs: options.allowNewPhotographs,
    now: new Date(),
    mintMediaId: (contentId) => `${contentId}-${randomBytes(8).toString("hex")}`,
  });

  await writeJson(out, REPORT_FILE, {
    contentId: options.gallery,
    counts: result.counts,
    blockers: result.blockers,
    refusals: result.refusals,
    warnings: result.warnings,
    deviations: result.deviations,
    reusedElsewhere: result.reusedElsewhere,
  });
  const { counts } = result;
  console.log(
    `photographs: ${counts.photographs} (${counts.existing} existing, ${counts.added} added), moved: ${counts.moved}, deviations: ${result.deviations.length}, placements to delete: ${counts.placementsDeleted}`,
  );
  console.log(
    `captions moved onto photographs: ${counts.captionsMoved}, redundant alt overrides dropped: ${counts.redundantAltOverrides}`,
  );
  console.log(
    `blockers: ${result.blockers.length}, refused files: ${result.refusals.length}, warnings: ${result.warnings.length}, photographs also in other galleries: ${result.reusedElsewhere.length}`,
  );
  if (result.plan === undefined) {
    console.error(`No plan written. Details: ${path.join(out, REPORT_FILE)}`);
    process.exitCode = 1;
    return;
  }
  await writeJson(out, PLAN_FILE, result.plan);
  console.log(`conversionDigest: ${result.plan.conversionDigest}`);
  console.log(`Plan written to ${path.join(out, PLAN_FILE)}. Nothing was written to Sanity.`);
}

if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((cause: unknown) => {
    console.error(`Rally conversion plan failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
  });
}
