/**
 * AB#167: `npm run plan:rally -- --folder <dir> --out <dir> [--accept-interleaved-sections]`.
 *
 * The IO half of the offline rally import planner (ADR-0022 §6). Reads one
 * exported rally folder and its `rally.json`, hashes and measures every file,
 * and hands the facts to `rally-import-plan.mts`, which decides everything.
 *
 * It makes **no network request**, reads no credential, and writes nothing to
 * Sanity. Everything it writes goes under `--out`, as private files (`0600` in
 * a `0700` directory): the plan, a report naming each refused file and why, and
 * the content-hash identity map that keeps each photograph's `mediaId` stable
 * across runs. The console carries counts and the plan digest only.
 *
 * Only metadata is decoded (`sharp`'s header read); no pixel is re-encoded here.
 * Producing the public derivative, stripped of EXIF/GPS, belongs to the write
 * step.
 */

import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp, { type Metadata } from "sharp";

import {
  buildRallyImportPlan,
  emptyIdentityMap,
  parseIdentityMap,
  parseRallyManifest,
  RALLY_MANIFEST_FILE,
  type RallyIdentityMap,
  type ScannedFile,
} from "./rally-import-plan.mts";

const PLAN_FILE = "rally-import-plan.json";
const REPORT_FILE = "rally-import-report.json";
const IDENTITY_FILE = "rally-identities.json";

class RallyPlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RallyPlanError";
  }
}

function fail(message: string): never {
  throw new RallyPlanError(message);
}

export type Options = {
  readonly folder: string;
  readonly out: string;
  readonly acceptInterleavedSections: boolean;
};

const KNOWN_OPTIONS = new Set(["folder", "out"]);

export function parseArguments(argv: readonly string[]): Options {
  const values = new Map<string, string>();
  let acceptInterleavedSections = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index] ?? "";
    if (argument === "--accept-interleaved-sections") {
      acceptInterleavedSections = true;
      continue;
    }
    if (!argument.startsWith("--")) {
      fail(`unexpected argument "${argument}" — every option is spelled --<name> <value>`);
    }
    const name = argument.slice(2);
    if (!KNOWN_OPTIONS.has(name)) {
      fail(
        `unknown option "${argument}" — known options are --folder, --out, --accept-interleaved-sections`,
      );
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) fail(`${argument} needs a value`);
    values.set(name, next);
    index += 1;
  }
  const folder = values.get("folder");
  const out = values.get("out");
  if (folder === undefined) fail("--folder <rally folder> is required");
  if (out === undefined) fail("--out <report folder> is required");
  if (path.resolve(out).startsWith(`${path.resolve(folder)}${path.sep}`) || path.resolve(out) === path.resolve(folder)) {
    fail("--out must be outside --folder, so reports never mix with the photographs");
  }
  return { folder, out, acceptInterleavedSections };
}

async function writePrivateFile(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content, { encoding: "utf8", mode: 0o600 });
  await chmod(filePath, 0o600);
}

async function writeJson(outDir: string, fileName: string, data: unknown): Promise<void> {
  await mkdir(outDir, { recursive: true, mode: 0o700 });
  await chmod(outDir, 0o700);
  await writePrivateFile(path.join(outDir, fileName), `${JSON.stringify(data, null, 2)}\n`);
}

/**
 * Every regular file under the folder, recursively, as `/`-separated relative
 * paths — so stage subfolders the owner makes for their own work do not
 * matter, because the section comes from the file name. Dot-files and
 * dot-folders (`.DS_Store`, editor state) are skipped, and so is the root
 * `rally.json`; everything else is judged by the planner.
 */
export async function listFiles(root: string, relative = ""): Promise<string[]> {
  const entries = await readdir(path.join(root, relative), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith(".")) continue;
    const child = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, child)));
    } else if (entry.isFile()) {
      if (child === RALLY_MANIFEST_FILE) continue;
      files.push(child);
    } else {
      fail(`${child} is neither a file nor a folder (a link?) — the rally folder must hold plain files`);
    }
  }
  return files;
}

/** EXIF orientations 5–8 turn the image a quarter, so the displayed width and height swap. */
function orientedDimensions(metadata: Metadata): { width?: number; height?: number } {
  const swap = (metadata.orientation ?? 1) >= 5;
  return swap
    ? { width: metadata.height, height: metadata.width }
    : { width: metadata.width, height: metadata.height };
}

export async function scanFile(root: string, relativePath: string): Promise<ScannedFile> {
  const bytes = await readFile(path.join(root, relativePath));
  const contentHash = createHash("sha256").update(bytes).digest("hex");
  try {
    const metadata = await sharp(bytes, { failOn: "error" }).metadata();
    const { width, height } = orientedDimensions(metadata);
    return {
      relativePath,
      contentHash,
      ...(metadata.format === undefined ? {} : { format: metadata.format }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(metadata.pages === undefined ? {} : { pages: metadata.pages }),
    };
  } catch {
    // Not decodable as an image; the planner refuses it with the right reason.
    return { relativePath, contentHash };
  }
}

export async function readJsonFile(filePath: string, label: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    fail(`${label} was not found at ${filePath}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    fail(`${label} is not valid JSON`);
  }
}

async function readIdentities(out: string): Promise<RallyIdentityMap> {
  const filePath = path.join(out, IDENTITY_FILE);
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    return emptyIdentityMap();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail(`${IDENTITY_FILE} in --out is not valid JSON; restore it from a backup rather than deleting it`);
  }
  const { identities, issues } = parseIdentityMap(raw);
  if (identities === undefined) {
    fail(`${IDENTITY_FILE} in --out is malformed (${issues.length} issue(s)); restore it from a backup rather than deleting it`);
  }
  return identities;
}

function mintMediaId(contentId: string): string {
  return `${contentId}-${randomBytes(8).toString("hex")}`;
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
    console.error(
      `${RALLY_MANIFEST_FILE} has ${issues.length} issue(s). Details: ${path.join(out, REPORT_FILE)}`,
    );
    process.exitCode = 1;
    return;
  }

  const identities = await readIdentities(out);
  const files: ScannedFile[] = [];
  for (const relativePath of await listFiles(folder)) {
    files.push(await scanFile(folder, relativePath));
  }

  const result = buildRallyImportPlan({
    manifest,
    files,
    identities,
    now: new Date(),
    acceptInterleavedSections: options.acceptInterleavedSections,
    mintMediaId,
  });

  await writeJson(out, REPORT_FILE, {
    contentId: manifest.contentId,
    counts: result.counts,
    refusals: result.refusals,
    problems: result.problems,
    warnings: result.warnings,
  });

  const { counts } = result;
  console.log(
    `files: ${counts.files}, photographs: ${counts.photographs}, refused: ${result.refusals.length}, problems: ${result.problems.length}, warnings: ${result.warnings.length}`,
  );

  if (result.plan === undefined) {
    console.error(`No plan written. Details: ${path.join(out, REPORT_FILE)}`);
    process.exitCode = 1;
    return;
  }

  await writeJson(out, PLAN_FILE, result.plan);
  await writeJson(out, IDENTITY_FILE, result.identities);
  console.log(
    `identities: ${counts.reusedIdentities} reused, ${counts.newIdentities} new; documents: ${result.plan.documents.length}`,
  );
  console.log(`documentsDigest: ${result.plan.documentsDigest}`);
  console.log(`Plan written to ${path.join(out, PLAN_FILE)}. Nothing was sent anywhere.`);
}

// Guarded so importing this module for `parseArguments` does not run the command —
// the same entry-point check `convert-joomla-content.mts` uses.
if (import.meta.main || process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((cause: unknown) => {
    console.error(
      `Rally plan failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
    process.exitCode = 1;
  });
}
