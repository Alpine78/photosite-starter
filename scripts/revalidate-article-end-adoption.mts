/** Owner-private offline revalidation, deliberately without an apply mode. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADOPTION_LIMITS, AdoptionPlanError } from "./article-end-adoption-plan.mts";
import { revalidateArticleEndAdoption, validateAdoptionBaselineDigest } from "./article-end-adoption-revalidation.mts";
import { canonicalJson } from "./identity-retirement-reconciliation.mts";
import { argumentsOf, newPrivateDirectory, readPrivateBytes, writePrivateBytes } from "./private-operation-files.mts";
import { assertPrivateOutput } from "./identity-artifact-files.mts";

export async function main(args: readonly string[]): Promise<number> {
  try {
    const values = argumentsOf(args, ["baseline-manifest", "baseline-snapshot", "baseline-digest", "current-manifest", "current-snapshot", "out"]);
    const baselineDigest = validateAdoptionBaselineDigest(values["baseline-digest"]);
    const [baselineManifest, baselineSnapshot, currentManifest, currentSnapshot] = await Promise.all([
      readPrivateBytes(values["baseline-manifest"], ADOPTION_LIMITS.manifestBytes),
      readPrivateBytes(values["baseline-snapshot"], ADOPTION_LIMITS.bytes),
      readPrivateBytes(values["current-manifest"], ADOPTION_LIMITS.manifestBytes),
      readPrivateBytes(values["current-snapshot"], ADOPTION_LIMITS.bytes),
    ]);
    const evidence = revalidateArticleEndAdoption({ baselineDigest,
      baseline: { manifest: baselineManifest, snapshot: baselineSnapshot },
      current: { manifest: currentManifest, snapshot: currentSnapshot },
    });
    const folder = await newPrivateDirectory(values.out);
    await assertPrivateOutput(folder, [values["baseline-manifest"], values["baseline-snapshot"], values["current-manifest"], values["current-snapshot"]], "revalidation.json");
    await writePrivateBytes(folder, "revalidation.json", canonicalJson(evidence) + "\n");
    console.log(JSON.stringify({ evidenceSha256: evidence.evidenceSha256,
      baselinePlanSha256: evidence.baselinePlanSha256, currentPlanSha256: evidence.currentPlanSha256,
      changes: evidence.plan.counts.changes, scopeUnchanged: true, writable: false, approved: false }));
    return 0;
  } catch (error) {
    if (error instanceof AdoptionPlanError) throw error;
    throw new AdoptionPlanError("REVALIDATION_INPUT_OR_OUTPUT_FAILED");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof AdoptionPlanError ? error.code : "REVALIDATION_INPUT_OR_OUTPUT_FAILED");
    process.exitCode = 1;
  });
}
