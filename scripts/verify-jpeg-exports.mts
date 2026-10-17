/** Owner-run local export audit. Original filenames never leave local filesystem calls. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openZipBuildInput, privateZipDirectory } from "./delivery-zip-build-files.mts";
import { parseZipSelection, ZIP_BUILD_LIMITS } from "./delivery-zip-build-plan.mts";
import { auditJpegExports, failJpeg, jpegAbortCode, JPEG_AUDIT_LIMITS, JpegAuditError } from "./jpeg-export-audit.mts";
import { writeJpegAuditArtifacts } from "./jpeg-audit-files.mts";
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
  const inputs: Awaited<ReturnType<typeof openZipBuildInput>>[] = [];
  const timeout = AbortSignal.timeout(JPEG_AUDIT_LIMITS.timeoutMs), cancellation = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    if (cancellation.aborted) failJpeg(jpegAbortCode(cancellation));
    const root = await privateZipDirectory(options.root), selection = await openZipBuildInput(options.selection, ZIP_BUILD_LIMITS.selection); inputs.push(selection);
    const bytes = await selection.read(0, selection.size), names = parseZipSelection(bytes), identities = new Set<string>();
    for (const name of names) {
      const source = await openZipBuildInput(path.join(options.root, name), JPEG_AUDIT_LIMITS.bytes); inputs.push(source);
      const identity = `${source.before.dev}/${source.before.ino}`;
      if (identities.has(identity) || (source.before.dev === selection.before.dev && source.before.ino === selection.before.ino)) failJpeg("SOURCE_ALIAS"); identities.add(identity);
      if (cancellation.aborted) failJpeg(jpegAbortCode(cancellation));
    }
    async function unchanged() {
      const now = await privateZipDirectory(options.root); if (root.dev !== now.dev || root.ino !== now.ino) failJpeg("SOURCE_CHANGED");
      for (const input of inputs) {
        if (cancellation.aborted) failJpeg(jpegAbortCode(cancellation));
        await input.unchanged();
      }
      if (cancellation.aborted) failJpeg(jpegAbortCode(cancellation));
    }
    await unchanged(); const report = await auditJpegExports(inputs.slice(1), bytes, { signal: cancellation });
    await unchanged(); await writeJpegAuditArtifacts(options.out, report, unchanged, cancellation); return report.receipt;
  } catch (error) { if (error instanceof JpegAuditError) throw error; failJpeg("LOCAL_INPUT_FAILED"); }
  finally { await Promise.allSettled(inputs.map(input => input.handle.close())); }
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), interrupt = () => controller.abort(); process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try { console.log(JSON.stringify(await runJpegExportAudit(parseJpegAuditArguments(process.argv.slice(2)), controller.signal))); }
  catch (error) { console.error(error instanceof JpegAuditError ? error.message : "[jpeg-audit] LOCAL_INPUT_FAILED"); process.exitCode = controller.signal.aborted ? 130 : 1; }
  finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
