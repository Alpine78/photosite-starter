/** AB#19: observe exact pending paths; an HTTP result never decides their intent. */
import { parseVerificationOrigin, type MappingRow } from "./legacy-redirect-verification.mts";
import { probeLegacyRedirect } from "./legacy-redirect-probe.mts";

export async function observePendingLegacyPaths(rows: readonly MappingRow[], originInput: string,
  probe: typeof probeLegacyRedirect = probeLegacyRedirect) {
  const origin = parseVerificationOrigin(originInput);
  const pending = rows.filter((r) => r.outcome.kind === "pending");
  if (pending.length > 1000 || new Set(pending.map((r) => r.source)).size !== pending.length || pending.some((r) =>
    !r.source.startsWith("/") || r.source.startsWith("//") || /[\\:%?#\p{Cc}\p{Cf}]/u.test(r.source) ||
    r.source.length > 2048 || r.source.split("/").some((s) => s === "." || s === ".."))) throw new Error("PENDING_INPUT");
  const results: { source: string; observedStatus?: number; issue?: "probe-failed"; decision: "pending" }[] = [];
  for (const row of pending) {
    try {
      const response = await probe(new URL(row.source, origin).href);
      results.push({ source: row.source, observedStatus: response.status, decision: "pending" });
    } catch {
      results.push({ source: row.source, issue: "probe-failed", decision: "pending" });
    }
  }
  return { version: 1, origin, observedAt: new Date().toISOString(), status: "incomplete" as const,
    pendingCount: pending.length, results,
    limitations: ["http-status-is-not-an-owner-decision", "no-target-or-removal-inferred", "no-redirect-followed", "no-complete-launch-approval"] };
}
