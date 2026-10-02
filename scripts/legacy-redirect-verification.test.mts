import { describe, expect, it } from "vitest";
import {
  buildMappingReport,
  parseVerificationOrigin,
  redirectTargetUrl,
  sourceResponseIssues,
  targetResponseIssues,
  verificationStatus,
  type MappingRow,
} from "./legacy-redirect-verification.mts";

const origin = "https://candidate.example.test";
const canonicalOrigin = "https://site.example.test";
const redirect = { kind: "redirect", target: "/stories/category", reservedQueryParams: "strip" } as const;
const input = {
  inventory: {
    sourceHost: "legacy.example.test", crawledAt: "2026-01-01T00:00:00Z", recordCount: 6, distinctPathCount: 5,
    records: [
      { path: "/old", status: 200 }, { path: "/tag", status: 200 },
      { path: "/pending", status: "error" }, { path: "/pending", status: 200 },
      { path: "/error", status: 200 }, { path: "/", status: 200 },
    ],
  },
  entries: [{ source: "/old", outcome: redirect }, { source: "/tag", outcome: { kind: "gone", reason: "No same-intent replacement." } }] as const,
  pending: ["/pending"], excluded: ["/error"], alreadyLive: ["/"],
};
const row: MappingRow = { source: "/old", crawlStatuses: [200], outcome: redirect };
const html = (head: string, body = "") => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
const canonical = `<link rel="canonical" href="${canonicalOrigin}${redirect.target}">`;
const response = { status: 200, contentType: "text/html; charset=utf-8", html: html(canonical) };

describe("complete mapping report", () => {
  it("accounts for every distinct source while preserving conflicting crawl observations", () => {
    const report = buildMappingReport(input);
    expect(report.counts).toEqual({ redirect: 1, gone: 1, pending: 1, excluded: 1, "already-live": 1 });
    expect(report.rows.map((r) => r.source)).toEqual(["/", "/error", "/old", "/pending", "/tag"]);
    expect(report.rows.find((r) => r.source === "/pending")).toEqual({ source: "/pending", crawlStatuses: [200, "error"], outcome: { kind: "pending" } });
  });

  it("refuses forgotten, overlapping, duplicated and non-inventory sources", () => {
    expect(() => buildMappingReport({ ...input, pending: [] })).toThrow("no classification");
    expect(() => buildMappingReport({ ...input, pending: ["/old", "/pending"] })).toThrow("more than once");
    expect(() => buildMappingReport({ ...input, pending: ["/pending", "/pending"] })).toThrow("more than once");
    expect(() => buildMappingReport({ ...input, pending: ["/unknown"] })).toThrow("absent from inventory");
  });

  it("refuses inventory metadata drift and invalid raw redirects", () => {
    expect(() => buildMappingReport({ ...input, inventory: { ...input.inventory, recordCount: 5 } })).toThrow("counts disagree");
    expect(() => buildMappingReport({ ...input, inventory: { ...input.inventory, distinctPathCount: 6 } })).toThrow("counts disagree");
    expect(() => buildMappingReport({ ...input, entries: [{ source: "/old", outcome: { ...redirect, target: "/tag" } }, input.entries[1]] })).toThrow("itself another legacy source");
    expect(() => buildMappingReport({ ...input, entries: [input.entries[0], input.entries[0]] })).toThrow("more than once");
  });

  it("supports a clone with an explicitly empty migration inventory", () => {
    expect(buildMappingReport({ ...input, inventory: { ...input.inventory, recordCount: 0, distinctPathCount: 0, records: [] }, entries: [], pending: [], excluded: [], alreadyLive: [] }).rows).toEqual([]);
  });
});

describe("anonymous origin and source responses", () => {
  it.each(["https://site.example.test", "http://localhost:3100/", "http://127.0.0.1:3100", "http://[::1]:3100"])("accepts %s", (value) => {
    expect(parseVerificationOrigin(value)).toBe(new URL(value).origin);
  });
  it.each(["http://site.example.test", "https://user:secret@site.example.test", `${origin}/content`, `${origin}?secret=value`, `${origin}#fragment`, `${origin}?`, "file:///tmp/content"])("refuses %s", (value) => {
    expect(() => parseVerificationOrigin(value)).toThrow();
  });

  it("requires a direct 301 to exactly the declared same-origin target", () => {
    expect(sourceResponseIssues(row, 301, redirect.target, origin)).toEqual([]);
    expect(sourceResponseIssues(row, 308, redirect.target, origin)).toEqual(["expected-status-301"]);
    for (const location of [null, "https://other.example.test/stories/category", "/old", `${redirect.target}/`, `${redirect.target}?state=extra`, `${redirect.target}#fragment`, "http://["]) {
      expect(sourceResponseIssues(row, 301, location, origin)).toEqual(["unexpected-location"]);
    }
  });

  it("requires the controlled fallback query in a fallback redirect", () => {
    const fallback = { ...redirect, fallbackNotice: "content-unavailable" as const };
    expect(redirectTargetUrl(fallback, origin)).toBe(`${origin}${redirect.target}?legacy-notice=content-unavailable`);
    expect(sourceResponseIssues({ ...row, outcome: fallback }, 301, redirect.target, origin)).toEqual(["unexpected-location"]);
  });

  it("fails every decided classification's unexpected status and never accepts a pending 404", () => {
    for (const [kind, expected] of [["gone", 410], ["excluded", 404], ["already-live", 200]] as const) {
      const outcome = kind === "gone" ? { kind, reason: "No replacement." } : { kind };
      expect(sourceResponseIssues({ ...row, outcome }, expected, null, origin)).toEqual([]);
      expect(sourceResponseIssues({ ...row, outcome }, 302, "/", origin)).toEqual([`expected-status-${expected}`]);
    }
    expect(() => sourceResponseIssues({ ...row, outcome: { kind: "pending" } }, 404, null, origin)).toThrow("no approved response");
  });
});

describe("target availability and canonical metadata", () => {
  it("accepts the canonical origin separately from the candidate's serving origin", () => {
    expect(targetResponseIssues(redirect, response, canonicalOrigin)).toEqual([]);
    expect(targetResponseIssues(redirect, response, origin)).toEqual(["target-canonical-mismatch"]);
  });

  it("accepts the application's slash-free home canonical, retaining query/fragment checks", () => {
    const home = { ...redirect, target: "/" };
    expect(targetResponseIssues(home, { ...response, html: html(`<link rel='canonical' href='${canonicalOrigin}'>`) }, canonicalOrigin)).toEqual([]);
    expect(targetResponseIssues(home, { ...response, html: html(`<link rel='canonical' href='${canonicalOrigin}/?state=x'>`) }, canonicalOrigin)).toEqual(["target-canonical-mismatch"]);
  });

  it.each([301, 302, 308, 404, 410, 500, 503])("refuses a target answering %s, including chains and loops", (status) => {
    expect(targetResponseIssues(redirect, { ...response, status }, canonicalOrigin)).toEqual(["target-not-200"]);
  });

  it("rejects non-HTML, missing/duplicate canonical links and mismatched URL components", () => {
    expect(targetResponseIssues(redirect, { ...response, contentType: "application/json" }, canonicalOrigin)).toEqual(["target-not-html"]);
    for (const content of ["", canonical + canonical, canonical.replace(redirect.target, "/wrong"), canonical.replace(redirect.target, `${redirect.target}?state=x`), canonical.replace(redirect.target, `${redirect.target}#fragment`), canonical.replace(canonicalOrigin, origin)]) {
      expect(targetResponseIssues(redirect, { ...response, html: html(content) }, canonicalOrigin)).toEqual(["target-canonical-mismatch"]);
    }
  });

  it("checks fallback notice metadata and basic status markup without executing HTML", () => {
    const fallback = { ...redirect, fallbackNotice: "content-unavailable" as const };
    const valid = { ...response, html: html(`${canonical}<meta name="robots" content="noindex, follow">`, "<p role='status'>Fixed application notice.</p>") };
    expect(targetResponseIssues(fallback, valid, canonicalOrigin)).toEqual([]);
    expect(targetResponseIssues(fallback, response, canonicalOrigin)).toEqual(["fallback-missing-noindex", "fallback-missing-status"]);
    expect(targetResponseIssues(fallback, { ...valid, html: valid.html.replace(canonical, `${canonical}<link rel='alternate' hreflang='fi' href='/fi'>`) }, canonicalOrigin)).toEqual(["fallback-has-language-alternates"]);
    // A canonical-shaped string inside a script is never a canonical element.
    expect(targetResponseIssues(redirect, { ...response, html: html("", `<script>const text = '${canonical}'</script>`) }, canonicalOrigin)).toEqual(["target-canonical-mismatch"]);
  });

  it("cannot pass while decisions or failing checks remain", () => {
    expect(verificationStatus(1, [{ issues: [] }])).toBe("incomplete");
    expect(verificationStatus(1, [{ issues: ["probe-failed"] }])).toBe("failed");
    expect(verificationStatus(0, [{ issues: [] }])).toBe("passed");
  });
});
