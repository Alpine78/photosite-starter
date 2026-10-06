/** AB#204: linear, offline npm audit v2 validation and redacted counting. */
const severities = ["info", "low", "moderate", "high", "critical"] as const;
type Severity = typeof severities[number];
const invalid = () => { throw new Error("invalid-audit-report"); };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Record<string, unknown>;
}
function severity(value: unknown): Severity {
  if (!severities.includes(value as Severity)) return invalid();
  return value as Severity;
}
export function summarizeNpmAudit(value: unknown) {
  const report = object(value);
  if (report.auditReportVersion !== 2 || Object.hasOwn(report, "error")) return invalid();
  const entries = Object.entries(object(report.vulnerabilities));
  if (entries.length > 20_000) return invalid();
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0 };
  const reverse = new Map<string, string[]>(), reachable = new Set<string>(), advisoryIdentities = new Map<number, string>(), ghsa = new Set<string>();
  const entryNames = new Set(entries.map(([name]) => name));
  let concreteEntries = 0, inheritedEntries = 0, directDependencies = 0, stringViaEdges = 0;
  for (const [name, raw] of entries) {
    const entry = object(raw);
    if (entry.name !== name || !name || typeof entry.isDirect !== "boolean" || !Array.isArray(entry.via) || entry.via.length === 0 || entry.via.length > 20_000) return invalid();
    counts[severity(entry.severity)]++;
    if (entry.isDirect) directDependencies++;
    let concrete = false, inherited = false;
    for (const via of entry.via) {
      if (typeof via === "string") {
        if (!entryNames.has(via)) return invalid();
        const dependants = reverse.get(via) ?? []; dependants.push(name); reverse.set(via, dependants);
        inherited = true; if (++stringViaEdges > 200_000) return invalid();
      } else {
        const advisory = object(via);
        if (!Number.isSafeInteger(advisory.source) || (advisory.source as number) <= 0) return invalid();
        for (const key of ["name", "dependency", "title", "url", "range"]) if (typeof advisory[key] !== "string" || !(advisory[key] as string).length) return invalid();
        severity(advisory.severity);
        const id = advisory.source as number;
        const identity = JSON.stringify([advisory.name, advisory.dependency, advisory.title, advisory.url, advisory.range, advisory.severity]);
        if (advisoryIdentities.has(id) && advisoryIdentities.get(id) !== identity) return invalid();
        advisoryIdentities.set(id, identity);
        const match = /^https:\/\/github\.com\/advisories\/(GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4})$/.exec(advisory.url as string);
        if (match) ghsa.add(match[1]);
        concrete = true;
      }
    }
    if (concrete) { reachable.add(name); concreteEntries++; }
    if (inherited) inheritedEntries++;
  }
  // Propagate concrete reachability once per node; no recursive traversal or
  // transitive advisory sets. A cycle is valid only if it reaches a real advisory.
  const queue = [...reachable];
  for (let index = 0; index < queue.length; index++) for (const name of reverse.get(queue[index]) ?? []) if (!reachable.has(name)) { reachable.add(name); queue.push(name); }
  if (reachable.size !== entries.length) return invalid();
  const metadata = object(object(report.metadata).vulnerabilities);
  for (const level of severities) if (metadata[level] !== counts[level]) return invalid();
  if (metadata.total !== entries.length) return invalid();
  return { schemaVersion: 1, status: entries.length ? "findings" : "clean", affectedEntries: entries.length, entriesBySeverity: counts, concreteEntries, inheritedEntries, directDependencies, stringViaEdges, uniqueNumericAdvisories: advisoryIdentities.size, numericAdvisoryIds: [...advisoryIdentities.keys()].sort((a, b) => a - b), githubAdvisoryIds: [...ghsa].sort() };
}
