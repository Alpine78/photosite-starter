import { describe, expect, it, vi } from "vitest";

import {
  FOUNDATION_WRITE_PLAN_VERSION,
  foundationDatasetIssues,
  buildFoundationPreflightQuery,
  preflightFoundation,
  foundationDocumentsDigest,
  parseArguments,
  validateFoundationWritePlan,
  type FoundationWritePlan,
  type SiteSettingsWriteDocument,
} from "./write-sanity-foundation.mts";

const text = (language: "fi" | "en", value: string) => ({
  _key: language,
  _type: "localizedText" as const,
  language,
  value,
});

const plan: FoundationWritePlan = {
  version: FOUNDATION_WRITE_PLAN_VERSION,
  documents: [
    {
      _id: "migrated--site-settings-production",
      _type: "siteSettings",
      siteName: [text("fi", "Valokuvaaja Esimerkki"), text("en", "Example Photography")],
      photographerName: "Example Photographer",
      tagline: [text("fi", "Kuvia."), text("en", "Photographs.")],
      featuredGalleryId: "rally-example",
      navigation: [{ _key: "stories", _type: "navigationItem", label: [text("fi", "Tarinat"), text("en", "Stories")], target: "story-root" }],
      contact: {
        _type: "object",
        email: "hello@example.test",
        privacyNotice: {
          _type: "object",
          collected: [text("fi", "Nimi"), text("en", "Name")],
          purpose: [text("fi", "Vastaaminen"), text("en", "Replying")],
          recipient: [text("fi", "Kuvaaja"), text("en", "Photographer")],
          retention: [text("fi", "Vuosi"), text("en", "One year")],
        },
      },
      socialLinks: [],
      footerLinks: [{ _key: "services", _type: "navigationItem", label: [text("fi", "Palvelut"), text("en", "Services")], target: "static", href: "/services" }],
      copyrightHolder: "Example Photographer",
      defaultSeo: {
        _type: "object",
        titleTemplate: [text("fi", "%s | Example"), text("en", "%s | Example Photography")],
        description: [text("fi", "Valokuvausta."), text("en", "Photography.")],
      },
    },
    {
      _id: "migrated--home-page-production",
      _type: "homePage",
      heroMedia: { _type: "reference", _ref: "migrated--media-rally-hero" },
      heroAction: { _key: "stories", _type: "homeAction", label: [text("fi", "Katso"), text("en", "Explore")], target: "story-root" },
      intro: [text("fi", "Tervetuloa."), text("en", "Welcome.")],
      sections: [{
        _key: "stories",
        _type: "homeSection",
        title: [text("fi", "Tarinat"), text("en", "Stories")],
        description: [text("fi", "Selaa."), text("en", "Browse.")],
        target: "story-root",
      }],
    },
  ],
};
const site = plan.documents.find((document): document is SiteSettingsWriteDocument => document._type === "siteSettings")!;

describe("foundation write plan validation", () => {
  it("accepts one strict site settings and home page pair", () => {
    const result = validateFoundationWritePlan(plan);
    expect(result.issues).toEqual([]);
    expect(result.plan?.documents).toHaveLength(2);
  });

  it("rejects unexpected fields and a malformed title template", () => {
    const result = validateFoundationWritePlan({
      ...plan,
      documents: [{ ...site, internalNote: "must not be written", defaultSeo: { ...site.defaultSeo, titleTemplate: [text("fi", "Example")] } }, plan.documents[1]],
    });
    expect(result.issues).toContain("documents[0] has unsupported field(s): internalNote");
    expect(result.issues).toContain("documents[0].defaultSeo.titleTemplate.fi must contain exactly one %s");
  });

  it("binds the approval digest to normalized singleton content", () => {
    expect(foundationDocumentsDigest([...plan.documents].reverse())).toBe(foundationDocumentsDigest(plan.documents));
    expect(foundationDocumentsDigest([{ ...site, siteName: [text("fi", "Muutettu")] }, plan.documents.find((document) => document._type === "homePage")!])).not.toBe(foundationDocumentsDigest(plan.documents));
  });

  it("allows an exact rerun and rejects edits, drafts, and another singleton", () => {
    expect(foundationDatasetIssues(plan.documents, plan.documents)).toEqual([]);
    expect(foundationDatasetIssues([{ ...site, siteName: [text("fi", "Muutettu")] }], plan.documents)).toContain(
      'planned document "migrated--site-settings-production" already exists with different content',
    );
    expect(foundationDatasetIssues([{ ...site, _id: "drafts.migrated--site-settings-production" }], plan.documents)).toContain(
      'planned document "migrated--site-settings-production" has an unpublished draft',
    );
    expect(foundationDatasetIssues([{ ...site, _id: "other-site-settings" }], plan.documents)).toContain(
      'another siteSettings singleton already exists: "other-site-settings"',
    );
  });
});

describe("foundation write CLI", () => {
  it("is offline by default and requires an explicit apply flag", () => {
    expect(parseArguments(["--plan", "plan.json"])).toEqual({ plan: "plan.json", apply: false });
    expect(parseArguments(["--plan", "plan.json", "--approved-digest", "a".repeat(64), "--yes"])).toEqual({
      plan: "plan.json", approvedDigest: "a".repeat(64), apply: true,
    });
  });
});

describe("CLI UTF-8 input integrity", () => {
  const marker = "Åä 😀 \uFFFD";
  const networkGuard = "data:text/javascript," + encodeURIComponent("globalThis.fetch = () => { process.stderr.write('UNEXPECTED_NETWORK'); process.exit(86); };");
  async function execute(bytes: Buffer, apply = false) {
    const { mkdtemp, writeFile, rm, readdir } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const root = await mkdtemp(path.join(tmpdir(), "utf8-plan-"));
    try {
      const planPath = path.join(root, "plan.json");
      await writeFile(planPath, bytes);
      const digest = foundationDocumentsDigest(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")).documents);
      const args = ["--import", networkGuard, path.join(import.meta.dirname, "write-sanity-foundation.mts"), "--plan", planPath, ...["--approved-digest", digest], ...(apply ? ["--yes"] : [])];
      const result = await promisify(execFile)(process.execPath, args, { env: { NODE_ENV: "test", NODE_NO_WARNINGS: "1" } })
        .then((value) => ({ code: 0, ...value }), (error: { code: number; stdout: string; stderr: string }) => error);
      expect(result.stderr).not.toContain("UNEXPECTED_NETWORK");
      expect(await readdir(root)).toEqual(["plan.json"]);
      return { ...result, digest };
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  function fixture() { return { ...plan, documents: plan.documents.map((d) => d._type === "siteSettings" ? { ...d, photographerName: marker } : d) }; }
  function corrupt(bad: number[]) {
    const text = JSON.stringify(fixture());
    const at = text.indexOf("\uFFFD");
    expect(at).toBeGreaterThan(-1);
    return Buffer.concat([Buffer.from(text.slice(0, at)), Buffer.from(bad), Buffer.from(text.slice(at + 1))]);
  }
  it("preserves valid Unicode, an intentional replacement character and its approval digest", async () => {
    const result = await execute(Buffer.from(JSON.stringify(fixture())));
    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Dry run only");
    expect(result.stdout).toContain(`Approved digest: ${result.digest}`);
  });
  it.each([[0xff], [0xc2], [0xc0, 0x80], [0xed, 0xa0, 0x80]])("refuses malformed UTF-8 %j before parsing or local output", async (...bad) => {
    const result = await execute(corrupt(bad));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/UTF-8|utf-8/);
  });
  it("refuses malformed UTF-8 with --yes before resolving credentials", async () => {
    const result = await execute(corrupt([0xff]), true);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/UTF-8|utf-8/);
    expect(result.stderr).not.toContain("SANITY_");
  });
  it("retains the JSON BOM rejection instead of silently removing it", async () => {
    const result = await execute(Buffer.from("\uFEFF" + JSON.stringify(fixture())));
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
  });
});


describe("planned identity preflight (AB#242)", () => {
  const connection = { projectId: "synthetic", dataset: "preview", apiVersion: "v2026-06-24", token: "synthetic-token" };
  it("queries published and draft IDs regardless of type and retains type identities", () => {
    const request = buildFoundationPreflightQuery(plan.documents);
    expect(request.perspective).toBe("raw");
    expect(request.query).toContain('|| _id in $ids');
    expect(request.query).toContain("_type");
    expect(request.params?.ids).toEqual(plan.documents.flatMap(d => [d._id, `drafts.${d._id}`]).sort());
  });
  it("returns a collision for a planned ID occupied by another type", async () => {
    const query = vi.fn(async (...args: unknown[]) => { void args; return [{ _id: plan.documents[0]._id, _type: "unrelated" }]; });
    const issues = await preflightFoundation(connection, plan.documents, query);
    expect(query.mock.calls[0]).toEqual([connection, buildFoundationPreflightQuery(plan.documents)]);
    expect(issues.join(" ")).toContain("different content");
  });
  it("refuses garbage and repeated raw IDs without echoing row content", () => {
    for (const row of [null, [], 7, "PRIVATE_SENTINEL", {}, { _id: " ", _type: "category", secret: "PRIVATE_SENTINEL" }]) {
      const issues = foundationDatasetIssues([row], plan.documents); expect(issues.length).toBeGreaterThan(0); expect(issues.join(" ")).not.toContain("PRIVATE_SENTINEL");
    }
    expect(foundationDatasetIssues([plan.documents[0], plan.documents[0]], plan.documents).join(" ")).toContain("repeats a document ID");
  });
});
