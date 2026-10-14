import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { verifyReleaseSource } from "./release-source-verification.mts";
import { createHash } from "node:crypto";
import inventory from "../src/lib/legacy-redirects-inventory.json" with { type: "json" };
import { LEGACY_REDIRECT_ENTRIES } from "../src/lib/legacy-redirects-data.ts";
import { ALREADY_LIVE_LEGACY_PATHS, EXCLUDED_LEGACY_PATHS, PENDING_LEGACY_PATHS } from "../src/lib/legacy-redirects-tracking.ts";
import { argumentsOf, readPrivateBytes, newPrivateDirectory, writePrivateBytes } from "./private-operation-files.mts";
import { buildMappingReport } from "./legacy-redirect-verification.mts";
import { verifyLegacyCandidate } from "./legacy-candidate-verification.mts";

async function main() {
  const args = argumentsOf(process.argv.slice(2), ["receipt", "url", "source-sha", "deployment-id", "project-id", "team-id", "canonical-origin", "out"]);
  const bytes = await readPrivateBytes(args.receipt, 4 * 1024 * 1024);
  const report = buildMappingReport({ inventory, entries: LEGACY_REDIRECT_ENTRIES, pending: PENDING_LEGACY_PATHS, excluded: EXCLUDED_LEGACY_PATHS, alreadyLive: ALREADY_LIVE_LEGACY_PATHS });
  const expected = { sourceSha: args["source-sha"], deploymentId: args["deployment-id"], projectId: args["project-id"], teamId: args["team-id"] };
  // Freeze the mapping/decision implementation as well as the remote source.
  verifyReleaseSource({}, expected); // validates all caller-owned identity shapes
  for (const filename of ["src/lib/legacy-redirects-data.ts", "src/lib/legacy-redirects-tracking.ts", "src/lib/legacy-redirects-inventory.json", "src/lib/legacy-redirects.ts"]) {
    const committed = execFileSync("git", ["show", `${expected.sourceSha}:${filename}`], { stdio: "pipe", timeout: 10_000, maxBuffer: 4 * 1024 * 1024 });
    if (!committed.equals(await readFile(filename))) throw new Error("MAPPING_SOURCE_MISMATCH");
  }
  // Reserve private output before network probes; never overwrite an existing run.
  const folder = await newPrivateDirectory(args.out);
  const result = await verifyLegacyCandidate({ url: args.url, canonicalOrigin: args["canonical-origin"], metadata: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), expected, rows: report.rows, pendingCount: report.counts.pending }, {
    readBypass: () => process.env.VERCEL_AUTOMATION_BYPASS_SECRET ?? "",
  });
  await writePrivateBytes(folder, "receipt.json", JSON.stringify({ ...result, providerReceiptSha256: createHash("sha256").update(bytes).digest("hex"), mappingSha256: createHash("sha256").update(JSON.stringify(report.rows)).digest("hex"), counts: report.counts }, null, 2) + "\n");
  // Complete per-source details remain private, never publish provider body/headers.
  console.log(JSON.stringify({ expected, status: result.status, checked: result.results.length, failed: result.results.filter(r => r.issues.length).length, pending: report.counts.pending, protectionAndNoindexVerified: true, finalProductionVerified: false }));
  if (result.status !== "passed") process.exitCode = 1;
}
main().catch(() => { console.error("[verify-legacy-candidate] Invalid, unavailable or unverified candidate; check refused. Details withheld."); process.exitCode = 1; });
