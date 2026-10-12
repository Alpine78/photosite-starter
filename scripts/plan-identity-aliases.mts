/** AB#265: local-file planner only; no target, credentials or write switch. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, ReconciliationError } from "./identity-retirement-reconciliation.mts";
import { parseLocalArguments, readIdentityInputs, writePrivateArtifact } from "./identity-artifact-files.mts";
import { planIdentityAliases } from "./identity-alias-plan.mts";

export const parseArguments = (args: readonly string[]) => parseLocalArguments(args);
export async function main(args: readonly string[]): Promise<number> {
  const options = parseArguments(args);
  const { inputs, data } = await readIdentityInputs(options);
  const plan = planIdentityAliases(data);
  await writePrivateArtifact(options.out, inputs, "identity-alias-plan.json", `${canonicalJson(plan)}\n`);
  console.log(JSON.stringify({ familyCounts: plan.familyCounts, canonicalByteCount: plan.canonicalByteCount, pins: plan.pins, planSha256: plan.planSha256, writable: false, cutoverReady: false }));
  return 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on("unhandledRejection", () => { console.error("IDENTITY_ALIAS_PLAN_ASYNC_FAILED"); process.exitCode = 1; });
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof ReconciliationError ? error.code : "IDENTITY_ALIAS_PLAN_IO_FAILED");
    process.exitCode = 1;
  });
}
