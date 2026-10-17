/** Explicit owner-selected whole package, local only; no public-file or upload approval. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ZipBuildError, ZIP_BUILD_LIMITS, parseZipSelection, planWholeZip, refuseBuild } from "./delivery-zip-build-plan.mts";
import { buildWholeDeliveryZip } from "./delivery-zip-build.mts";
import { createZipBuildOutput, openZipBuildInput, privateZipDirectory } from "./delivery-zip-build-files.mts";
export function parseZipBuildArguments(args: readonly string[]) {
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i + 1];
    if (!["--selection", "--root", "--out", "--classification"].includes(flag) || values.has(flag) || !value || value.startsWith("--")) refuseBuild("INVALID_ARGUMENTS");
    values.set(flag, value);
  }
  if (values.size !== 4 || values.get("--classification") !== "processed-jpeg-exports") refuseBuild("INVALID_CLASSIFICATION_OR_ARGUMENTS");
  return { selection: path.resolve(values.get("--selection")!), root: path.resolve(values.get("--root")!), out: path.resolve(values.get("--out")!) };
}
export async function runWholeZipBuild(options: ReturnType<typeof parseZipBuildArguments>, signal?: AbortSignal) {
  const inputs: Awaited<ReturnType<typeof openZipBuildInput>>[] = [];
  let output: Awaited<ReturnType<typeof createZipBuildOutput>> | undefined, success = false;
  try {
    const relativeOut = path.relative(options.root, options.out);
    if (!relativeOut || (!relativeOut.startsWith(`..${path.sep}`) && relativeOut !== ".." && !path.isAbsolute(relativeOut))) refuseBuild("OUTPUT_INPUT_ALIAS");
    const root = await privateZipDirectory(options.root), selection = await openZipBuildInput(options.selection, ZIP_BUILD_LIMITS.selection); inputs.push(selection);
    const data = await selection.read(0, selection.size);
    if (data.length !== selection.size) refuseBuild("SOURCE_CHANGED");
    const names = parseZipSelection(data), identities = new Set<string>([`${selection.before.dev}:${selection.before.ino}`]);
    const sources: typeof inputs = [];
    for (const name of names) {
      if (signal?.aborted) refuseBuild("CANCELLED");
      const file = path.resolve(options.root, name), relative = path.relative(options.root, file);
      if (relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative)) refuseBuild("SOURCE_ROOT_ESCAPE");
      const input = await openZipBuildInput(file, ZIP_BUILD_LIMITS.entry); inputs.push(input);
      const identity = `${input.before.dev}:${input.before.ino}`;
      if (identities.has(identity)) refuseBuild("DUPLICATE_SOURCE"); identities.add(identity); sources.push(input);
    }
    planWholeZip(sources.map(source => source.size)); // Includes every header/descriptor/central byte before creating output.
    async function unchanged() {
      if (signal?.aborted) refuseBuild("CANCELLED");
      const currentRoot = await privateZipDirectory(options.root);
      if (currentRoot.dev !== root.dev || currentRoot.ino !== root.ino) refuseBuild("SOURCE_CHANGED");
      for (const input of inputs) await input.unchanged();
    }
    await unchanged(); output = await createZipBuildOutput(options.out);
    const result = await buildWholeDeliveryZip(sources, output, { signal });
    await output.finish(result.manifest, result.receipt, unchanged); success = true; return result.receipt;
  } catch (error) {
    if (error instanceof ZipBuildError) throw error;
    refuseBuild("LOCAL_IO_FAILED");
  } finally {
    if (!success) await output?.abort(); else await output?.close();
    await Promise.allSettled(inputs.map(input => input.handle.close()));
  }
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.once("SIGINT", cancel); process.once("SIGTERM", cancel);
  try { console.log(JSON.stringify(await runWholeZipBuild(parseZipBuildArguments(process.argv.slice(2)), controller.signal))); }
  catch (error) { console.error(error instanceof ZipBuildError ? error.message : "[zip-builder] LOCAL_IO_FAILED"); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", cancel); process.removeListener("SIGTERM", cancel); }
}
