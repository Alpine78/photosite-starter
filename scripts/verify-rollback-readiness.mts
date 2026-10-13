import { createHash } from "node:crypto";
import { argumentsOf, readPrivateBytes, newPrivateDirectory, writePrivateBytes } from "./private-operation-files.mts";
import { verifyRollbackReadiness } from "./rollback-readiness.mts";
async function main() {
  const args = argumentsOf(process.argv.slice(2), ["current", "rollback", "observations", "current-source-sha", "current-deployment-id", "rollback-source-sha", "rollback-deployment-id", "project-id", "team-id", "out"]);
  const current = await readPrivateBytes(args.current, 4 * 1024 * 1024), rollback = await readPrivateBytes(args.rollback, 4 * 1024 * 1024), observations = await readPrivateBytes(args.observations, 64 * 1024);
  const identity = { projectId: args["project-id"], teamId: args["team-id"] };
  const result = verifyRollbackReadiness(current, rollback, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(observations)), {
    current: { ...identity, sourceSha: args["current-source-sha"], deploymentId: args["current-deployment-id"] },
    rollback: { ...identity, sourceSha: args["rollback-source-sha"], deploymentId: args["rollback-deployment-id"] },
  }, new Date());
  const folder = await newPrivateDirectory(args.out);
  await writePrivateBytes(folder, "receipt.json", JSON.stringify({ ...result, observationsSha256: createHash("sha256").update(observations).digest("hex") }, null, 2) + "\n");
  console.log(JSON.stringify(result));
  if (!result.preflightPassed) process.exitCode = 1;
}
main().catch(() => { console.error("[verify-rollback-readiness] Invalid or unavailable private evidence; verification refused."); process.exitCode = 1; });
