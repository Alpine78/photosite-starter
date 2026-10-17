/** AB#304: plan/verify local files; there is deliberately no apply mode. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { argumentsOf, OperationError, readPrivateBytes } from "./private-operation-files.mts";
import { canonicalJson } from "./identity-retirement-reconciliation.mts";
import { AVAILABILITY_INPUT_BYTES, AVAILABILITY_NOTICES, AvailabilityPlanError, planClientGalleryAvailability, verifyClientGalleryAvailability } from "./client-gallery-availability-plan.mts";
import { writeAvailabilityArtifact } from "./client-gallery-availability-files.mts";

async function run(args: readonly string[]): Promise<number> {
  const mode = args[0];
  if (mode !== "plan" && mode !== "verify") throw new AvailabilityPlanError("INVALID_MODE");
  const values = argumentsOf(args.slice(1), mode === "plan"
    ? ["snapshot", "intent", "at", "out"] : ["snapshot", "plan", "approved-digest", "at", "out"]);
  const snapshot = await readPrivateBytes(values.snapshot, AVAILABILITY_INPUT_BYTES);
  const result = mode === "plan"
    ? planClientGalleryAvailability(snapshot, await readPrivateBytes(values.intent, 4096), values.at)
    : verifyClientGalleryAvailability(await readPrivateBytes(values.plan, AVAILABILITY_INPUT_BYTES), snapshot, values["approved-digest"], values.at);
  await writeAvailabilityArtifact(values.out, [values.snapshot, mode === "plan" ? values.intent : values.plan], mode === "plan" ? "plan.json" : "verification.json", canonicalJson(result) + "\n");
  console.log(JSON.stringify({ mode, planSha256: result.planSha256, readyToWrite: false, cmsWritePerformed: false, notices: AVAILABILITY_NOTICES }));
  return 0;
}
export async function main(args: readonly string[]): Promise<number> {
  try { return await run(args); }
  catch (error) {
    const code = error instanceof AvailabilityPlanError ? error.code
      : error instanceof OperationError && ["INVALID_ARGUMENTS", "MISSING_ARGUMENTS", "INPUT_LINK", "INPUT_NOT_PRIVATE_OR_BOUNDED", "INPUT_CHANGED"].includes(error.message) ? error.message : "AVAILABILITY_IO_FAILED";
    throw new AvailabilityPlanError(code);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error: unknown) => {
    // Native JSON/fs messages may contain source excerpts and private paths.
    const code = error instanceof AvailabilityPlanError ? error.code : "AVAILABILITY_IO_FAILED";
    console.error(code); process.exitCode = 1;
  });
}
