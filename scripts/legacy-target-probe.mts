import { redirectTargetUrl, sourceResponseIssues, targetResponseIssues, type MappingRow } from "./legacy-redirect-verification.mts";
import type { probeLegacyRedirect } from "./legacy-redirect-probe.mts";

/** One exact-URL target result per invocation, including a failed attempt. */
export function createLegacyTargetProbe<T>(probe: (url: string, readHtml: boolean) => Promise<T>): (url: string) => Promise<T> {
  const targets = new Map<string, Promise<T>>();
  return (url) => {
    let pending = targets.get(url);
    if (pending === undefined) {
      // Store before invoking: concurrent callers and synchronous failures
      // share the same attempt. The caller retains each row's fixed failure.
      pending = Promise.resolve().then(() => probe(url, true));
      targets.set(url, pending);
    }
    return pending;
  };
}

/** Keeps independent source evidence while sharing each declared target attempt. */
export async function verifyLegacyMappingRows(rows: readonly MappingRow[], origin: string, canonicalOrigin: string, probe: typeof probeLegacyRedirect) {
  const results: { source: string; sourceStatus?: number; targetStatus?: number; issues: string[] }[] = [];
  const probeTarget = createLegacyTargetProbe(probe);
  for (const row of rows) {
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
        const targetResponse = await probeTarget(target);
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
  return results;
}
