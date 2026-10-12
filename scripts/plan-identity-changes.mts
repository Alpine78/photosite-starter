/** AB#259: local-file planner only; no CMS connection or write switch. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, ReconciliationError } from "./identity-retirement-reconciliation.mts";
import { parseLocalArguments, readIdentityInputs, writePrivateArtifact } from "./identity-artifact-files.mts";
import { planIdentityChanges } from "./identity-change-plan.mts";

export function parseArguments(args: readonly string[]) {
  const options = parseLocalArguments(args, undefined, ["max-documents-per-batch"]);
  const limit = options["max-documents-per-batch"] ?? "50";
  if (!/^(?:[1-9]\d?|100)$/u.test(limit)) throw new ReconciliationError("INVALID_BATCH_LIMIT");
  return { options, maxDocumentsPerBatch: Number(limit) };
}
export async function main(args: readonly string[]): Promise<number> {
  const { options, maxDocumentsPerBatch } = parseArguments(args);
  const { inputs, data } = await readIdentityInputs(options);
  const plan = planIdentityChanges(data, maxDocumentsPerBatch);
  await writePrivateArtifact(options.out, inputs, "identity-change-plan.json", `${canonicalJson(plan)}\n`);
  console.log(JSON.stringify({ counts: plan.counts, planSha256: plan.planSha256, writable: false, cutoverReady: false }));
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on("unhandledRejection", () => { console.error("IDENTITY_PLAN_ASYNC_FAILED"); process.exitCode = 1; });
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof ReconciliationError ? error.code : "IDENTITY_PLAN_IO_FAILED");
    process.exitCode = 1;
  });
}
