#!/usr/bin/env node
/** AB#19: offline mapping report, or anonymous checks against a production build. */
import inventory from "../src/lib/legacy-redirects-inventory.json" with { type: "json" };
import { LEGACY_REDIRECT_ENTRIES } from "../src/lib/legacy-redirects-data.ts";
import { ALREADY_LIVE_LEGACY_PATHS, EXCLUDED_LEGACY_PATHS, PENDING_LEGACY_PATHS } from "../src/lib/legacy-redirects-tracking.ts";
import {
  buildMappingReport,
  parseVerificationOrigin,
  pendingLegacyReviewCsv,
  verificationStatus,
} from "./legacy-redirect-verification.mts";

import { probeLegacyRedirect as probe } from "./legacy-redirect-probe.mts";
import { verifyLegacyMappingRows } from "./legacy-target-probe.mts";

async function main() {
  const argumentsList = process.argv.slice(2);
  const csv = argumentsList.length === 2 && argumentsList[0] === "report" && argumentsList[1] === "--csv";
  const [mode, originArgument, canonicalArgument, ...extra] = csv ? ["report"] : argumentsList;
  if ((mode !== "report" && mode !== "check") || extra.length > 0 ||
      (mode === "report" && originArgument !== undefined) ||
      (mode === "check" && originArgument === undefined)) {
    throw new Error("Usage: npm run verify:legacy-redirects -- report | check <origin> [<canonical-origin>]");
  }
  const report = buildMappingReport({
    inventory,
    entries: LEGACY_REDIRECT_ENTRIES,
    pending: PENDING_LEGACY_PATHS,
    excluded: EXCLUDED_LEGACY_PATHS,
    alreadyLive: ALREADY_LIVE_LEGACY_PATHS,
  });
  if (mode === "report") {
    if (csv) process.stdout.write(pendingLegacyReviewCsv(report));
    else console.log(JSON.stringify(report, null, 2));
    return;
  }
  const origin = parseVerificationOrigin(originArgument!);
  const canonicalOrigin = parseVerificationOrigin(canonicalArgument ?? origin);
  const results = await verifyLegacyMappingRows(report.rows, origin, canonicalOrigin, probe);
  const status = verificationStatus(report.counts.pending, results);
  console.log(JSON.stringify({ ...report, verification: { origin, canonicalOrigin, status, results } }, null, 2));
  if (status !== "passed") process.exitCode = 1;
}

main().catch(() => {
  console.error("Legacy mapping verification failed: invalid arguments or mapping. Use report [--csv] | check <origin> [<canonical-origin>]; inspect the committed mapping and inventory.");
  process.exitCode = 1;
});
