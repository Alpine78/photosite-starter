/**
 * AB#391, owner-run: reads local legacy source images and writes one private report.
 * Never transforms an image, contacts a provider or writes to a CMS. The report names
 * source files, so it belongs outside the repository.
 */
import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { JPEG_AUDIT_LIMITS } from "./jpeg-export-audit.mts";
import { buildReuploadPlan, classifySource, type ReuploadRow } from "./legacy-image-reupload-plan.mts";

const IMAGE_EXTENSION = /\.(?:jpe?g|png|gif|webp|avif|tiff?|bmp)$/i;

export function parseArguments(argv: readonly string[]): { imageRoot: string; out: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!["--image-root", "--out"].includes(name) || values.has(name) || !value || value.startsWith("--")) throw new Error("ARGUMENTS_INVALID");
    values.set(name, path.resolve(value));
  }
  const imageRoot = values.get("--image-root"), out = values.get("--out");
  if (!imageRoot || !out) throw new Error("ARGUMENTS_INVALID");
  const relative = path.relative(imageRoot, out);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) throw new Error("OUTPUT_INSIDE_IMAGE_ROOT");
  return { imageRoot, out };
}

export async function collectRows(imageRoot: string): Promise<ReuploadRow[]> {
  const rows: ReuploadRow[] = [];
  for (const entry of await readdir(imageRoot, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !IMAGE_EXTENSION.test(entry.name)) continue;
    const full = path.join(entry.parentPath, entry.name), relative = path.relative(imageRoot, full).split(path.sep).join("/");
    const { size } = await lstat(full);
    rows.push(size > JPEG_AUDIT_LIMITS.bytes ? { path: relative, action: "unreadable", code: "INPUT_LIMIT" } : classifySource(relative, await readFile(full)));
  }
  return rows;
}

export async function run(argv: readonly string[]) {
  const { imageRoot, out } = parseArguments(argv);
  const plan = buildReuploadPlan(await collectRows(imageRoot));
  // Not recursive: an existing directory is refused rather than mixed with an older report.
  await mkdir(out, { mode: 0o700 });
  await writeFile(path.join(out, "legacy-image-reupload-plan.json"), `${JSON.stringify(plan, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  return plan;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  run(process.argv.slice(2)).then(
    plan => { console.log(JSON.stringify({ ...plan.summary, gpsReview: plan.gpsReview.length })); },
    (error: Error) => { console.error(`[plan-legacy-image-reupload] ${error.message}`); process.exitCode = 2; },
  );
}
