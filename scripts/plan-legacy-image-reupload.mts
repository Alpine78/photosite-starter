/**
 * AB#391, owner-run: reads local legacy source images and writes one private report. With
 * `--asset-plans` (a folder of approved import plans) and `--published` (the media list a read of the
 * dataset gave), it also writes the plan by published medium, which `write:legacy-image-reupload` takes.
 * Never transforms an image, contacts a provider or writes to a CMS. The reports name source
 * files, so they belong outside the repository.
 */
import { createHash } from "node:crypto";
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JPEG_AUDIT_LIMITS } from "./jpeg-export-audit.mts";
import { buildPublishedReuploadPlan, indexAssetRequirements, type AssetRequirementRow, type PublishedMedium, type ReuploadSource } from "./legacy-image-reupload-match.mts";
import { buildReuploadPlan, classifySource, type ReuploadRow } from "./legacy-image-reupload-plan.mts";

const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif|tiff?|bmp)$/i;

export function parseArguments(argv: readonly string[]): { imageRoot: string; out: string; assetPlans?: string; published?: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!["--image-root", "--out", "--asset-plans", "--published"].includes(name) || values.has(name) || !value || value.startsWith("--")) throw new Error("ARGUMENTS_INVALID");
    values.set(name, path.resolve(value));
  }
  const imageRoot = values.get("--image-root"), out = values.get("--out");
  if (!imageRoot || !out) throw new Error("ARGUMENTS_INVALID");
  const relative = path.relative(imageRoot, out);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("OUTPUT_INSIDE_IMAGE_ROOT");
  const assetPlans = values.get("--asset-plans"), published = values.get("--published");
  if ((assetPlans === undefined) !== (published === undefined)) throw new Error("ARGUMENTS_INVALID");
  return { imageRoot, out, ...(assetPlans === undefined ? {} : { assetPlans, published }) };
}

/** The source half of the medium plan, kept beside each row without changing the folder report. */
const sourceFor = (row: ReuploadRow, bytes: Uint8Array | undefined, size: number): ReuploadSource => ({
  path: row.path,
  sha256: bytes === undefined ? "" : createHash("sha256").update(bytes).digest("hex"),
  bytes: size,
  action: row.action,
  gps: "facts" in row ? row.facts.gps : null,
});

export async function collectRows(imageRoot: string, sources?: Map<string, ReuploadSource>): Promise<ReuploadRow[]> {
  const rows: ReuploadRow[] = [];
  for (const entry of await readdir(imageRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !IMAGE_EXTENSION.test(entry.name)) continue;
    const full = path.join(entry.parentPath, entry.name), relative = path.relative(imageRoot, full).split(path.sep).join("/");
    const { size } = await lstat(full);
    if (size > JPEG_AUDIT_LIMITS.bytes) {
      const row: ReuploadRow = { path: relative, action: "unreadable", code: "INPUT_LIMIT" };
      rows.push(row);
      sources?.set(relative, sourceFor(row, undefined, size));
      continue;
    }
    const bytes = await readFile(full), row = classifySource(relative, bytes);
    rows.push(row);
    sources?.set(relative, sourceFor(row, bytes, size));
  }
  return rows;
}

/** Every approved import plan in a folder, read for its `assetRequirements`. Anything else there is ignored. */
export async function readAssetRequirements(folder: string): Promise<readonly AssetRequirementRow[]> {
  const rows: AssetRequirementRow[] = [];
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(await readFile(path.join(entry.parentPath, entry.name), "utf8")); }
    catch { continue; }
    const requirements = (parsed as { assetRequirements?: unknown } | null)?.assetRequirements;
    if (!Array.isArray(requirements)) continue;
    for (const row of requirements as AssetRequirementRow[]) {
      if (typeof row?.mediaId === "string" && typeof row.sourceLocator === "string" && typeof row.contentHash === "string") rows.push(row);
    }
  }
  return rows;
}

export async function run(argv: readonly string[]) {
  const { imageRoot, out, assetPlans, published } = parseArguments(argv);
  const sources = new Map<string, ReuploadSource>();
  const plan = buildReuploadPlan(await collectRows(imageRoot, sources));
  // Not recursive: an existing directory is refused rather than mixed with an older report.
  await mkdir(out, { mode: 0o700 });
  await writeFile(path.join(out, "legacy-image-reupload-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  if (assetPlans !== undefined && published !== undefined) {
    const media = JSON.parse(await readFile(published, "utf8")) as readonly PublishedMedium[];
    const byMedium = buildPublishedReuploadPlan(media, indexAssetRequirements(await readAssetRequirements(assetPlans)), sources);
    await writeFile(path.join(out, "legacy-image-reupload-published.json"), `${JSON.stringify(byMedium, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify(byMedium.summary));
  }
  return plan;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    plan => { console.log(JSON.stringify({ ...plan.summary, gpsReview: plan.gpsReview.length })); },
    (error: Error) => { console.error(`[plan-legacy-image-reupload] ${error.message}`); process.exitCode = 2; },
  );
}
