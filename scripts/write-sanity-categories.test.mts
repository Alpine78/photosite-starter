import { describe, expect, it, vi } from "vitest";

import {
  CATEGORY_WRITE_PLAN_VERSION,
  categoryDatasetIssues,
  buildCategoryPreflightQuery,
  preflightCategories,
  categoryDocumentsDigest,
  categoryWriteWaves,
  normalizeCategoryReadback,
  parseArguments,
  validateCategoryDocuments,
  validateCategoryWritePlan,
  type CategoryWriteDocument,
} from "./write-sanity-categories.mts";

const documents: readonly CategoryWriteDocument[] = [
  {
    _id: "migrated--category-motorsport",
    _type: "category",
    categoryId: "motorsport",
    slug: [
      { _key: "fi", _type: "localizedSlug", language: "fi", value: "moottoriurheilu" },
      { _key: "en", _type: "localizedSlug", language: "en", value: "motorsport" },
    ],
    label: [
      { _key: "fi", _type: "localizedText", language: "fi", value: "Moottoriurheilu" },
      { _key: "en", _type: "localizedText", language: "en", value: "Motorsport" },
    ],
    description: [{
      _key: "fi",
      _type: "categoryDescription",
      language: "fi",
      blocks: [{
        _key: "intro",
        _type: "categoryDescriptionParagraph",
        spans: [{ _key: "text", _type: "categoryDescriptionInlineSpan", text: "Rallikuvia." }],
      }],
    }],
    order: 0,
  },
  {
    _id: "migrated--category-wrc",
    _type: "category",
    categoryId: "wrc",
    parent: { _type: "reference", _ref: "migrated--category-motorsport" },
    slug: [
      { _key: "fi", _type: "localizedSlug", language: "fi", value: "wrc" },
      { _key: "en", _type: "localizedSlug", language: "en", value: "wrc" },
    ],
    label: [
      { _key: "fi", _type: "localizedText", language: "fi", value: "WRC" },
      { _key: "en", _type: "localizedText", language: "en", value: "WRC" },
    ],
    order: 1,
  },
];

describe("category write plan validation", () => {
  it("accepts a localized parent-child fragment", () => {
    const result = validateCategoryWritePlan({ version: CATEGORY_WRITE_PLAN_VERSION, documents });
    expect(result.issues).toEqual([]);
    expect(result.plan?.documents).toHaveLength(2);
  });

  it("rejects unexpected fields and descriptions that broaden the restricted schema", () => {
    const result = validateCategoryDocuments([{
      ...documents[0],
      secret: "must not be written",
      description: [{
        ...documents[0].description![0],
        blocks: [{
          ...documents[0].description![0].blocks[0],
          spans: [{ ...documents[0].description![0].blocks[0].spans[0], href: "javascript:alert(1)" }],
        }],
      }],
    }]);
    expect(result.issues).toContain("documents[0] has unsupported field(s): secret");
    expect(result.issues).toContain("documents[0].description[0].blocks[0].spans[0].href must be a safe http(s) URL or root-relative path");
  });

  it("retains safe description links through validation, digest and readback", () => {
    const linked = (href: string) => [{ ...documents[0], description: [{
      ...documents[0].description![0], blocks: [{
        ...documents[0].description![0].blocks[0], spans: [{
          ...documents[0].description![0].blocks[0].spans[0], href,
        }],
      }],
    }] }];
    for (const href of ["/services/photography", "https://example.test/guide"]) {
      const result = validateCategoryWritePlan({ version: CATEGORY_WRITE_PLAN_VERSION, documents: linked(href) });
      expect(result.issues).toEqual([]);
      expect(result.plan?.documents).toEqual(linked(href));
      expect(normalizeCategoryReadback(linked(href)[0])).toEqual(linked(href)[0]);
    }
    expect(categoryDocumentsDigest(linked("/services/one"))).not.toBe(categoryDocumentsDigest(linked("/services/two")));
    for (const href of ["#fragment", "//example.test", "data:text/html,test", "https://user:password@example.test", "/%2fexample.test", "/\\example.test", "/services?sort=newest", "/UPPER", "/services/"]) {
      expect(validateCategoryWritePlan({ version: CATEGORY_WRITE_PLAN_VERSION, documents: linked(href) }).plan).toBeUndefined();
    }
  });

  it("binds approval to normalized category content", () => {
    expect(categoryDocumentsDigest([...documents].reverse())).toBe(categoryDocumentsDigest(documents));
    expect(categoryDocumentsDigest([{ ...documents[0], order: 9 }, documents[1]])).not.toBe(categoryDocumentsDigest(documents));
  });

  it("writes parents before their children", () => {
    expect(categoryWriteWaves([...documents].reverse()).map((wave) => wave.map((document) => document.categoryId))).toEqual([
      ["motorsport"], ["wrc"],
    ]);
  });

  it("allows an exact rerun but refuses an editor change, draft, or foreign identity", () => {
    expect(categoryDatasetIssues(documents, documents)).toEqual([]);
    expect(categoryDatasetIssues([{ ...documents[0], order: 9 }], documents)).toContain(
      'planned document "migrated--category-motorsport" already exists with different content',
    );
    expect(categoryDatasetIssues([{ ...documents[0], _id: "drafts.migrated--category-motorsport" }], documents)).toContain(
      'planned document "migrated--category-motorsport" has an unpublished draft',
    );
    expect(categoryDatasetIssues([{ ...documents[0], _id: "other-category" }], documents)).toContain(
      'categoryId "motorsport" is already owned by "other-category"',
    );
  });

  it("normalizes GROQ nulls for omitted optional fields before readback", () => {
    expect(normalizeCategoryReadback({ ...documents[0], parent: null })).toEqual({
      ...documents[0],
    });
  });
});

describe("category write CLI", () => {
  it("is dry-run by default and accepts the apply guard explicitly", () => {
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
      const digest = categoryDocumentsDigest(JSON.parse(bytes.toString("utf8").replace(/^\uFEFF/, "")).documents);
      const args = ["--import", networkGuard, path.join(import.meta.dirname, "write-sanity-categories.mts"), "--plan", planPath, ...["--approved-digest", digest], ...(apply ? ["--yes"] : [])];
      const result = await promisify(execFile)(process.execPath, args, { env: { NODE_ENV: "test", NODE_NO_WARNINGS: "1" } })
        .then((value) => ({ code: 0, ...value }), (error: { code: number; stdout: string; stderr: string }) => error);
      expect(result.stderr).not.toContain("UNEXPECTED_NETWORK");
      expect(await readdir(root)).toEqual(["plan.json"]);
      return { ...result, digest };
    } finally { await rm(root, { recursive: true, force: true }); }
  }
  function fixture() { return { version: CATEGORY_WRITE_PLAN_VERSION, documents: documents.map((d) => ({ ...d, label: d.label.map((v) => ({ ...v, value: marker })) })) }; }
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


describe("planned identity preflight (AB#241)", () => {
  const connection = { projectId: "synthetic", dataset: "preview", apiVersion: "v2026-06-24", token: "synthetic-token" };
  it("queries published and draft IDs regardless of type and retains type identities", () => {
    const request = buildCategoryPreflightQuery(documents);
    expect(request.perspective).toBe("raw");
    expect(request.query).toContain('|| _id in $ids');
    expect(request.query).toContain('_type == "category"');
    expect(request.params?.ids).toEqual(documents.flatMap(d => [d._id, `drafts.${d._id}`]).sort());
  });
  it("returns a collision for a planned ID occupied by another type", async () => {
    const query = vi.fn(async (...args: unknown[]) => { void args; return [{ _id: documents[0]._id, _type: "unrelated" }]; });
    const issues = await preflightCategories(connection, documents, query);
    expect(query.mock.calls[0]).toEqual([connection, buildCategoryPreflightQuery(documents)]);
    expect(issues.join(" ")).toContain("different content");
  });
  it("accepts an exact rerun with projected optional nulls", async () => {
    const query = vi.fn(async () => documents.map(document => ({
      ...document, parent: document.parent ?? null, description: document.description ?? null,
    })));
    expect(await preflightCategories(connection, documents, query)).toEqual([]);
  });
  it("reports only the occupied ID in a mixed existing plan", async () => {
    const query = vi.fn(async () => [documents[0], { _id: documents[1]._id, _type: "unrelated" }]);
    expect(await preflightCategories(connection, documents, query)).toEqual([
      `planned document "${documents[1]._id}" already exists with different content`,
    ]);
  });
  it("refuses a wrong-type draft at a planned ID", async () => {
    const query = vi.fn(async () => [{ _id: `drafts.${documents[0]._id}`, _type: "unrelated" }]);
    expect(await preflightCategories(connection, documents, query)).toEqual([
      `planned document "${documents[0]._id}" has an unpublished draft`,
    ]);
  });
  it("refuses garbage and repeated raw IDs without echoing row content", () => {
    for (const row of [null, [], 7, "PRIVATE_SENTINEL", {}, { _id: " ", _type: "category", secret: "PRIVATE_SENTINEL" }]) {
      const issues = categoryDatasetIssues([row], documents); expect(issues.length).toBeGreaterThan(0); expect(issues.join(" ")).not.toContain("PRIVATE_SENTINEL");
    }
    expect(categoryDatasetIssues([documents[0], documents[0]], documents).join(" ")).toContain("repeats a document ID");
  });
});
