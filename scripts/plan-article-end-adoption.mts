/** Owner-private offline CLI. Deliberately no apply mode or provider credential. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ADOPTION_LIMITS, AdoptionPlanError, planArticleEndAdoption } from "./article-end-adoption-plan.mts";
import { canonicalJson } from "./identity-retirement-reconciliation.mts";
import { argumentsOf, newPrivateDirectory, readPrivateBytes } from "./private-operation-files.mts";
import { writePrivateArtifact } from "./identity-artifact-files.mts";

export async function main(args: readonly string[]): Promise<number> {
  try {
    const values = argumentsOf(args, ["manifest", "snapshot", "out"]);
    const [manifest, snapshot] = await Promise.all([readPrivateBytes(values.manifest, ADOPTION_LIMITS.manifestBytes), readPrivateBytes(values.snapshot, ADOPTION_LIMITS.bytes)]);
    const plan = planArticleEndAdoption({ manifest, snapshot });
    const folder = await newPrivateDirectory(values.out);
    await writePrivateArtifact(folder, [values.manifest, values.snapshot], "plan.json", canonicalJson(plan) + "\n");
    console.log(JSON.stringify({ planSha256: plan.planSha256, changes: plan.counts.changes, writable: false, approved: false }));
    return 0;
  } catch (error) {
    if (error instanceof AdoptionPlanError) throw error;
    throw new AdoptionPlanError("ADOPTION_INPUT_OR_OUTPUT_FAILED");
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch((error: unknown) => {
    console.error(error instanceof AdoptionPlanError ? error.code : "ADOPTION_INPUT_OR_OUTPUT_FAILED");
    process.exitCode = 1;
  });
}
