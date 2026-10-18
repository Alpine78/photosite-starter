/** Explicit private inputs in, fixed redacted summary out. No network or mutation. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openZipBuildInput } from "./delivery-zip-build-files.mts";
import { inventoryGalleryRemoval, refuseRemoval, REMOVAL_LIMITS, RemovalImpactError } from "./gallery-removal-impact.mts";
import { writeRemovalImpactArtifact } from "./gallery-removal-impact-files.mts";
export function parseRemovalImpactArguments(args: readonly string[]) {
  const values: Record<string, string> = {};
  for (let at = 0; at < args.length; at += 2) {
    const flag = args[at], value = args[at + 1];
    if (!["--snapshot", "--evidence", "--intent", "--out"].includes(flag) || Object.hasOwn(values, flag) || !value || value.startsWith("--") || /[\u0000-\u001f\u007f]/u.test(value)) refuseRemoval("INVALID_ARGUMENTS"); values[flag] = value;
  }
  if (Object.keys(values).length !== 4) refuseRemoval("INVALID_ARGUMENTS");
  const snapshot = path.resolve(values["--snapshot"]), evidence = path.resolve(values["--evidence"]), intent = path.resolve(values["--intent"]), out = path.resolve(values["--out"]);
  if (new Set([snapshot, evidence, intent]).size !== 3 || [snapshot, evidence, intent].some(file => file === out || path.dirname(file) === out)) refuseRemoval("OUTPUT_INPUT_ALIAS");
  return { snapshot, evidence, intent, out };
}
export async function runRemovalImpactInventory(options: ReturnType<typeof parseRemovalImpactArguments>, signal?: AbortSignal) {
  const inputs: Awaited<ReturnType<typeof openZipBuildInput>>[] = [];
  try {
    const buffers: Buffer[] = [], identities = new Set<string>();
    for (const [file, maximum] of [[options.snapshot, REMOVAL_LIMITS.bytes], [options.evidence, REMOVAL_LIMITS.evidenceBytes], [options.intent, REMOVAL_LIMITS.intentBytes]] as const) {
      if (signal?.aborted) refuseRemoval("INTERRUPTED");
      const input = await openZipBuildInput(file, maximum); inputs.push(input);
      const identity = `${input.before.dev}/${input.before.ino}`;
      if (identities.has(identity)) refuseRemoval("INPUT_ALIAS"); identities.add(identity);
      const bytes = Buffer.alloc(input.size);
      for (let at = 0; at < bytes.length;) {
        if (signal?.aborted) refuseRemoval("INTERRUPTED"); const count = Math.min(65_536, bytes.length - at), part = await input.read(at, count);
        if (part.length !== count) refuseRemoval("SOURCE_CHANGED"); bytes.set(part, at); at += count;
      }
      await input.unchanged(); buffers.push(bytes);
    }
    async function unchanged() { for (const input of inputs) { if (signal?.aborted) refuseRemoval("INTERRUPTED"); await input.unchanged(); } }
    await unchanged(); const result = inventoryGalleryRemoval({ snapshot: buffers[0], evidence: buffers[1], intent: buffers[2] });
    await unchanged(); await writeRemovalImpactArtifact(options.out, result, unchanged, signal);
    return { status: result.report.status, snapshotSha256: result.report.snapshotSha256, reportSha256: result.reportSha256, snapshotDocuments: result.report.snapshotDocuments,
      selectedRecords: result.report.selectedRecords.length, assetCount: result.report.assetCount, blockerCount: result.report.blockers.length, readyToDelete: false, readyToWrite: false } as const;
  } catch (error) { if (error instanceof RemovalImpactError) throw error; refuseRemoval("LOCAL_INPUT_FAILED"); }
  finally { await Promise.allSettled(inputs.map(input => input.handle.close())); }
}
if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(), interrupt = () => controller.abort(); process.on("SIGINT", interrupt); process.on("SIGTERM", interrupt);
  try { console.log(JSON.stringify(await runRemovalImpactInventory(parseRemovalImpactArguments(process.argv.slice(2)), controller.signal))); }
  catch (error) { console.error(error instanceof RemovalImpactError ? error.message : "[removal-impact] LOCAL_INPUT_FAILED"); process.exitCode = controller.signal.aborted ? 130 : 1; }
  finally { process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt); }
}
