/** Shared unchanged owner-private input/receipt orchestration; no remote writer. */
import path from "node:path";
import { openZipBuildInput, privateZipDirectory } from "./delivery-zip-build-files.mts";
import { parseZipSelection, ZIP_BUILD_LIMITS } from "./delivery-zip-build-plan.mts";
import { failJpeg, jpegAbortCode, JPEG_AUDIT_LIMITS, JpegAuditError, type JpegSource } from "./jpeg-export-audit.mts";
import { writeJpegAuditArtifacts } from "./jpeg-audit-files.mts";
export type PrivateJpegAuditOptions = Readonly<{ root: string; out: string; selection: string }>;
export async function runPrivateJpegAudit<T>(options: PrivateJpegAuditOptions, analyze: (sources: readonly JpegSource[], selection: Uint8Array, signal: AbortSignal) => Promise<{ manifest: string; receipt: T }>, signal?: AbortSignal) {
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
    await unchanged(); const report = await analyze(inputs.slice(1), bytes, cancellation);
    await unchanged(); await writeJpegAuditArtifacts(options.out, report, unchanged, cancellation); return report.receipt;
  } catch (error) { if (error instanceof JpegAuditError) throw error; failJpeg("LOCAL_INPUT_FAILED"); }
  finally { await Promise.allSettled(inputs.map(input => input.handle.close())); }
}
