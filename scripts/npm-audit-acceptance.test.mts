import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { acceptanceEnds, evaluateAcceptance, parseAcceptedAdvisories, type TriagedEntry } from "./npm-audit-acceptance.mts";

const exception = {
  target: "studio", advisorySource: 100, ghsa: "GHSA-hp3w-g68c-fv3c", workItem: "AB#160", expiresOn: "2026-11-19",
  maxSeverity: "moderate", reason: "Reviewed residual.",
  affected: { dep: ["node_modules/dep"], top: ["node_modules/top"] },
};
const policy = (overrides: Record<string, unknown> = {}) =>
  parseAcceptedAdvisories({ schemaVersion: 1, accepted: [{ ...exception, ...overrides }] });
const GHSA = "GHSA-hp3w-g68c-fv3c";
const entry = (name: string, path: string, ids: number[] = [], severity = "moderate", ghsa: string | null = GHSA): TriagedEntry =>
  ({ name, severity, directAdvisories: ids.map((source) => ({ source, ghsa })), nodes: [{ path }] });
const findings = [entry("dep", "node_modules/dep", [100]), entry("top", "node_modules/top")];
const before = new Date("2026-11-18T23:59:59.999Z");

describe("parseAcceptedAdvisories (AB#380)", () => {
  it("reads the committed exceptions file", () => {
    const committed = parseAcceptedAdvisories(JSON.parse(readFileSync(new URL("./npm-audit-accepted-advisories.json", import.meta.url), "utf8")));
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ target: "studio", advisorySource: 1241202, expiresOn: "2026-11-19" });
  });

  it("covers the whole reviewed Studio chain, with or without the peer-inherited locale entry", () => {
    const committed = parseAcceptedAdvisories(JSON.parse(readFileSync(new URL("./npm-audit-accepted-advisories.json", import.meta.url), "utf8")));
    const chain = ["@sanity/cli", "@sanity/cli-build", "@sanity/locale-fi-fi", "@sanity/runtime-cli", "@vercel/frameworks",
      "argparse", "js-yaml", "sanity", "sprintf-js"].map((name) => entry(name, `node_modules/${name}`, name === "sprintf-js" ? [1241202] : []));
    const at = new Date("2026-10-20T06:00:00Z");
    expect(evaluateAcceptance("studio", chain, committed, at)).toMatchObject({ allAccepted: true, uncovered: [] });
    expect(evaluateAcceptance("studio", chain.filter((item) => item.name !== "@sanity/locale-fi-fi"), committed, at).allAccepted).toBe(true);
  });

  it.each([
    ["an unknown key", { extra: 1 }],
    ["a wrong target", { target: "app" }],
    ["a non-calendar date", { expiresOn: "2026-02-30" }],
    ["a malformed date", { expiresOn: "19.11.2026" }],
    ["an unknown severity", { maxSeverity: "medium" }],
    ["a malformed GHSA", { ghsa: "GHSA-1234" }],
    ["a non-integer source", { advisorySource: 1.5 }],
    ["an empty affected map", { affected: {} }],
    ["a path outside node_modules", { affected: { dep: ["../dep"] } }],
    ["a bad work item", { workItem: "160" }],
  ])("fails closed on %s", (_label, overrides) => {
    expect(() => policy(overrides)).toThrow("invalid-accepted-advisories");
  });

  it("rejects a malformed root", () => {
    for (const value of [null, [], {}, { schemaVersion: 2, accepted: [] }, { schemaVersion: 1, accepted: {} }]) {
      expect(() => parseAcceptedAdvisories(value)).toThrow("invalid-accepted-advisories");
    }
  });
});

describe("evaluateAcceptance (AB#380)", () => {
  it("ends acceptance at 00:00 UTC on expiresOn", () => {
    expect(acceptanceEnds("2026-11-19")).toBe(Date.UTC(2026, 10, 19));
    expect(evaluateAcceptance("studio", findings, policy(), before).allAccepted).toBe(true);
    expect(evaluateAcceptance("studio", findings, policy(), new Date("2026-11-19T00:00:00Z")))
      .toMatchObject({ allAccepted: false, uncovered: ["dep", "top"] });
  });

  it("covers a direct finding and its inherited chain, and reports the exception", () => {
    expect(evaluateAcceptance("studio", findings, policy(), before)).toEqual({
      allAccepted: true, uncovered: [],
      applied: [{ ghsa: "GHSA-hp3w-g68c-fv3c", advisorySource: 100, workItem: "AB#160", expiresOn: "2026-11-19" }],
    });
  });

  it("covers a cycle of inherited findings without traversal", () => {
    const cyclic = [...findings, entry("a", "node_modules/a"), entry("b", "node_modules/b")];
    expect(evaluateAcceptance("studio", cyclic, policy({ affected: { ...exception.affected, a: ["node_modules/a"], b: ["node_modules/b"] } }), before).allAccepted).toBe(true);
  });

  it("never applies an exception to another target", () => {
    expect(evaluateAcceptance("root", findings, policy(), before)).toMatchObject({ allAccepted: false, uncovered: ["dep", "top"] });
  });

  it("leaves a new advisory, package, install path or severity uncovered", () => {
    expect(evaluateAcceptance("studio", [entry("dep", "node_modules/dep", [100, 200]), findings[1]], policy(), before).uncovered).toEqual(["dep"]);
    expect(evaluateAcceptance("studio", [...findings, entry("other", "node_modules/other")], policy(), before).uncovered).toEqual(["other"]);
    expect(evaluateAcceptance("studio", [findings[0], entry("top", "node_modules/x/node_modules/top")], policy(), before).uncovered).toEqual(["top"]);
    expect(evaluateAcceptance("studio", [entry("dep", "node_modules/dep", [100], "high"), findings[1]], policy(), before).uncovered).toEqual(["dep"]);
  });

  it("requires the advisory's source and GHSA to match the same exception", () => {
    expect(evaluateAcceptance("studio", [entry("dep", "node_modules/dep", [100], "moderate", "GHSA-2222-3333-4444"), findings[1]], policy(), before).uncovered).toEqual(["dep"]);
    expect(evaluateAcceptance("studio", [entry("dep", "node_modules/dep", [100], "moderate", null), findings[1]], policy(), before).uncovered).toEqual(["dep"]);
  });

  it("keeps mixed accepted and new findings red", () => {
    const mixed = [...findings, entry("new", "node_modules/new", [300], "low")];
    expect(evaluateAcceptance("studio", mixed, policy(), before)).toMatchObject({ allAccepted: false, uncovered: ["new"] });
  });

  it("does not turn a clean or info-only audit into an acceptance", () => {
    expect(evaluateAcceptance("studio", [], policy(), before).allAccepted).toBe(false);
    expect(evaluateAcceptance("studio", [entry("dep", "node_modules/dep", [100], "info")], policy(), before).allAccepted).toBe(false);
  });

  it("rejects an invalid evaluation instant", () => {
    expect(() => evaluateAcceptance("studio", findings, policy(), new Date(Number.NaN))).toThrow();
  });
});
