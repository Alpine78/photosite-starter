/**
 * AB#380: owner-accepted, dated dependency advisories for the scheduled audit.
 *
 * Pure decisions only. An exception covers a finding only when it names the
 * same audit target, every advisory reported directly on that package (its npm
 * source and GHSA identity together), and
 * every reviewed install path of it; the finding's severity may not exceed the
 * accepted ceiling, and acceptance ends at 00:00 UTC on `expiresOn`. A new
 * advisory, package, install location or severity, or an expired exception,
 * leaves the finding uncovered and the gate red. No graph is traversed: every
 * advisory reachable through `via` is reported directly on its vulnerable
 * package, so requiring each package's direct advisories covers them all,
 * including through cycles.
 */
import { AUDIT_TARGETS, type AuditTarget } from "./npm-audit-capture.mts";

const SEVERITIES = ["info", "low", "moderate", "high", "critical"] as const;
type Severity = typeof SEVERITIES[number];

export type AcceptedAdvisory = Readonly<{
  target: AuditTarget;
  advisorySource: number;
  ghsa: string;
  workItem: string;
  expiresOn: string;
  maxSeverity: Severity;
  reason: string;
  /** Reviewed install paths per affected package name. */
  affected: Readonly<Record<string, readonly string[]>>;
}>;

export type TriagedEntry = Readonly<{
  name: string;
  severity: string;
  /** Source and GHSA of every advisory reported directly on this package. */
  directAdvisories: readonly { readonly source: number; readonly ghsa: string | null }[];
  nodes: readonly { readonly path: string }[];
}>;

const invalid = (): never => { throw new Error("invalid-accepted-advisories"); };
const text = (value: unknown, pattern: RegExp, max = 500): string =>
  typeof value === "string" && value.length <= max && pattern.test(value) ? value : invalid();

/** The UTC instant acceptance ends: 00:00 on `expiresOn`, a real calendar date. */
export function acceptanceEnds(expiresOn: string): number {
  const [year, month, day] = text(expiresOn, /^\d{4}-\d{2}-\d{2}$/).split("-").map(Number);
  const instant = Date.UTC(year, month - 1, day);
  const back = new Date(instant);
  if (back.getUTCFullYear() !== year || back.getUTCMonth() !== month - 1 || back.getUTCDate() !== day) return invalid();
  return instant;
}

/** Strict reader: any unknown key, missing field or malformed value fails closed. */
export function parseAcceptedAdvisories(value: unknown): readonly AcceptedAdvisory[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  const root = value as Record<string, unknown>;
  if (Object.keys(root).sort().join(",") !== "accepted,schemaVersion" || root.schemaVersion !== 1 ||
      !Array.isArray(root.accepted) || root.accepted.length > 50) return invalid();
  return root.accepted.map((raw): AcceptedAdvisory => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return invalid();
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).sort().join(",") !==
        "advisorySource,affected,expiresOn,ghsa,maxSeverity,reason,target,workItem") return invalid();
    if (!AUDIT_TARGETS.includes(entry.target as AuditTarget)) return invalid();
    if (!Number.isSafeInteger(entry.advisorySource) || (entry.advisorySource as number) <= 0) return invalid();
    if (!SEVERITIES.includes(entry.maxSeverity as Severity)) return invalid();
    acceptanceEnds(entry.expiresOn as string);
    const affected = entry.affected;
    if (!affected || typeof affected !== "object" || Array.isArray(affected)) return invalid();
    const reviewed: Record<string, readonly string[]> = {};
    const names = Object.keys(affected);
    if (!names.length || names.length > 100) return invalid();
    for (const name of names) {
      text(name, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9_][a-z0-9._-]*$/, 214);
      const paths = (affected as Record<string, unknown>)[name];
      if (!Array.isArray(paths) || !paths.length || paths.length > 50) return invalid();
      reviewed[name] = paths.map((path) => text(path, /^node_modules\/[^\s]+$/, 4096));
    }
    return {
      target: entry.target as AuditTarget,
      advisorySource: entry.advisorySource as number,
      ghsa: text(entry.ghsa, /^GHSA-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}-[23456789cfghjmpqrvwx]{4}$/),
      workItem: text(entry.workItem, /^AB#\d{1,7}$/),
      expiresOn: entry.expiresOn as string,
      maxSeverity: entry.maxSeverity as Severity,
      reason: text(entry.reason, /^[^\u0000-\u001f]+$/, 1000),
      affected: reviewed,
    };
  });
}

export type AcceptanceDecision = Readonly<{
  /** True only when findings exist and every one is covered. */
  allAccepted: boolean;
  /** The exceptions that covered at least one finding. */
  applied: readonly { ghsa: string; advisorySource: number; workItem: string; expiresOn: string }[];
  /** Package names left uncovered (names only, never provider strings). */
  uncovered: readonly string[];
}>;

const rank = (severity: string) => SEVERITIES.indexOf(severity as Severity);

export function evaluateAcceptance(
  target: AuditTarget,
  entries: readonly TriagedEntry[],
  accepted: readonly AcceptedAdvisory[],
  now: Date,
): AcceptanceDecision {
  const instant = now.getTime();
  if (!Number.isFinite(instant)) return invalid();
  const active = accepted.filter((entry) => entry.target === target && instant < acceptanceEnds(entry.expiresOn));
  const findings = entries.filter((entry) => rank(entry.severity) > rank("info"));
  const applied = new Map<number, AcceptedAdvisory>();
  const uncovered: string[] = [];
  for (const finding of findings) {
    const covering = active.filter((exception) => Object.hasOwn(exception.affected, finding.name) &&
      rank(finding.severity) >= 0 && rank(finding.severity) <= rank(exception.maxSeverity) &&
      finding.nodes.every((node) => exception.affected[finding.name].includes(node.path)));
    // Both identifiers must match one exception, so a mistyped source paired
    // with another advisory's GHSA cannot approve the wrong advisory.
    if (!covering.length || !finding.directAdvisories.every((advisory) => covering.some((exception) =>
        exception.advisorySource === advisory.source && advisory.ghsa !== null && exception.ghsa === advisory.ghsa))) {
      uncovered.push(finding.name);
      continue;
    }
    for (const exception of covering) applied.set(exception.advisorySource, exception);
  }
  return {
    allAccepted: findings.length > 0 && uncovered.length === 0,
    applied: [...applied.values()].map(({ ghsa, advisorySource, workItem, expiresOn }) =>
      ({ ghsa, advisorySource, workItem, expiresOn })),
    uncovered: uncovered.sort(),
  };
}
