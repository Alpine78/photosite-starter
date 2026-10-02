#!/usr/bin/env node
/** AB#19: offline mapping report, or anonymous checks against a production build. */
import inventory from "../src/lib/legacy-redirects-inventory.json" with { type: "json" };
import { LEGACY_REDIRECT_ENTRIES } from "../src/lib/legacy-redirects-data.ts";
import { ALREADY_LIVE_LEGACY_PATHS, EXCLUDED_LEGACY_PATHS, PENDING_LEGACY_PATHS } from "../src/lib/legacy-redirects-tracking.ts";
import {
  buildMappingReport,
  parseVerificationOrigin,
  redirectTargetUrl,
  sourceResponseIssues,
  targetResponseIssues,
  verificationStatus,
} from "./legacy-redirect-verification.mts";

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_HTML_BYTES = 4 * 1024 * 1024;

async function probe(url: string, readHtml = false) {
  const response = await fetch(url, {
    redirect: "manual",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "text/html" },
  });
  let html = "";
  if (readHtml && response.status === 200 && response.body) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_HTML_BYTES) throw new Error("Response body exceeds the verification limit.");
        html += decoder.decode(value, { stream: true });
      }
      html += decoder.decode();
    } finally { await reader.cancel(); }
  } else {
    await response.body?.cancel();
  }
  return {
    status: response.status,
    location: response.headers.get("location"),
    contentType: response.headers.get("content-type"),
    html,
  };
}

async function main() {
  const [mode, originArgument, canonicalArgument, ...extra] = process.argv.slice(2);
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
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  const origin = parseVerificationOrigin(originArgument!);
  const canonicalOrigin = parseVerificationOrigin(canonicalArgument ?? origin);
  const results: { source: string; sourceStatus?: number; targetStatus?: number; issues: string[] }[] = [];
  const targets = new Map<string, Awaited<ReturnType<typeof probe>>>();
  for (const row of report.rows) {
    // A missing decision is a launch blocker, never an implicitly accepted 404.
    if (row.outcome.kind === "pending") continue;
    const result: (typeof results)[number] = { source: row.source, issues: [] };
    try {
      const response = await probe(new URL(row.source, origin).href);
      result.sourceStatus = response.status;
      result.issues.push(...sourceResponseIssues(row, response.status, response.location, origin));
      if (row.outcome.kind === "redirect") {
        // Probe only the declared target; never follow a response's Location.
        const target = redirectTargetUrl(row.outcome, origin);
        const targetResponse = targets.get(target) ?? await probe(target, true);
        targets.set(target, targetResponse);
        result.targetStatus = targetResponse.status;
        result.issues.push(...targetResponseIssues(row.outcome, targetResponse, canonicalOrigin));
      }
    } catch {
      // Provider HTML, response headers and network errors can contain sensitive
      // values. Retain only our fixed error class and numeric statuses.
      result.issues.push("probe-failed");
    }
    results.push(result);
  }
  const status = verificationStatus(report.counts.pending, results);
  console.log(JSON.stringify({ ...report, verification: { origin, canonicalOrigin, status, results } }, null, 2));
  if (status !== "passed") process.exitCode = 1;
}

main().catch(() => {
  console.error("Legacy mapping verification failed: invalid arguments or mapping. Use report | check <origin> [<canonical-origin>]; inspect the committed mapping and inventory.");
  process.exitCode = 1;
});
