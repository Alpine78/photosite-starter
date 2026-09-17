/** Synthetic manifests only — no private migration material, no filesystem, no network. */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { CONVERSION_POLICY_VERSION } from "./joomla-html-conversion.mts";
import {
  assessApprovedConversion,
  MANIFEST_COLUMNS,
  normalizeLanguage,
  reviewImportManifest,
  type ApprovedArticle,
} from "./joomla-import-manifest.mts";

const DIGEST = "a".repeat(64);
const RESOLVED_DIGEST = "c".repeat(64);
const HEADER = MANIFEST_COLUMNS.join(";");

function row(overrides: Partial<Record<string, string>> = {}): string {
  const base: Record<string, string> = {
    joomla_id: "347",
    language: "fi-FI",
    content_id: "pentax-645z",
    slug: "pentax-645z",
    canonical_category: "blogi",
    secondary_categories: "",
    phase: "launch",
    published_at: "2015-06-01T00:00:00.000Z",
    event_date: "",
    source_digest: DIGEST,
    resolved_digest: RESOLVED_DIGEST,
    conversion_policy: CONVERSION_POLICY_VERSION,
    acknowledged_findings: "",
    public_launch_decision: "INCLUDE",
    eligible_for_import: "YES",
    approved_by: "Ilkka Rytkönen",
    approved_at: "2026-09-17",
  };
  return MANIFEST_COLUMNS.map((column) => overrides[column] ?? base[column] ?? "").join(";");
}

function review(rows: readonly string[], phase = "launch") {
  return reviewImportManifest([HEADER, ...rows].join("\n"), { phase });
}

describe("approval gating", () => {
  it("approves a complete row and reports the manifest digest", () => {
    const result = review([row()]);
    expect(result.errors).toEqual([]);
    expect(result.approved).toHaveLength(1);
    expect(result.approved[0]).toMatchObject({
      sourceId: "347",
      language: "fi",
      contentId: "pentax-645z",
      canonicalCategory: "blogi",
      approvedBy: "Ilkka Rytkönen",
    });
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/u);
  });

  it("defers a selected row that is not yet eligible, rather than failing", () => {
    const result = review([row({ eligible_for_import: "NO" }), row({ joomla_id: "350", content_id: "x-t10", slug: "x-t10" })]);
    expect(result.errors).toEqual([]);
    expect(result.approved.map((entry) => entry.sourceId)).toEqual(["350"]);
    expect(result.deferred[0]).toMatchObject({ sourceId: "347", reason: "selected but not yet eligible for import" });
  });

  it("defers a LATER or EXCLUDE row as a deliberate decision", () => {
    const result = review([
      row({ public_launch_decision: "LATER" }),
      row({ joomla_id: "65", content_id: "kept", slug: "kept" }),
    ]);
    expect(result.errors).toEqual([]);
    expect(result.deferred[0]?.reason).toContain("laterd");
  });

  it("errors, rather than deferring, on a row that claims approval but is incomplete", () => {
    // This is the important asymmetry: a malformed approval must not read as a
    // deferral and vanish quietly from the launch.
    const result = review([row({ approved_by: "", source_digest: "nope" })]);
    expect(result.approved).toEqual([]);
    // Exactly one error: the "no approved row names the phase" note is
    // suppressed when a real row error already explains the empty result.
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("no approver recorded");
    expect(result.errors[0]).toContain("source_digest is not a 64-character SHA-256 hex digest");
  });

  it("validates resolved_digest the same way as source_digest", () => {
    const result = review([row({ resolved_digest: "nope" })]);
    expect(result.errors[0]).toContain("resolved_digest is not a 64-character SHA-256 hex digest");
  });

  it("rejects a non-calendar approval date and a non-calendar publish instant", () => {
    expect(review([row({ approved_at: "2026-02-31" })]).errors[0]).toContain("not a real YYYY-MM-DD");
    expect(review([row({ published_at: "2015-02-31T00:00:00.000Z" })]).errors[0]).toContain("not a real ISO instant");
  });
});

describe("identity and route collisions", () => {
  it("rejects two rows for the same source article and language", () => {
    expect(review([row(), row()]).errors[0]).toContain("already has a row for this language");
  });

  it("rejects two articles claiming one contentId in one language", () => {
    const result = review([row(), row({ joomla_id: "999", slug: "toinen" })]);
    expect(result.errors[0]).toContain('content_id "pentax-645z" in fi is already claimed');
  });

  it("rejects two articles claiming one route", () => {
    const result = review([row(), row({ joomla_id: "999", content_id: "toinen" })]);
    expect(result.errors[0]).toContain("already claimed by source 347");
  });

  it("allows one contentId across two languages — that is a translation, not a collision", () => {
    const result = review([row(), row({ joomla_id: "394", language: "en-GB", slug: "pentax-645z-en" })]);
    expect(result.errors).toEqual([]);
    expect(result.approved.map((entry) => entry.language)).toEqual(["fi", "en"]);
  });

  it("rejects a category that is both canonical and secondary", () => {
    expect(review([row({ secondary_categories: "blogi" })]).errors[0]).toContain(
      "both the canonical and a secondary category",
    );
  });

  it("rejects a repeated secondary category — the article schema refuses a duplicate at publish time", () => {
    expect(review([row({ secondary_categories: "news,news" })]).errors[0]).toContain(
      "listed as a secondary category more than once",
    );
  });
});

describe("round-11 review finding: an approved row's publishedAt/eventDate are canonicalized, not carried verbatim", () => {
  it("canonicalizes a numeric-offset published_at into the real adapter's exact UTC shape", () => {
    const result = review([row({ published_at: "2015-06-01T02:00:00+02:00" })]);
    expect(result.errors).toEqual([]);
    expect(result.approved[0]?.publishedAt).toBe("2015-06-01T00:00:00.000Z");
  });

  it("canonicalizes a bare-Z event_date with no fractional seconds", () => {
    const result = review([row({ event_date: "2015-07-01T00:00:00Z" })]);
    expect(result.approved[0]?.eventDate).toBe("2015-07-01T00:00:00.000Z");
  });

  it("still rejects a published_at that is not a real calendar instant, even though it is structurally ISO-shaped", () => {
    const result = review([row({ published_at: "2026-02-31T00:00:00Z" })]);
    expect(result.approved).toEqual([]);
    expect(result.errors[0]).toContain("not a real ISO instant");
  });
});

describe("phases", () => {
  it("defers an approved row belonging to another phase", () => {
    const result = review([row({ phase: "phase-2" }), row({ joomla_id: "350", content_id: "x-t10", slug: "x-t10" })]);
    expect(result.approved.map((entry) => entry.sourceId)).toEqual(["350"]);
    expect(result.deferred[0]?.reason).toContain('later phase ("phase-2")');
  });

  it("still detects a collision against a row in another phase", () => {
    // A phase-local check would only surface this at write time.
    const result = review([row(), row({ joomla_id: "999", phase: "phase-2", content_id: "muu" })]);
    expect(result.errors[0]).toContain("already claimed by source 347");
  });

  it("refuses to call an empty phase a clean run", () => {
    const result = review([row()], "typo-phase");
    expect(result.approved).toEqual([]);
    expect(result.errors[0]).toContain('No approved row names the phase "typo-phase"');
    expect(result.errors[0]).toContain("launch");
  });
});

describe("malformed input", () => {
  it("reports an empty manifest and a missing column set", () => {
    expect(reviewImportManifest("", { phase: "launch" }).errors[0]).toContain("empty");
    expect(reviewImportManifest("joomla_id;language", { phase: "launch" }).errors[0]).toContain("missing required columns");
  });

  it("ignores comment and blank lines", () => {
    const text = [HEADER, "# a note", "", row()].join("\n");
    expect(reviewImportManifest(text, { phase: "launch" }).approved).toHaveLength(1);
  });

  it("normalizes a regional language tag to its subtag", () => {
    expect(normalizeLanguage("en-GB")).toBe("en");
    expect(normalizeLanguage("fi")).toBe("fi");
  });
});

describe("assessApprovedConversion", () => {
  const approval: ApprovedArticle = {
    sourceId: "347",
    language: "fi",
    contentId: "pentax-645z",
    slug: "pentax-645z",
    canonicalCategory: "blogi",
    secondaryCategories: [],
    phase: "launch",
    publishedAt: "2015-06-01T00:00:00.000Z",
    sourceDigest: DIGEST,
    resolvedDigest: RESOLVED_DIGEST,
    conversionPolicy: CONVERSION_POLICY_VERSION,
    acknowledgedFindings: ["link-destination-dropped"],
    approvedBy: "Ilkka",
    approvedAt: "2026-09-17",
  };

  it("passes a clean conversion", () => {
    expect(
      assessApprovedConversion({ approval, sourceDigest: DIGEST, resolvedDigest: RESOLVED_DIGEST, findings: [] }),
    ).toEqual([]);
  });

  it("blocks on any refusal", () => {
    const blockers = assessApprovedConversion({
      approval,
      sourceDigest: DIGEST,
      resolvedDigest: RESOLVED_DIGEST,
      findings: [{ severity: "refusal", code: "unknown-plugin-marker" }],
    });
    expect(blockers).toEqual(['unresolved refusal "unknown-plugin-marker"']);
  });

  it("allows an acknowledged lossy finding but blocks an unacknowledged one", () => {
    const blockers = assessApprovedConversion({
      approval,
      sourceDigest: DIGEST,
      resolvedDigest: RESOLVED_DIGEST,
      findings: [
        { severity: "lossy", code: "link-destination-dropped" },
        { severity: "lossy", code: "end-gallery-relocated" },
      ],
    });
    expect(blockers).toEqual(['unacknowledged lossy conversion "end-gallery-relocated"']);
  });

  it("invalidates the acknowledgement when the source article has changed", () => {
    const changed = createHash("sha256").update("uusi runko", "utf8").digest("hex");
    const blockers = assessApprovedConversion({
      approval,
      sourceDigest: changed,
      resolvedDigest: RESOLVED_DIGEST,
      findings: [{ severity: "lossy", code: "link-destination-dropped" }],
    });
    expect(blockers[0]).toContain("has changed since it was approved");
  });

  it("invalidates the acknowledgement when the resolved output has changed — a different photo, alt text, or video title, source text unchanged", () => {
    const changedResolved = createHash("sha256").update("eri kuva", "utf8").digest("hex");
    const blockers = assessApprovedConversion({
      approval,
      sourceDigest: DIGEST,
      resolvedDigest: changedResolved,
      findings: [{ severity: "lossy", code: "link-destination-dropped" }],
    });
    expect(blockers[0]).toContain("resolved photographs, gallery order, alt text, or video titles have changed");
  });

  it("invalidates the acknowledgement when the conversion policy has moved on", () => {
    const blockers = assessApprovedConversion({
      approval: { ...approval, conversionPolicy: "joomla-conversion-v0" },
      sourceDigest: DIGEST,
      resolvedDigest: RESOLVED_DIGEST,
      findings: [],
    });
    expect(blockers[0]).toContain("joomla-conversion-v0");
  });
});
