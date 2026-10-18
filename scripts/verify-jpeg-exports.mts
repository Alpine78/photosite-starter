/** Owner-run local export audit. Original filenames never leave local filesystem calls. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditJpegExports, failJpeg, JpegAuditError } from "./jpeg-export-audit.mts";
import { runPrivateJpegAudit } from "./jpeg-audit-inputs.mts";
export function parseJpegAuditArguments(args: readonly string[]) {
  const values: Record<string, string> = {};
  for (let at = 0; at < args.length; at += 2) {
    const flag = args[at], value = args[at + 1];
    if (!["--selection", "--root", "--out", "--classification"].includes(flag) || Object.hasOwn(values, flag) || !value || value.startsWith("--") || /[\u0000-\u001f\u007f]/u.test(value)) failJpeg("INVALID_ARGUMENTS"); values[flag] = value;
  }
  if (Object.keys(values).length !== 4 || values["--classification"] !== "processed-jpeg-exports") failJpeg("CLASSIFICATION_REQUIRED");
  const root = path.resolve(values["--root"]), out = path.resolve(values["--out"]), selection = path.resolve(values["--selection"]), relative = path.relative(root, out);
  if (selection === out || !relative || (!relative.startsWith(".." + path.sep) && !path.isAbsolute(relative))) failJpeg("OUTPUT_ALIAS");
  return { root, out, selection };
}
export async function runJpegExportAudit(options: ReturnType<typeof parseJpegAuditArguments>, signal?: AbortSignal) {
  return runPrivateJpegAudit(options, (sources, selection, cancellation) => auditJpegExports(sources, selection, { signal: cancellation }), signal);
}

if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), interrupt = () => controller.abort(); process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try { console.log(JSON.stringify(await runJpegExportAudit(parseJpegAuditArguments(process.argv.slice(2)), controller.signal))); }
  catch (error) { console.error(error instanceof JpegAuditError ? error.message : "[jpeg-audit] LOCAL_INPUT_FAILED"); process.exitCode = controller.signal.aborted ? 130 : 1; }
  finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
