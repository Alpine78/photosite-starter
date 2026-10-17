/** Owner-run local preparation only. All diagnostics are closed neutral codes. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openZipBuildInput, privateZipDirectory } from "./delivery-zip-build-files.mts";
import { ClientWebImageError, CLIENT_WEB_IMAGE_LIMITS, imageFailure } from "./client-web-image-preparation.mts";
import { parseWebImageSelection, prepareWebImageBatch, WEB_BATCH_LIMITS } from "./client-web-image-batch.mts";
import { createWebBatchOutput } from "./client-web-image-batch-files.mts";
export function parseWebBatchArguments(args: readonly string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!["--selection", "--root", "--out", "--classification"].includes(flag) || Object.hasOwn(values, flag) || !value || value.startsWith("--") || /[\u0000-\u001f\u007f]/u.test(value)) imageFailure("INVALID_ARGUMENTS");
    values[flag] = value;
  }
  if (Object.keys(values).length !== 4 || values["--classification"] !== "processed-exports") imageFailure("SOURCE_CLASSIFICATION_REQUIRED");
  const selection = path.resolve(values["--selection"]), root = path.resolve(values["--root"]), out = path.resolve(values["--out"]);
  const relative = path.relative(root, out);
  if (selection === out || relative === "" || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) imageFailure("OUTPUT_ALIAS");
  return { selection, root, out };
}
export async function runWebImageBatch(options: ReturnType<typeof parseWebBatchArguments>, signal?: AbortSignal) {
  const inputs: Awaited<ReturnType<typeof openZipBuildInput>>[] = [];
  let output: Awaited<ReturnType<typeof createWebBatchOutput>> | undefined;
  try {
    if (signal?.aborted) imageFailure("INTERRUPTED");
    const root = await privateZipDirectory(options.root);
    const selection = await openZipBuildInput(options.selection, WEB_BATCH_LIMITS.selection); inputs.push(selection);
    const bytes = await selection.read(0, selection.size), names = parseWebImageSelection(bytes), identities = new Set<string>();
    for (const name of names) {
      const source = await openZipBuildInput(path.join(options.root, name), CLIENT_WEB_IMAGE_LIMITS.bytes); inputs.push(source);
      const identity = `${source.before.dev}/${source.before.ino}`;
      if (identities.has(identity) || (source.before.dev === selection.before.dev && source.before.ino === selection.before.ino)) imageFailure("SOURCE_ALIAS");
      identities.add(identity);
    }
    if (inputs.slice(1).reduce((sum, input) => sum + input.size, 0) > WEB_BATCH_LIMITS.total) imageFailure("BATCH_BYTE_LIMIT");
    async function unchanged() {
      const now = await privateZipDirectory(options.root);
      if (root.dev !== now.dev || root.ino !== now.ino) imageFailure("SOURCE_CHANGED");
      for (const input of inputs) await input.unchanged();
      if (signal?.aborted) imageFailure("INTERRUPTED");
    }
    await unchanged(); output = await createWebBatchOutput(options.out, signal);
    const receipt = await prepareWebImageBatch(inputs.slice(1), bytes, output, signal, unchanged);
    await output.finish(receipt, unchanged); return receipt;
  } catch (error) {
    await output?.abort();
    if (error instanceof ClientWebImageError) throw error;
    imageFailure("LOCAL_IO_FAILED");
  } finally { await Promise.allSettled(inputs.map(input => input.handle.close())); }
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), interrupt = () => controller.abort();
  process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try { console.log(JSON.stringify(await runWebImageBatch(parseWebBatchArguments(process.argv.slice(2)), controller.signal))); }
  catch (error) { console.error(error instanceof ClientWebImageError ? error.message : "[client-web-image] LOCAL_IO_FAILED"); process.exitCode = controller.signal.aborted ? 130 : 1; }
  finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
