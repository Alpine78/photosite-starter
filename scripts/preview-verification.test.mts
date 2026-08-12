import { describe, expect, it } from "vitest";

import {
  classifyIndexing,
  classifyProtection,
  hasNoindexDirective,
  parseDeploymentId,
  parseDeploymentUrl,
  validateDeploymentIdentity,
  verifyPreviewDeployment,
} from "./preview-verification.mts";

describe("access protection", () => {
  it("accepts the 401 challenge Vercel Authentication answers with", () => {
    expect(classifyProtection(401).ok).toBe(true);
  });

  it("refuses to read a 403 as proof that authentication is enabled", () => {
    // The platform firewall and bot protection also deny with 403, and the
    // automation bypass lifts those too — so 403 here followed by 200 with the
    // bypass is exactly what an unprotected deployment behind a firewall rule
    // looks like. Accepting it would report that deployment as verified.
    const outcome = classifyProtection(403);

    expect(outcome.ok).toBe(false);
    expect(outcome.detail).toContain("does not prove");
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

  it("accepts harmless case and surrounding whitespace differences", () => {
    expect(hasNoindexDirective("  NoIndex  ")).toBe(true);
  });

  it("refuses every crawler-scoped form", () => {
    expect(hasNoindexDirective("googlebot: noindex")).toBe(false);
    // Both comma-separated rules remain scoped to googlebot. Fetch may also
    // join repeated headers with a comma, so the exact provider contract is the
    // only unambiguous value after the response has been normalized.
    expect(hasNoindexDirective("googlebot: nofollow, noindex")).toBe(false);
    expect(hasNoindexDirective("otherbot: noindex, nofollow")).toBe(false);
  });

  it("refuses alternate or combined directives instead of guessing scope", () => {
    expect(hasNoindexDirective("noindex, nofollow")).toBe(false);
    expect(hasNoindexDirective("nofollow,noindex")).toBe(false);
    expect(hasNoindexDirective("none")).toBe(false);
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
  it("accepts a generated deployment URL for later API verification", () => {
    expect(
      parseDeploymentUrl("https://photosite-starter-abc123-acme.vercel.app").href,
    ).toBe("https://photosite-starter-abc123-acme.vercel.app/");
  });

  it("tolerates the surrounding whitespace a captured command output carries", () => {
    expect(
      parseDeploymentUrl("  https://photosite-starter-abc123.vercel.app\n").href,
    ).toBe("https://photosite-starter-abc123.vercel.app/");
  });

  it("does not pretend a hostname prefix establishes project ownership", () => {
    expect(
      parseDeploymentUrl(
        "https://photosite-starter-evil-attacker.vercel.app",
      ).hostname,
    ).toBe("photosite-starter-evil-attacker.vercel.app");
  });

  it("refuses a host outside the provider's deployment domain", () => {
    expect(() => parseDeploymentUrl("https://attacker.example/")).toThrow(
      /generated \.vercel\.app deployment URL/,
    );
    expect(() =>
      parseDeploymentUrl("https://photosite-starter-abc.attacker.example/"),
    ).toThrow(/generated \.vercel\.app deployment URL/);
  });

  it("refuses a path, so the probe always addresses the deployment root", () => {
    expect(() =>
      parseDeploymentUrl("https://photosite-starter-abc.vercel.app/admin"),
    ).toThrow(/deployment root/);
  });

  it("refuses an explicit port", () => {
    expect(() =>
      parseDeploymentUrl("https://photosite-starter-abc.vercel.app:8443"),
    ).toThrow(/default HTTPS port/);
  });

  it("refuses a URL carrying a query, which is how a leaked bypass secret looks", () => {
    expect(() =>
      parseDeploymentUrl(
        "https://photosite-starter-abc.vercel.app?x-vercel-protection-bypass=secret",
      ),
    ).toThrow(/never in the URL/);
  });

  it("refuses credentials in the URL", () => {
    expect(() =>
      parseDeploymentUrl("https://user:pass@photosite-starter-abc.vercel.app"),
    ).toThrow(/credentials/);
  });

  it("refuses anything that is not an absolute HTTPS URL", () => {
    expect(() =>
      parseDeploymentUrl("http://photosite-starter-abc.vercel.app"),
    ).toThrow(/HTTPS/);
    expect(() => parseDeploymentUrl("photosite-starter-abc.vercel.app")).toThrow(
      /absolute/,
    );
    expect(() => parseDeploymentUrl("")).toThrow(/absolute/);
  });
});

describe("authenticated deployment identity", () => {
  const URL = new globalThis.URL(
    "https://photosite-starter-abc123-acme.vercel.app",
  );
  const EXPECTED = {
    projectId: "prj_expected123",
    ownerId: "team_expected123",
    url: URL,
    deploymentId: "dpl_expected123",
  } as const;

  const RESPONSE = {
    id: "dpl_expected123",
    projectId: "prj_expected123",
    ownerId: "team_expected123",
    url: "photosite-starter-abc123-acme.vercel.app",
  } as const;

  it("binds a deployment to its immutable ID, project, team, and hostname", () => {
    expect(validateDeploymentIdentity(RESPONSE, EXPECTED)).toEqual({
      id: "dpl_expected123",
      projectId: "prj_expected123",
      ownerId: "team_expected123",
      hostname: "photosite-starter-abc123-acme.vercel.app",
    });
  });

  it("rejects the same-named deployment of another project", () => {
    expect(() =>
      validateDeploymentIdentity(
        { ...RESPONSE, projectId: "prj_attacker123" },
        EXPECTED,
      ),
    ).toThrow(/belongs to project/);
  });

  it("rejects a deployment owned by another team", () => {
    expect(() =>
      validateDeploymentIdentity(
        { ...RESPONSE, ownerId: "team_attacker123" },
        EXPECTED,
      ),
    ).toThrow(/belongs to owner/);
  });

  it("rejects a response for a different hostname or deployment ID", () => {
    expect(() =>
      validateDeploymentIdentity(
        { ...RESPONSE, url: "other-project-attacker.vercel.app" },
        EXPECTED,
      ),
    ).toThrow(/deployment host/);
    expect(() =>
      validateDeploymentIdentity(
        { ...RESPONSE, id: "dpl_other123" },
        EXPECTED,
      ),
    ).toThrow(/returned deployment/);
  });

  it("requires the private identity fields returned to an authorized caller", () => {
    expect(() =>
      validateDeploymentIdentity(
        { id: RESPONSE.id, url: RESPONSE.url },
        EXPECTED,
      ),
    ).toThrow(/project ID/);
  });

  it("binds a clone whose scope is a personal account rather than a team", () => {
    // Vercel scopes are not all named `team_…`. The binding that matters is the
    // comparison against the authenticated response, so a shape rule on the
    // configured value would only lock the starter to one kind of account.
    const identity = validateDeploymentIdentity(
      { ...RESPONSE, ownerId: "user_9zz" },
      { ...EXPECTED, ownerId: "user_9zz" },
    );

    expect(identity.ownerId).toBe("user_9zz");
  });

  it("still refuses a personal-scope deployment owned by someone else", () => {
    expect(() =>
      validateDeploymentIdentity(
        { ...RESPONSE, ownerId: "user_stranger" },
        { ...EXPECTED, ownerId: "user_9zz" },
      ),
    ).toThrow(/belongs to owner/);
  });

  it("names the missing setting instead of blaming the provider's response", () => {
    // An operator reading "Vercel deployment response has no valid expected
    // project ID" goes looking at Vercel. The fault is a pipeline variable.
    expect(() =>
      validateDeploymentIdentity(RESPONSE, { ...EXPECTED, projectId: "" }),
    ).toThrow(/VERCEL_PROJECT_ID is not set/);
    expect(() =>
      validateDeploymentIdentity(RESPONSE, { ...EXPECTED, ownerId: "  " }),
    ).toThrow(/VERCEL_ORG_ID is not set/);
  });

  it("accepts only an immutable Vercel deployment ID for cleanup", () => {
    expect(parseDeploymentId("  dpl_expected123\n")).toBe("dpl_expected123");
    expect(() => parseDeploymentId("photosite-starter")).toThrow(
      /immutable dpl_/,
    );
    expect(() => parseDeploymentId("https://example.vercel.app")).toThrow(
      /immutable dpl_/,
    );
  });
});
