/** One processed export in; one private web derivative and technical receipt out. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ClientWebImageError, imageFailure, prepareClientWebImage } from "./client-web-image-preparation.mts";
import { openPrivateClientImage, writePrivateClientImage } from "./client-web-image-files.mts";

export function parseClientWebImageArguments(args: readonly string[]) {
  const values: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index], value = args[index + 1];
    if (!["--source", "--classification", "--out"].includes(flag) || Object.hasOwn(values, flag) || !value || value.startsWith("--") || value.includes("\0")) imageFailure("INVALID_ARGUMENTS");
    values[flag] = value;
  }
  if (Object.keys(values).length !== 3 || values["--classification"] !== "processed-export") imageFailure("SOURCE_CLASSIFICATION_REQUIRED");
  const source = path.resolve(values["--source"]), out = path.resolve(values["--out"]);
  if (source === out || path.dirname(source) === out) imageFailure("OUTPUT_ALIAS");
  return { source, out, classification: values["--classification"] };
}
export async function runClientWebImagePreparation(options: ReturnType<typeof parseClientWebImageArguments>, signal?: AbortSignal) {
  let input: Awaited<ReturnType<typeof openPrivateClientImage>> | undefined;
  try {
    if (signal?.aborted) imageFailure("INTERRUPTED");
    input = await openPrivateClientImage(options.source);
    const prepared = await prepareClientWebImage(input.bytes, options.classification);
    await input.unchanged();
    await writePrivateClientImage(options.out, options.source, prepared, signal, input.unchanged);
    return prepared.receipt;
  } catch (error) {
    if (error instanceof ClientWebImageError) throw error;
    return imageFailure("LOCAL_IO_FAILED");
  } finally { await input?.close(); }
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const cancellation = new AbortController(), interrupt = () => cancellation.abort();
  process.once("SIGINT", interrupt);
  try { console.log(JSON.stringify(await runClientWebImagePreparation(parseClientWebImageArguments(process.argv.slice(2)), cancellation.signal))); }
  catch (error) { console.error(error instanceof ClientWebImageError ? error.message : "[client-web-image] LOCAL_IO_FAILED"); process.exitCode = 1; }
  finally { process.removeListener("SIGINT", interrupt); }
}
