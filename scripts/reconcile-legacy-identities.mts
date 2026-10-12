/** AB#258: local files only; no credentials, HTTP or CMS mutation transport. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, reconcileIdentities, ReconciliationError } from "./identity-retirement-reconciliation.mts";
import { parseLocalArguments, readIdentityInputs, writePrivateArtifact } from "./identity-artifact-files.mts";

export function parseArguments(args: readonly string[]): Record<string, string> { return parseLocalArguments(args); }
export async function main(args: readonly string[]): Promise<number> {
  const options = parseArguments(args);
  const { inputs, data } = await readIdentityInputs(options);
  const report = reconcileIdentities(data);
  await writePrivateArtifact(options.out, inputs, "identity-reconciliation-report.json", `${canonicalJson(report)}\n`);
  console.log(JSON.stringify({ status: report.status, counts: report.counts, reportSha256: report.reportSha256, writable: false, cutoverReady: false }));
  return report.issues.length ? 2 : 0;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.on("unhandledRejection", () => { console.error("RECONCILIATION_ASYNC_FAILED"); process.exitCode = 1; });
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }).catch(error => {
    console.error(error instanceof ReconciliationError ? error.code : "RECONCILIATION_IO_FAILED");
    process.exitCode = 1;
  });
}
