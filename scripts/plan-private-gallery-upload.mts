/** Owner-run offline inspection; never changes images, uploads or contacts a provider. */
import { randomBytes } from "node:crypto";
import { lstat, open, realpath, mkdir, link, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildPrivateGallerySourcePlan, validatePrivateSourceInput, PrivateSourcePlanError, refuse,
  PRIVATE_SOURCE_MAX_INPUT_BYTES, type LocalAsset } from "./private-gallery-source-plan.mts";
import { noSymlinks, privatePath, ignoredArtifact, boundedRead, inspectAsset } from "./private-gallery-source-files.mts";
type Options = { readonly input: string; readonly sourceRoot: string; readonly out: string };

export function parsePrivateUploadArguments(argv: readonly string[]): Options {
  const fields = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!["--input", "--source-root", "--out"].includes(key) || fields.has(key) || !value || value.startsWith("--")) refuse("INVALID_ARGUMENTS");
    fields.set(key, path.resolve(value));
  }
  if (fields.size !== 3) refuse("INVALID_ARGUMENTS");
  return { input: fields.get("--input")!, sourceRoot: fields.get("--source-root")!, out: fields.get("--out")! };
}
async function writePrivatePlan(out: string, report: unknown): Promise<void> {
  const temporary = path.join(out, `.upload-plan-${randomBytes(16).toString("hex")}`);
  const destination = path.join(out, "upload-source-plan.json");
  const fd = await open(temporary, "wx", 0o600);
  try {
    await fd.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8"); await fd.sync();
    await fd.close();
    try { await link(temporary, destination); }
    catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST") refuse("OUTPUT_EXISTS");
      throw error;
    }
  } finally { await fd.close(); await unlink(temporary); }
}
export async function runPrivateUploadSourcePlanner(options: Options) {
  try {
    await noSymlinks(options.input);
    await privatePath(path.dirname(options.input), true); await privatePath(options.input, false);
    await ignoredArtifact(options.input);
    const raw = await boundedRead(options.input, PRIVATE_SOURCE_MAX_INPUT_BYTES);
    let value: unknown;
    try { value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw)); }
    catch { refuse("INVALID_INPUT"); }
    const input = validatePrivateSourceInput(value);
    await noSymlinks(options.sourceRoot);
    const root = await realpath(options.sourceRoot);
    if (!(await lstat(root)).isDirectory()) refuse("INVALID_PATH");
    await mkdir(options.out, { recursive: true, mode: 0o700 });
    await noSymlinks(options.out); await privatePath(options.out, true);
    await ignoredArtifact(path.join(options.out, "upload-source-plan.json"));
    // Sequential reads bound memory; a ZIP is hashed as a stream, never buffered.
    const assets: LocalAsset[] = [];
    const files = [...input.images.map((item) => item.relativePath), ...(input.zipPath ? [input.zipPath] : [])];
    for (let index = 0; index < files.length; index++) {
      try { assets.push(await inspectAsset(root, files[index], index === input.images.length)); }
      catch (error) { throw new PrivateSourcePlanError(error instanceof PrivateSourcePlanError ? error.code : "LOCAL_IO_FAILED", index + 1); }
    }
    const report = buildPrivateGallerySourcePlan(input, assets);
    await writePrivatePlan(options.out, report);
    return report;
  } catch (error) {
    if (error instanceof PrivateSourcePlanError) throw error;
    throw new PrivateSourcePlanError("LOCAL_IO_FAILED");
  }
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const report = await runPrivateUploadSourcePlanner(parsePrivateUploadArguments(process.argv.slice(2)));
    console.log(JSON.stringify({ status: "planned-offline", objects: report.manifest.length, totalBytes: report.totalBytes, digest: report.digest }));
  } catch (error) {
    console.error(error instanceof PrivateSourcePlanError ? error.message : "[private-upload-source] LOCAL_IO_FAILED");
    process.exitCode = 1;
  }
}
