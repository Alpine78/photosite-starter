/** Owner-run private metadata-envelope inventory; never outputs embedded values. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseJpegAuditArguments } from "./verify-jpeg-exports.mts";
import { runPrivateJpegAudit } from "./jpeg-audit-inputs.mts";
import { auditJpegMetadata } from "./jpeg-metadata-inventory.mts";
import { JpegAuditError } from "./jpeg-export-audit.mts";
export async function runJpegMetadataInventory(options: ReturnType<typeof parseJpegAuditArguments>, signal?: AbortSignal) {
  return runPrivateJpegAudit(options, (sources, selection, cancellation) => auditJpegMetadata(sources, selection, { signal: cancellation }), signal);
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), interrupt = () => controller.abort();
  try {
    process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
    console.log(JSON.stringify(await runJpegMetadataInventory(parseJpegAuditArguments(process.argv.slice(2)), controller.signal)));
  } catch (error) {
    console.error(error instanceof JpegAuditError ? error.message : "[jpeg-audit] LOCAL_INPUT_FAILED"); process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
