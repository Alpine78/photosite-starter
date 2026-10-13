import { createHash } from "node:crypto";
import { argumentsOf, readPrivateBytes, newPrivateDirectory, writePrivateBytes } from "./private-operation-files.mts";
import { verifyReleaseSource } from "./release-source-verification.mts";

async function main() {
  const args = argumentsOf(process.argv.slice(2), ["receipt", "source-sha", "deployment-id", "project-id", "team-id", "out"]);
  const bytes = await readPrivateBytes(args.receipt, 4 * 1024 * 1024);
  const result = verifyReleaseSource(JSON.parse(bytes.toString("utf8")), {
    sourceSha: args["source-sha"], deploymentId: args["deployment-id"], projectId: args["project-id"], teamId: args["team-id"],
  });
  const folder = await newPrivateDirectory(args.out);
  await writePrivateBytes(folder, "receipt.json", JSON.stringify({ ...result, inputSha256: createHash("sha256").update(bytes).digest("hex") }, null, 2) + "\n");
  console.log(JSON.stringify(result));
  if (!result.providerSourceIdentityVerified) process.exitCode = 1;
}
main().catch(() => { console.error("[verify-release-source] Invalid or unavailable private evidence; verification refused."); process.exitCode = 1; });
