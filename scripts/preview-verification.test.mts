import { describe, expect, it } from "vitest";

import {
  classifyIndexing,
  classifyProtection,
  hasNoindexDirective,
  parseDeploymentUrl,
  verifyPreviewDeployment,
} from "./preview-verification.mts";

describe("access protection", () => {
  it("accepts the refusals a protection layer answers with", () => {
    expect(classifyProtection(401).ok).toBe(true);
    expect(classifyProtection(403).ok).toBe(true);
  });

  it("rejects a deployment that serves the application to anyone", () => {
    const outcome = classifyProtection(200);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("readable by anyone");
  });

  it("treats an unrecognised answer as unverified rather than protected", () => {
    // A redirect could be a protection layer bouncing the request or the app's
    // own routing; a 404 could be either. Neither proves protection, and this
    // check exists precisely to refuse to assume.
    for (const status of [301, 302, 307, 308, 404, 500, 502]) {
      expect(classifyProtection(status).ok).toBe(false);
    }
  });
});

describe("noindex directive parsing", () => {
  it("reads the directive the provider documents sending", () => {
    expect(hasNoindexDirective("noindex")).toBe(true);
  });

  it("reads it out of a list, whatever case or spacing it arrives in", () => {
    expect(hasNoindexDirective("noindex, nofollow")).toBe(true);
    expect(hasNoindexDirective("nofollow,noindex")).toBe(true);
    expect(hasNoindexDirective("  NoIndex  ")).toBe(true);
  });

  it("reads a directive scoped to one crawler", () => {
    expect(hasNoindexDirective("googlebot: noindex")).toBe(true);
    expect(hasNoindexDirective("nofollow, bingbot: noindex")).toBe(true);
  });

  it("accepts none, which is defined as noindex plus nofollow", () => {
    expect(hasNoindexDirective("none")).toBe(true);
  });

  it("does not mistake a neighbouring directive for noindex", () => {
    expect(hasNoindexDirective("nofollow")).toBe(false);
    expect(hasNoindexDirective("index, follow")).toBe(false);
    expect(hasNoindexDirective("noarchive, nosnippet")).toBe(false);
    // Substring matching would pass this; a crawler would not.
    expect(hasNoindexDirective("unavailable_after: 25 Jun 2010 15:00:00 PST")).toBe(
      false,
    );
  });

  it("treats an absent header as no directive", () => {
    expect(hasNoindexDirective(null)).toBe(false);
    expect(hasNoindexDirective("")).toBe(false);
  });
});

describe("indexing check", () => {
  it("passes when the bypassed response carries noindex", () => {
    expect(classifyIndexing(200, "noindex").ok).toBe(true);
  });

  it("fails when the response carries no such header", () => {
    const outcome = classifyIndexing(200, null);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("no X-Robots-Tag");
  });

  it("reports a wrong bypass secret as a bypass problem, not an indexing verdict", () => {
    // A 401 here says the header did not open the deployment. Reporting it as
    // "not indexable" would be a false pass on the check that matters.
    const outcome = classifyIndexing(401, null);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("bypass secret");
  });
});

describe("whole verification", () => {
  it("passes only when protection and noindex both hold", () => {
    expect(
      verifyPreviewDeployment({
        protectionStatus: 401,
        bypassStatus: 200,
        robotsTag: "noindex",
      }).ok,
    ).toBe(true);
  });

  it("reports every failing check in one run", () => {
    const verification = verifyPreviewDeployment({
      protectionStatus: 200,
      bypassStatus: 200,
      robotsTag: null,
    });

    expect(verification.ok).toBe(false);
    expect(verification.checks.filter((check) => !check.ok)).toHaveLength(2);
  });

  it("fails an open deployment even when it is non-indexable", () => {
    // noindex asks a crawler not to list the URL. It asks nothing of a person
    // who has it, which is why neither check substitutes for the other.
    expect(
      verifyPreviewDeployment({
        protectionStatus: 200,
        bypassStatus: 200,
        robotsTag: "noindex",
      }).ok,
    ).toBe(false);
  });

  it("names each check so a failure says which property is missing", () => {
    const names = verifyPreviewDeployment({
      protectionStatus: 401,
      bypassStatus: 200,
      robotsTag: "noindex",
    }).checks.map((check) => check.name);

    expect(names).toEqual(["access protection", "noindex"]);
  });
});

describe("deployment URL", () => {
  it("accepts a generated deployment URL", () => {
    expect(parseDeploymentUrl("https://photosite-abc123.vercel.app").href).toBe(
      "https://photosite-abc123.vercel.app/",
    );
  });

  it("tolerates the surrounding whitespace a captured command output carries", () => {
    expect(parseDeploymentUrl("  https://example.vercel.app\n").href).toBe(
      "https://example.vercel.app/",
    );
  });

  it("refuses a URL carrying a query, which is how a leaked bypass secret looks", () => {
    expect(() =>
      parseDeploymentUrl(
        "https://example.vercel.app?x-vercel-protection-bypass=secret",
      ),
    ).toThrow(/never in the URL/);
  });

  it("refuses credentials in the URL", () => {
    expect(() => parseDeploymentUrl("https://user:pass@example.vercel.app")).toThrow(
      /credentials/,
    );
  });

  it("refuses anything that is not an absolute HTTPS URL", () => {
    expect(() => parseDeploymentUrl("http://example.vercel.app")).toThrow(/HTTPS/);
    expect(() => parseDeploymentUrl("example.vercel.app")).toThrow(/absolute/);
    expect(() => parseDeploymentUrl("")).toThrow(/absolute/);
  });
});
