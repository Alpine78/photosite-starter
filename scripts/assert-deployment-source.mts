import { execFileSync } from "node:child_process";
import { attestDeploymentSource } from "./deployment-source-attestation.mts";
try {
  if (process.argv.length !== 3 || !/^[a-f0-9]{40}$/.test(process.argv[2])) throw new Error("INVALID_EXPECTED_SHA");
  const expected = process.argv[2];
  const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", timeout: 15_000, maxBuffer: 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });
  const evidence = { head: git(["rev-parse", "--verify", "HEAD"]).trim(), expectedTree: git(["rev-parse", "--verify", `${expected}^{tree}`]).trim(),
    headTree: git(["rev-parse", "--verify", "HEAD^{tree}"]).trim(), status: git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]) };
  console.log(JSON.stringify(attestDeploymentSource(expected, evidence)));
} catch {
  console.error("[assert-deployment-source] Source checkout identity or cleanliness could not be verified.");
  process.exitCode = 1;
}
