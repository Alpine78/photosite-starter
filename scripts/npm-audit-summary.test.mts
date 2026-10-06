import { describe, expect, it } from "vitest";
import { summarizeNpmAudit } from "./npm-audit-summary.mts";
const advisory = { source: 100, name: "dep", dependency: "dep", title: "Synthetic issue", url: "https://github.com/advisories/GHSA-2345-6789-cfgh", range: "<2", severity: "high" };
const entry = (name: string, via: unknown[]) => ({ name, via, isDirect: false, severity: "high" });
const report = (vulnerabilities: Record<string, unknown>) => ({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: Object.keys(vulnerabilities).length, critical: 0, total: Object.keys(vulnerabilities).length } } });
describe("npm audit report validation", () => {
  it("separates entries, edges and unique advisories", () => {
    const result = summarizeNpmAudit(report({ dep: entry("dep", [advisory, advisory]), parent: entry("parent", ["dep"]), root: { ...entry("root", ["parent", "dep"]), isDirect: true } }));
    expect(result).toMatchObject({ affectedEntries: 3, uniqueNumericAdvisories: 1, inheritedEntries: 2, stringViaEdges: 3, directDependencies: 1, githubAdvisoryIds: ["GHSA-2345-6789-cfgh"] });
  });
  it("reports a validated clean report", () => expect(summarizeNpmAudit(report({})).status).toBe("clean"));
  it("does not invent GHSA for other URLs", () => expect(summarizeNpmAudit(report({ dep: entry("dep", [{ ...advisory, url: "https://registry.example.test/100" }]) })).githubAdvisoryIds).toEqual([]));
  it("rejects missing references, empty chains and pure cycles", () => {
    for (const entries of [{ a: entry("a", ["missing"]) }, { a: entry("a", []) }, { a: entry("a", ["b"]), b: entry("b", ["a"]) }]) expect(() => summarizeNpmAudit(report(entries))).toThrow("invalid-audit-report");
  });
  it("handles cycles with concrete reachability without recursion", () => expect(summarizeNpmAudit(report({ a: entry("a", ["b", advisory]), b: entry("b", ["a"]) })).uniqueNumericAdvisories).toBe(1));
  it("handles prototype-like package names and deep chains", () => {
    const entries: Record<string, unknown> = Object.create(null); entries.__proto__ = entry("__proto__", [advisory]);
    for (let i = 0; i < 5000; i++) entries[`dep${i}`] = entry(`dep${i}`, [i === 0 ? "__proto__" : `dep${i - 1}`]);
    expect(summarizeNpmAudit(report(entries)).affectedEntries).toBe(5001);
  });
  it("rejects conflicts, metadata mismatch, bad severity and provider errors", () => {
    for (const value of [report({ dep: entry("dep", [advisory, { ...advisory, title: "conflict" }]) }), { ...report({}), error: { secret: "TOKEN" } }, { ...report({}), auditReportVersion: 1 }, { ...report({}), metadata: { vulnerabilities: {} } }, report({ dep: { ...entry("dep", [advisory]), severity: "unknown" } })]) expect(() => summarizeNpmAudit(value)).toThrow("invalid-audit-report");
  });
});
