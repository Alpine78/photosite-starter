/**
 * Synthetic fixtures only — no real photographs, no `joomla-backup/` dependency,
 * matching this feature's existing rule. Network-touching functions are exercised
 * with an injected `fetchImplementation`, the same convention `sanity-seed-http.test.mts`
 * already uses; a handful of CLI-level tests run the command as a real subprocess to
 * prove argument handling and the dry-run network guarantee.
 */

import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile, symlink, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

import {
  assertNoPendingReferencesRemain,
  chunkIdsByByteBudget,
  collectRequiredCategoryLanguages,
  mergeExistingMediaFields,
  parseArguments,
  resolveCategoryReferences,
  resolveContainedSourcePath,
  runCollisionPreflight,
  splitIntoWaves,
  substitutePendingReferences,
  validatePlanContract,
  verifyAndDeriveAsset,
  verifyWrittenDocuments,
} from "./write-joomla-content.mts";
import { parseSeedConnection } from "./sanity-seed-http.mts";
import {
  IMPORT_PLAN_VERSION,
  PENDING_ASSET_PREFIX,
  PENDING_CATEGORY_PREFIX,
  writablePlanDigest,
  type ImportPlan,
  type PlannedDocument,
} from "./joomla-import-plan.mts";

const run = promisify(execFile);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fakeConnection() {
  return parseSeedConnection({ projectId: "abc123", dataset: "prod", apiVersion: "v2024-01-01", token: "t" });
}

// ---------------------------------------------------------------------------
// parseArguments
// ---------------------------------------------------------------------------

describe("parseArguments", () => {
  it("parses required flags and defaults --yes to false", () => {
    const options = parseArguments(["--plan", "p.json", "--image-root", "root", "--out", "out", "--approved-digest", "a".repeat(64)]);
    expect(options).toMatchObject({
      plan: "p.json",
      imageRoot: "root",
      out: "out",
      approvedDigest: "a".repeat(64),
      apply: false,
    });
  });

  it("sets apply when --yes is present", () => {
    const options = parseArguments([
      "--plan",
      "p.json",
      "--image-root",
      "root",
      "--out",
      "out",
      "--approved-digest",
      "a".repeat(64),
      "--yes",
    ]);
    expect(options.apply).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// validatePlanContract
// ---------------------------------------------------------------------------

function goodDocuments(): readonly PlannedDocument[] {
  return [
    {
      _id: "migrated--media-photo-1",
      _type: "media",
      mediaId: "photo-1",
      image: { _type: "image", asset: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}photo-1` } },
    },
    {
      _id: "migrated--article-a-fi",
      _type: "article",
      contentId: "a",
      language: "fi",
      title: "T",
      canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
    },
  ];
}

function goodPlan(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    version: IMPORT_PLAN_VERSION,
    conversionPolicy: "x",
    phase: "launch",
    manifestDigest: "m".repeat(64),
    sourceExportDigest: "s".repeat(64),
    documents: goodDocuments(),
    assetRequirements: [{ mediaId: "photo-1", sourceLocator: "a/one.jpg", contentHash: "a".repeat(64) }],
    categoryRequirements: [{ categoryId: "blogi" }],
    photographIdentities: {},
    blocked: [],
    errors: [],
    writable: false,
    notWritableBecause: [],
    ...overrides,
  };
}

describe("validatePlanContract", () => {
  it("accepts an article canonically placed at the story root without a category reference", () => {
    const documents: readonly PlannedDocument[] = [
      {
        _id: "migrated--article-portfolio-fi",
        _type: "article",
        contentId: "portfolio",
        language: "fi",
        title: "Portfolio",
        canonicalAtStoryRoot: true,
      },
    ];
    const result = validatePlanContract(
      goodPlan({ documents, assetRequirements: [], categoryRequirements: [] }),
    );

    expect(result.issues).toEqual([]);
    expect(result.plan).toBeDefined();
  });

  it("accepts a well-formed plan", () => {
    const { issues, plan } = validatePlanContract(goodPlan());
    expect(issues).toEqual([]);
    expect(plan).toBeDefined();
  });

  it("rejects a plan built by a stale converter version", () => {
    const { issues, plan } = validatePlanContract(goodPlan({ version: "joomla-import-plan-v1" }));
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("version");
  });

  it("rejects a malformed assetRequirements entry", () => {
    const { issues } = validatePlanContract(goodPlan({ assetRequirements: [{ mediaId: "photo-1" }] }));
    expect(issues.join(" ")).toContain("malformed");
  });

  it("rejects a non-hex contentHash", () => {
    const { issues } = validatePlanContract(
      goodPlan({ assetRequirements: [{ mediaId: "photo-1", sourceLocator: "a.jpg", contentHash: "not-hex" }] }),
    );
    expect(issues.join(" ")).toContain("64-character lowercase hex");
  });

  it("rejects a duplicate mediaId within assetRequirements", () => {
    const entry = { mediaId: "photo-1", sourceLocator: "a.jpg", contentHash: "a".repeat(64) };
    const { issues } = validatePlanContract(goodPlan({ assetRequirements: [entry, entry] }));
    expect(issues.join(" ")).toContain("more than once");
  });

  it("rejects an assetRequirements entry with no matching pending reference in the documents", () => {
    const { issues } = validatePlanContract(
      goodPlan({
        assetRequirements: [
          { mediaId: "photo-1", sourceLocator: "a.jpg", contentHash: "a".repeat(64) },
          { mediaId: "photo-orphan", sourceLocator: "b.jpg", contentHash: "b".repeat(64) },
        ],
      }),
    );
    expect(issues.join(" ")).toContain('"photo-orphan", which no document references');
  });

  it("rejects a pending reference with no matching requirement", () => {
    const { issues } = validatePlanContract(goodPlan({ assetRequirements: [] }));
    expect(issues.join(" ")).toContain("photo-1");
    expect(issues.join(" ")).toContain("no matching assetRequirements entry");
  });

  it("rejects a plan whose top level is not an object", () => {
    const { issues, plan } = validatePlanContract("not an object");
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("not a JSON object");
  });

  it("rejects a document with an unrecognized _type, so a corrupted or hand-edited plan cannot reach createOrReplace unchecked", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          // A typo `validateMigrationDocuments` would silently skip every
          // type-specific check for, matching none of its per-type `if` branches.
          { _id: "migrated--article-a-fi", _type: "artcle", contentId: "a", language: "fi" },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain('unrecognized _type "artcle"');
  });

  it("rejects a document missing a string _id or _type", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({ documents: [{ _type: "article" }], assetRequirements: [], categoryRequirements: [] }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("missing a string _id or _type");
  });

  it("rejects a document carrying a field this tool never emits, so a hand-edited plan cannot smuggle a private value into a public dataset", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            // Not a field this tool ever writes onto an article — exactly the
            // injection Codex round 3 flagged (a private locator smuggled in).
            archiveLocator: "/private/path",
          },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("unrecognized field(s): archiveLocator");
  });

  it("rejects a private field smuggled inside a body block, not only at the document's own top level", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
            body: [
              {
                _key: "block-0001",
                _type: "contentParagraphBlock",
                text: "x",
                // Codex round 4's exact concern: an allow-list scoped only to the
                // document's own top-level fields would miss this.
                archiveLocator: "/private/path",
              },
            ],
          },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("body[0]");
    expect(issues.join(" ")).toContain('"archiveLocator"');
  });

  it("rejects a private field smuggled inside a mini-gallery block's own images array", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
            body: [
              {
                _key: "block-0001",
                _type: "contentGalleryBlock",
                images: [{ _key: "image-0001", media: { _type: "reference", _ref: "migrated--media-photo-1" }, archiveLocator: "/private" }],
              },
            ],
          },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("images[0]");
  });

  it("rejects a private field smuggled inside a table block's own rows array", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
            body: [
              {
                _key: "block-0001",
                _type: "contentTableBlock",
                headers: ["A"],
                rows: [{ _key: "row-0001", cells: ["1"], archiveLocator: "/private" }],
              },
            ],
          },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("rows[0]");
  });

  it("rejects a private field smuggled inside a tab group's own nested table rows (AB#163)", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
            body: [
              {
                _key: "block-0001",
                _type: "contentTabGroupBlock",
                tabs: [
                  {
                    _key: "tab-0001",
                    label: "Testi 1",
                    table: {
                      _type: "contentTableBlock",
                      headers: ["A"],
                      rows: [{ _key: "row-0001", cells: ["1"], archiveLocator: "/private" }],
                    },
                  },
                  {
                    _key: "tab-0002",
                    label: "Testi 2",
                    table: { _type: "contentTableBlock", headers: ["B"], rows: [{ _key: "row-0002", cells: ["2"] }] },
                  },
                ],
              },
            ],
          },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("tabs[0].table.rows[0]");
  });

  it("rejects a private field smuggled directly onto a tab item (AB#163)", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
            body: [
              {
                _key: "block-0001",
                _type: "contentTabGroupBlock",
                tabs: [
                  {
                    _key: "tab-0001",
                    label: "Testi 1",
                    table: { _type: "contentTableBlock", headers: ["A"], rows: [{ _key: "row-0001", cells: ["1"] }] },
                    archiveLocator: "/private",
                  },
                  {
                    _key: "tab-0002",
                    label: "Testi 2",
                    table: { _type: "contentTableBlock", headers: ["B"], rows: [{ _key: "row-0002", cells: ["2"] }] },
                  },
                ],
              },
            ],
          },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("tabs[0]");
  });

  it("rejects a private field smuggled inside a canonicalCategory reference object", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi`, archiveLocator: "/private" },
          },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("canonicalCategory");
  });

  it("rejects a reference object with a valid-looking _ref but a missing _type (Codex round 9)", () => {
    // Sanity treats this as not a reference at all — dereferencing it reads back
    // null, silently breaking the imported article rather than failing loudly.
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            title: "T",
            canonicalCategory: { _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
          },
        ],
        assetRequirements: [],
        categoryRequirements: [{ categoryId: "blogi" }],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain('canonicalCategory._type must be "reference"');
  });

  it("rejects a reference object with the wrong _type value", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            title: "T",
            canonicalCategory: { _type: "not-a-reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
          },
        ],
        assetRequirements: [],
        categoryRequirements: [{ categoryId: "blogi" }],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain('canonicalCategory._type must be "reference"');
  });

  it("rejects a reference object with an empty _ref", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            title: "T",
            canonicalCategory: { _type: "reference", _ref: "" },
          },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("canonicalCategory._ref must be a non-empty string");
  });

  it("accepts a well-formed article carrying every block kind this converter emits", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            title: "T",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
            body: [
              { _key: "block-0001", _type: "contentParagraphBlock", text: "x" },
              { _key: "block-0002", _type: "contentHeadingBlock", level: 2, text: "x" },
              { _key: "block-0003", _type: "contentQuoteBlock", text: "x" },
              { _key: "block-0004", _type: "contentListBlock", ordered: false, items: ["a", "b"] },
              { _key: "block-0005", _type: "contentYoutubeBlock", videoId: "abc", title: "x" },
              { _key: "block-0006", _type: "contentMediaBlock", media: { _type: "reference", _ref: "migrated--media-photo-1" } },
              {
                _key: "block-0007",
                _type: "contentGalleryBlock",
                title: "x",
                images: [{ _key: "image-0001", media: { _type: "reference", _ref: "migrated--media-photo-1" } }],
              },
              {
                _key: "block-0008",
                _type: "contentTableBlock",
                caption: "x",
                headers: ["A"],
                rows: [{ _key: "row-0001", cells: ["1"] }],
              },
            ],
          },
        ],
        assetRequirements: [],
        categoryRequirements: [{ categoryId: "blogi" }],
      }),
    );
    expect(issues).toEqual([]);
    expect(plan).toBeDefined();
  });

  // -------------------------------------------------------------------------
  // Codex round 5: reference-position semantics and required-field types
  // -------------------------------------------------------------------------

  it("rejects a pending asset marker misplaced into canonicalCategory", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            title: "T",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}photo-1` },
          },
        ],
        assetRequirements: [{ mediaId: "photo-1", sourceLocator: "a.jpg", contentHash: "a".repeat(64) }],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("canonicalCategory._ref should be a pending category reference");
  });

  it("rejects a media document whose image.asset points at a different photograph's pending marker", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--media-photo-1",
            _type: "media",
            mediaId: "photo-1",
            mediaType: "image",
            alt: [{ _key: "alt-01", _type: "localizedText", language: "fi", value: "Alt" }],
            publiclyRenderable: true,
            // Wrong: should reference "photo-1", references "photo-2" instead.
            image: { _type: "image", asset: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}photo-2` } },
          },
        ],
        assetRequirements: [{ mediaId: "photo-2", sourceLocator: "b.jpg", contentHash: "b".repeat(64) }],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("should reference this document's own photograph");
  });

  it("rejects a body media block whose reference is still a pending marker rather than already resolved", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            title: "T",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
            body: [{ _key: "block-0001", _type: "contentMediaBlock", media: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}photo-1` } }],
          },
        ],
        assetRequirements: [],
        categoryRequirements: [{ categoryId: "blogi" }],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("should already be a resolved reference");
  });

  it("rejects an article with a missing title", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: "fi",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
          },
        ],
        assetRequirements: [],
        categoryRequirements: [{ categoryId: "blogi" }],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("title is required");
  });

  it("rejects an article with a non-string language", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--article-a-fi",
            _type: "article",
            contentId: "a",
            language: 5,
            title: "T",
            canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
          },
        ],
        assetRequirements: [],
        categoryRequirements: [{ categoryId: "blogi" }],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("language is required");
  });

  it("rejects a placement with a non-boolean visible", () => {
    const { issues, plan } = validatePlanContract(
      goodPlan({
        documents: [
          {
            _id: "migrated--end-gallery-a-fi-0001",
            _type: "articleEndGalleryPlacement",
            placementId: "a-fi-0001",
            order: 0,
            visible: "yes",
            article: { _type: "reference", _ref: "migrated--article-a-fi" },
            media: { _type: "reference", _ref: "migrated--media-photo-1" },
          },
        ],
        assetRequirements: [],
        categoryRequirements: [],
      }),
    );
    expect(plan).toBeUndefined();
    expect(issues.join(" ")).toContain("visible is required and must be a boolean");
  });
});

// ---------------------------------------------------------------------------
// resolveContainedSourcePath — traversal and symlink escape (Codex round 1, finding 5)
// ---------------------------------------------------------------------------

describe("resolveContainedSourcePath", () => {
  async function withTempRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-write-root-"));
    try {
      return await run(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it("resolves an ordinary file inside the root", async () => {
    await withTempRoot(async (root) => {
      await writeFile(path.join(root, "a.jpg"), "AAA");
      const resolved = await resolveContainedSourcePath(root, "a.jpg");
      expect(resolved).toContain("a.jpg");
    });
  });

  it("rejects a locator using ../ traversal", async () => {
    await withTempRoot(async (root) => {
      await expect(resolveContainedSourcePath(root, "../etc/passwd")).rejects.toThrow(/escapes the image root/);
    });
  });

  it("rejects an absolute locator", async () => {
    await withTempRoot(async (root) => {
      await expect(resolveContainedSourcePath(root, "/etc/passwd")).rejects.toThrow(/escapes the image root/);
    });
  });

  it("rejects a symlink that resolves outside the image root", async () => {
    await withTempRoot(async (outsideRoot) => {
      await writeFile(path.join(outsideRoot, "secret.jpg"), "SECRET");
      await withTempRoot(async (root) => {
        await symlink(path.join(outsideRoot, "secret.jpg"), path.join(root, "link.jpg"));
        await expect(resolveContainedSourcePath(root, "link.jpg")).rejects.toThrow(/outside the image root/);
      });
    });
  });

  it("rejects a locator naming a file that does not exist", async () => {
    await withTempRoot(async (root) => {
      await expect(resolveContainedSourcePath(root, "missing.jpg")).rejects.toThrow(/does not exist/);
    });
  });
});

// ---------------------------------------------------------------------------
// verifyAndDeriveAsset
// ---------------------------------------------------------------------------

describe("verifyAndDeriveAsset", () => {
  async function withTempRoot<T>(run: (root: string) => Promise<T>): Promise<T> {
    const root = await mkdtemp(path.join(tmpdir(), "joomla-write-assets-"));
    try {
      return await run(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }

  it("verifies and derives a real photograph", async () => {
    await withTempRoot(async (root) => {
      const bytes = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 10, g: 20, b: 30 } } })
        .jpeg()
        .toBuffer();
      await writeFile(path.join(root, "photo.jpg"), bytes);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const outcome = await verifyAndDeriveAsset(root, { mediaId: "photo-1", sourceLocator: "photo.jpg", contentHash: hash });
      expect(outcome.ok).toBe(true);
      if (outcome.ok) expect(outcome.derivative.contentType).toBe("image/jpeg");
    });
  });

  it("refuses a file whose bytes no longer match the approved hash", async () => {
    await withTempRoot(async (root) => {
      await writeFile(path.join(root, "photo.jpg"), "CHANGED");
      const outcome = await verifyAndDeriveAsset(root, {
        mediaId: "photo-1",
        sourceLocator: "photo.jpg",
        contentHash: "a".repeat(64),
      });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toContain("hash mismatch");
    });
  });

  it("reports a decode failure for a corrupt image, without throwing", async () => {
    await withTempRoot(async (root) => {
      const bytes = new TextEncoder().encode("not an image");
      await writeFile(path.join(root, "photo.jpg"), bytes);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const outcome = await verifyAndDeriveAsset(root, { mediaId: "photo-1", sourceLocator: "photo.jpg", contentHash: hash });
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.reason).toContain("decode-failed");
    });
  });
});

// ---------------------------------------------------------------------------
// chunkIdsByByteBudget
// ---------------------------------------------------------------------------

describe("chunkIdsByByteBudget", () => {
  it("keeps a small list in one chunk", () => {
    const chunks = chunkIdsByByteBudget(["a", "b", "c"]);
    expect(chunks).toEqual([["a", "b", "c"]]);
  });

  it("splits a list too large for one chunk, without dropping or duplicating an id", () => {
    const ids = Array.from({ length: 2000 }, (_, index) => `migrated--media-photo-${index}-${"x".repeat(20)}`);
    const chunks = chunkIdsByByteBudget(ids);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.flat()).toEqual(ids);
  });

  it("returns no chunks for an empty list", () => {
    expect(chunkIdsByByteBudget([])).toEqual([]);
  });

  it("keeps every chunk's real encoded-URL cost within the query byte budget, not just its raw JSON length", () => {
    // Codex round 6: measuring raw JSON.stringify length under-counts, since
    // encodeURIComponent expands every quote, comma, and bracket to a three-byte
    // %XX escape. Assert against the exact measurement sanity-read-http.mts's own
    // buildQueryUrl performs, not the (looser) raw-JSON one this chunker used to use.
    const ids = Array.from({ length: 3000 }, (_, index) => `migrated--media-photo-${index}-${"x".repeat(20)}`);
    const chunks = chunkIdsByByteBudget(ids);
    for (const chunk of chunks) {
      const encodedBytes = new TextEncoder().encode(encodeURIComponent(JSON.stringify(chunk))).length;
      expect(encodedBytes).toBeLessThanOrEqual(6 * 1024);
    }
    expect(chunks.flat()).toEqual(ids);
  });
});

// ---------------------------------------------------------------------------
// resolveCategoryReferences
// ---------------------------------------------------------------------------

describe("resolveCategoryReferences", () => {
  it("resolves every category id, chunking across the byte budget", async () => {
    const requirements = Array.from({ length: 2000 }, (_, index) => ({ categoryId: `cat-${index}-${"x".repeat(20)}` }));
    let callCount = 0;
    const fetchImplementation = (async (url: string) => {
      callCount += 1;
      const parsed = new URL(url);
      const ids = JSON.parse(parsed.searchParams.get("$ids")!) as readonly string[];
      return jsonResponse({ result: ids.map((categoryId) => ({ _id: `real-${categoryId}`, categoryId })) });
    }) as unknown as typeof fetch;

    const { resolved, issues } = await resolveCategoryReferences(fakeConnection(), requirements, new Map(), { fetchImplementation });
    expect(issues).toEqual([]);
    expect(resolved.size).toBe(2000);
    expect(callCount).toBeGreaterThan(1);
    expect(resolved.get("cat-0-xxxxxxxxxxxxxxxxxxxx")).toBe("real-cat-0-xxxxxxxxxxxxxxxxxxxx");
  });

  it("reports a category with no match", async () => {
    const fetchImplementation = (async () => jsonResponse({ result: [] })) as unknown as typeof fetch;
    const { issues } = await resolveCategoryReferences(fakeConnection(), [{ categoryId: "ghost" }], new Map(), { fetchImplementation });
    expect(issues.join(" ")).toContain('category "ghost" was not found');
  });

  it("reports two documents ambiguously claiming one categoryId", async () => {
    const fetchImplementation = (async () =>
      jsonResponse({
        result: [
          { _id: "real-1", categoryId: "blogi" },
          { _id: "real-2", categoryId: "blogi" },
        ],
      })) as unknown as typeof fetch;
    const { issues } = await resolveCategoryReferences(fakeConnection(), [{ categoryId: "blogi" }], new Map(), { fetchImplementation });
    expect(issues.join(" ")).toContain("is ambiguous");
  });

  it("resolves a category that has the required language's label and slug", async () => {
    const fetchImplementation = (async () =>
      jsonResponse({
        result: [
          {
            _id: "real-blogi",
            categoryId: "blogi",
            label: [
              { language: "fi", value: "Blogi" },
              { language: "en", value: "Blog" },
            ],
            slug: [
              { language: "fi", value: "blogi" },
              { language: "en", value: "blog" },
            ],
          },
        ],
      })) as unknown as typeof fetch;
    const { resolved, issues } = await resolveCategoryReferences(
      fakeConnection(),
      [{ categoryId: "blogi" }],
      new Map([["blogi", new Set(["fi"])]]),
      { fetchImplementation },
    );
    expect(issues).toEqual([]);
    expect(resolved.get("blogi")).toBe("real-blogi");
  });

  it("refuses a category missing a required language's label or slug, mirroring validateProspectivePlacement", async () => {
    // Published in fi only, but an "en" article needs it too.
    const fetchImplementation = (async () =>
      jsonResponse({
        result: [{ _id: "real-blogi", categoryId: "blogi", label: [{ language: "fi", value: "Blogi" }], slug: [{ language: "fi", value: "blogi" }] }],
      })) as unknown as typeof fetch;
    const { resolved, issues } = await resolveCategoryReferences(
      fakeConnection(),
      [{ categoryId: "blogi" }],
      new Map([["blogi", new Set(["fi", "en"])]]),
      { fetchImplementation },
    );
    expect(resolved.has("blogi")).toBe(false);
    expect(issues.join(" ")).toContain('"en"');
  });

  it("refuses a category whose label is present but blank in the required language", async () => {
    const fetchImplementation = (async () =>
      jsonResponse({
        result: [{ _id: "real-blogi", categoryId: "blogi", label: [{ language: "fi", value: "   " }], slug: [{ language: "fi", value: "blogi" }] }],
      })) as unknown as typeof fetch;
    const { resolved, issues } = await resolveCategoryReferences(
      fakeConnection(),
      [{ categoryId: "blogi" }],
      new Map([["blogi", new Set(["fi"])]]),
      { fetchImplementation },
    );
    expect(resolved.has("blogi")).toBe(false);
    expect(issues.join(" ")).toContain("no valid published label and slug");
  });

  it("refuses a category whose slug is present but does not match SLUG_PATTERN", async () => {
    const fetchImplementation = (async () =>
      jsonResponse({
        result: [{ _id: "real-blogi", categoryId: "blogi", label: [{ language: "fi", value: "Blogi" }], slug: [{ language: "fi", value: "Not Valid!" }] }],
      })) as unknown as typeof fetch;
    const { resolved, issues } = await resolveCategoryReferences(
      fakeConnection(),
      [{ categoryId: "blogi" }],
      new Map([["blogi", new Set(["fi"])]]),
      { fetchImplementation },
    );
    expect(resolved.has("blogi")).toBe(false);
    expect(issues.join(" ")).toContain("no valid published label and slug");
  });
});

describe("collectRequiredCategoryLanguages", () => {
  it("collects the language of every article referencing a category, canonical and secondary alike", () => {
    const documents: readonly PlannedDocument[] = [
      {
        _id: "a1",
        _type: "article",
        language: "fi",
        canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
        secondaryCategories: [{ _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}tarinat` }],
      },
      {
        _id: "a2",
        _type: "article",
        language: "en",
        canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
      },
    ];
    const result = collectRequiredCategoryLanguages(documents);
    expect(result.get("blogi")).toEqual(new Set(["fi", "en"]));
    expect(result.get("tarinat")).toEqual(new Set(["fi"]));
  });
});

// ---------------------------------------------------------------------------
// runCollisionPreflight
// ---------------------------------------------------------------------------

describe("runCollisionPreflight", () => {
  const planned: readonly PlannedDocument[] = [
    { _id: "migrated--media-photo-1", _type: "media", mediaId: "photo-1" },
    {
      _id: "migrated--article-a-fi",
      _type: "article",
      contentId: "a",
      language: "fi",
      slug: "a",
      endGalleryId: "a-end",
      canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
    },
    {
      _id: "migrated--end-gallery-a-fi-0001",
      _type: "articleEndGalleryPlacement",
      placementId: "a-fi-0001",
      article: { _type: "reference", _ref: "migrated--article-a-fi" },
      media: { _type: "reference", _ref: "migrated--media-photo-1" },
    },
  ];
  const categoryMap = new Map([["blogi", "cat-real-id"]]);

  it("reports no collisions when every matching row is this plan's own document", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes('_type == "media"')) return jsonResponse({ result: [{ _id: "migrated--media-photo-1", mediaId: "photo-1" }] });
      if (query.includes("contentId in")) return jsonResponse({ result: [{ _id: "migrated--article-a-fi", contentId: "a", language: "fi" }] });
      if (query.includes("slug in")) {
        return jsonResponse({ result: [{ _id: "migrated--article-a-fi", language: "fi", slug: "a", categoryRef: "cat-real-id" }] });
      }
      if (query.includes("placementId in")) {
        return jsonResponse({ result: [{ _id: "migrated--end-gallery-a-fi-0001", placementId: "a-fi-0001" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions).toEqual([]);
  });

  it("reports a collision when a foreign document already claims a planned mediaId", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes('_type == "media"')) return jsonResponse({ result: [{ _id: "some-other-doc", mediaId: "photo-1" }] });
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain('mediaId "photo-1"');
  });

  it("reports a collision when a foreign document already claims a planned route", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("slug in")) {
        return jsonResponse({ result: [{ _id: "some-other-doc", language: "fi", slug: "a", categoryRef: "cat-real-id" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain("claiming the route");
  });

  it("reports a collision when a foreign document already claims a planned placementId", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("placementId in")) return jsonResponse({ result: [{ _id: "some-other-doc", placementId: "a-fi-0001" }] });
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain('placementId "a-fi-0001"');
  });

  it("does not flag a matching occurrence's sibling-language placement from an earlier phase", async () => {
    // `article-end-gallery-placement.ts`'s own Studio validator explicitly allows
    // this: same contentId, same endGalleryId, same media, a different article
    // reference — the en version of this same occurrence, written in an earlier
    // phased run and therefore absent from *this* plan's own `plannedIds`.
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("placementId in")) {
        return jsonResponse({
          result: [
            {
              _id: "migrated--end-gallery-a-en-0001",
              _type: "articleEndGalleryPlacement",
              placementId: "a-fi-0001",
              containerContentId: "a",
              endGalleryId: "a-end",
              mediaRef: "migrated--media-photo-1",
            },
          ],
        });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions).toEqual([]);
  });

  it("flags a same-placementId row whose occurrence signature does not actually match", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("placementId in")) {
        return jsonResponse({
          result: [
            {
              _id: "migrated--end-gallery-b-en-0001",
              _type: "articleEndGalleryPlacement",
              placementId: "a-fi-0001",
              containerContentId: "a",
              endGalleryId: "a-end",
              // A different photograph — not the same occurrence, despite sharing a placementId.
              mediaRef: "migrated--media-photo-DIFFERENT",
            },
          ],
        });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain('placementId "a-fi-0001"');
  });

  it("reports a collision when an existing gallery already claims a planned contentId, same language", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("contentId in")) {
        return jsonResponse({ result: [{ _id: "some-gallery-doc", _type: "gallery", contentId: "a", language: "fi" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain('contentId "a"');
  });

  it("reports a variant-mismatch collision when a contentId is already a gallery in a different language", async () => {
    // Mirrors `makeContentIdentityValidator`'s otherLanguageType check: a contentId's
    // variant (article vs gallery) cannot change between its own language versions,
    // even though the language itself differs from anything this plan writes.
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("contentId in")) {
        return jsonResponse({ result: [{ _id: "some-gallery-doc", _type: "gallery", contentId: "a", language: "sv" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain("variant cannot change");
  });

  it("does not flag an existing article in another language sharing the same contentId", async () => {
    // The normal, expected state: a translation pair, one language migrated earlier.
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("contentId in")) {
        return jsonResponse({ result: [{ _id: "migrated--article-a-en", _type: "article", contentId: "a", language: "en" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions).toEqual([]);
  });

  it("reports a collision when an existing gallery already claims a planned route", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("slug in")) {
        return jsonResponse({ result: [{ _id: "some-gallery-doc", language: "fi", slug: "a", categoryRef: "cat-real-id" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain("claiming the route");
  });

  it("reports a collision when a child category already claims the local slug this plan would place content at", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes('_type == "category"') && query.includes("parent._ref in")) {
        return jsonResponse({
          result: [{ _id: "some-child-category", parentRef: "cat-real-id", slug: [{ language: "fi", value: "a" }] }],
        });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain("a category already exists");
  });

  it("reports a collision when a curated gallery placement already claims a planned end-gallery placementId", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("placementId in")) {
        return jsonResponse({ result: [{ _id: "some-curated-placement", _type: "galleryPlacement", placementId: "a-fi-0001" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain("galleryPlacement");
  });

  // -------------------------------------------------------------------------
  // Codex round 7
  // -------------------------------------------------------------------------

  it("reports a collision when rerunning an article whose plan would change its published slug or category", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("canonicalCategoryId")) {
        // Already published under a different slug/category than this plan carries.
        return jsonResponse({ result: [{ _id: "migrated--article-a-fi", language: "fi", slug: "old-slug", canonicalCategoryId: "old-category" }] });
      }
      if (query.includes("_id in")) {
        // The id-occupancy check (Codex round 8): same _id, same type/identity as
        // planned — not itself a collision, so this test's assertion stays focused
        // on the route-preservation message above.
        return jsonResponse({ result: [{ _id: "migrated--article-a-fi", _type: "article", contentId: "a", language: "fi" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain("already published");
  });

  it("does not flag a rerun whose plan matches the already-published slug and category exactly", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("canonicalCategoryId")) {
        // planned's own article: language fi, slug "a", canonicalCategory -> "cat-real-id"
        // which resolves to categoryId "blogi" via categoryMap.
        return jsonResponse({ result: [{ _id: "migrated--article-a-fi", language: "fi", slug: "a", canonicalCategoryId: "blogi" }] });
      }
      if (query.includes("_id in")) {
        return jsonResponse({ result: [{ _id: "migrated--article-a-fi", _type: "article", contentId: "a", language: "fi" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions).toEqual([]);
  });

  it("reports a collision when a foreign document type occupies a planned id", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("_id in") && !query.includes("canonicalCategoryId")) {
        // A gallery sitting at the id this plan's article would use.
        return jsonResponse({ result: [{ _id: "migrated--article-a-fi", _type: "gallery" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain('but this plan would write a "article" there');
  });

  it("reports a collision when a same-type document at a planned id has a different identity", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes("_id in") && !query.includes("canonicalCategoryId")) {
        // Same type (article), but a different contentId — an accidental id
        // collision this tool's own deterministic naming should never itself
        // produce, checked anyway per this feature's "never trust" posture.
        return jsonResponse({ result: [{ _id: "migrated--article-a-fi", _type: "article", contentId: "different", language: "fi" }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain("a different identity than this plan intends");
  });

  it("reports a collision when migrating content into a category makes it public and it collides with an already-public sibling", async () => {
    // "blogi" (this plan's target, docId "cat-real-id") and "tarinat" are siblings
    // under "root-id", sharing the same category-node slug "a". "tarinat" is already
    // public via an existing article; "blogi" only becomes public because *this*
    // plan places content into it — exactly the case the old direct-children-only
    // check could never see, since "tarinat" is a sibling of "blogi", not a child.
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes('_type == "category"')) {
        return jsonResponse({
          result: [
            { _id: "cat-real-id", categoryId: "blogi", parentRef: "root-id", slug: [{ language: "fi", value: "a" }], label: [{ language: "fi", value: "Blogi" }] },
            { _id: "cat-tarinat-id", categoryId: "tarinat", parentRef: "root-id", slug: [{ language: "fi", value: "a" }], label: [{ language: "fi", value: "Tarinat" }] },
          ],
        });
      }
      if (query.includes("language ==")) {
        return jsonResponse({ result: [{ contentId: "existing", slug: "whatever", canonicalCategoryId: "tarinat", secondaryCategoryIds: [] }] });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions.join(" ")).toContain("tarinat");
  });

  it("reports no category-ancestry collision when no branch is newly made public", async () => {
    const fetchImplementation = (async (url: string) => {
      const parsed = new URL(url);
      const query = parsed.searchParams.get("query") ?? "";
      if (query.includes('_type == "category"')) {
        return jsonResponse({
          result: [{ _id: "cat-real-id", categoryId: "blogi", parentRef: "root-id", slug: [{ language: "fi", value: "a" }], label: [{ language: "fi", value: "Blogi" }] }],
        });
      }
      return jsonResponse({ result: [] });
    }) as unknown as typeof fetch;

    const { collisions } = await runCollisionPreflight(fakeConnection(), planned, categoryMap, { fetchImplementation });
    expect(collisions).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mergeExistingMediaFields
// ---------------------------------------------------------------------------

describe("mergeExistingMediaFields", () => {
  function mediaDocument(alt: readonly { readonly language: string; readonly value: string }[]): PlannedDocument {
    return {
      _id: "migrated--media-photo-1",
      _type: "media",
      mediaId: "photo-1",
      mediaType: "image",
      publiclyRenderable: true,
      alt: alt.map((entry, index) => ({ _key: `alt-${String(index + 1).padStart(2, "0")}`, _type: "localizedText", ...entry })),
    };
  }

  it("carries over a published language this phase's plan does not itself contribute", async () => {
    // An earlier phase published "en" for this same photograph; this phase's own
    // plan only ever saw the "fi" article referencing it.
    const fetchImplementation = (async () =>
      jsonResponse({ result: [{ _id: "migrated--media-photo-1", alt: [{ language: "en", value: "Published earlier" }] }] })) as unknown as typeof fetch;

    const { documents, issues } = await mergeExistingMediaFields(fakeConnection(), [mediaDocument([{ language: "fi", value: "Uusi" }])], {
      fetchImplementation,
    });
    expect(issues).toEqual([]);
    const alt = documents[0]?.alt as readonly { readonly language: string; readonly value: string }[];
    expect(alt).toHaveLength(2);
    expect(alt.find((entry) => entry.language === "en")?.value).toBe("Published earlier");
    expect(alt.find((entry) => entry.language === "fi")?.value).toBe("Uusi");
  });

  it("leaves a media document with no existing published version untouched", async () => {
    const fetchImplementation = (async () => jsonResponse({ result: [] })) as unknown as typeof fetch;
    const original = mediaDocument([{ language: "fi", value: "Uusi" }]);
    const { documents, issues } = await mergeExistingMediaFields(fakeConnection(), [original], { fetchImplementation });
    expect(issues).toEqual([]);
    expect(documents[0]).toEqual(original);
  });

  it("refuses when this phase's own value disagrees with an already-published one, rather than picking a side", async () => {
    const fetchImplementation = (async () =>
      jsonResponse({ result: [{ _id: "migrated--media-photo-1", alt: [{ language: "fi", value: "Vanha" }] }] })) as unknown as typeof fetch;
    const { issues } = await mergeExistingMediaFields(fakeConnection(), [mediaDocument([{ language: "fi", value: "Uusi" }])], {
      fetchImplementation,
    });
    expect(issues.join(" ")).toContain('"fi"');
    expect(issues.join(" ")).toContain("Vanha");
    expect(issues.join(" ")).toContain("Uusi");
  });

  it("does not touch a non-media document", async () => {
    const fetchImplementation = (async () => jsonResponse({ result: [] })) as unknown as typeof fetch;
    const article: PlannedDocument = { _id: "migrated--article-a-fi", _type: "article" };
    const { documents } = await mergeExistingMediaFields(fakeConnection(), [article], { fetchImplementation });
    expect(documents[0]).toEqual(article);
  });

  it("carries over caption, credit, capturedAt, enquiryEligible, and archiveLocator this tool never authors", async () => {
    const fetchImplementation = (async () =>
      jsonResponse({
        result: [
          {
            _id: "migrated--media-photo-1",
            alt: [],
            caption: [{ _type: "localizedText", language: "fi", value: "Kuvateksti" }],
            credit: "Photographer Name",
            capturedAt: "2015-06-01T00:00:00.000Z",
            enquiryEligible: true,
            archiveLocator: "D:/archive/2015/one.nef",
            publiclyRenderable: true,
          },
        ],
      })) as unknown as typeof fetch;

    const { documents, issues } = await mergeExistingMediaFields(fakeConnection(), [mediaDocument([{ language: "fi", value: "Alt" }])], {
      fetchImplementation,
    });
    expect(issues).toEqual([]);
    const document = documents[0]!;
    expect(document.credit).toBe("Photographer Name");
    expect(document.capturedAt).toBe("2015-06-01T00:00:00.000Z");
    expect(document.enquiryEligible).toBe(true);
    expect(document.archiveLocator).toBe("D:/archive/2015/one.nef");
    expect(document.caption).toEqual([{ _type: "localizedText", language: "fi", value: "Kuvateksti" }]);
  });

  it("never reverses an editor's own publiclyRenderable: false — a deliberately hidden photograph stays hidden", async () => {
    const fetchImplementation = (async () =>
      jsonResponse({ result: [{ _id: "migrated--media-photo-1", alt: [], publiclyRenderable: false }] })) as unknown as typeof fetch;

    // This plan's own document always carries publiclyRenderable: true (buildImportPlan's
    // unconditional default) — the merge must not let that silently un-hide the photo.
    const { documents, issues } = await mergeExistingMediaFields(fakeConnection(), [mediaDocument([{ language: "fi", value: "Alt" }])], {
      fetchImplementation,
    });
    expect(issues).toEqual([]);
    expect(documents[0]?.publiclyRenderable).toBe(false);
  });

  it("keeps publiclyRenderable: true when the existing document is not hidden", async () => {
    const fetchImplementation = (async () =>
      jsonResponse({ result: [{ _id: "migrated--media-photo-1", alt: [], publiclyRenderable: true }] })) as unknown as typeof fetch;
    const { documents } = await mergeExistingMediaFields(fakeConnection(), [mediaDocument([{ language: "fi", value: "Alt" }])], {
      fetchImplementation,
    });
    expect(documents[0]?.publiclyRenderable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// splitIntoWaves
// ---------------------------------------------------------------------------

describe("splitIntoWaves", () => {
  it("writes media before containers and containers before placements", () => {
    const documents: readonly PlannedDocument[] = [
      { _id: "a1", _type: "article" },
      { _id: "m1", _type: "media" },
      { _id: "p1", _type: "articleEndGalleryPlacement" },
      { _id: "m2", _type: "media" },
    ];
    const [media, rest, placements] = splitIntoWaves(documents);
    expect(media?.map((document) => document._id)).toEqual(["m1", "m2"]);
    expect(rest?.map((document) => document._id)).toEqual(["a1"]);
    expect(placements?.map((document) => document._id)).toEqual(["p1"]);
  });

  it("never drops or duplicates a document across waves", () => {
    const documents: readonly PlannedDocument[] = Array.from({ length: 250 }, (_, index) => ({
      _id: `doc-${index}`,
      _type: index % 3 === 0 ? "media" : "article",
    }));
    const waves = splitIntoWaves(documents);
    const total = waves.flat();
    expect(total).toHaveLength(documents.length);
    expect(new Set(total.map((document) => document._id)).size).toBe(documents.length);
  });
});

// ---------------------------------------------------------------------------
// substitutePendingReferences / assertNoPendingReferencesRemain
// ---------------------------------------------------------------------------

describe("substitutePendingReferences", () => {
  it("replaces only the _ref string, preserving _type and any _key", () => {
    const documents: readonly PlannedDocument[] = [
      {
        _id: "migrated--article-a-fi",
        _type: "article",
        canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
        secondaryCategories: [{ _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}tarinat`, _key: "category-0001" }],
        body: [
          {
            _key: "block-0001",
            _type: "contentMediaBlock",
            media: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}photo-1` },
          },
        ],
      },
    ];
    const substituted = substitutePendingReferences(
      documents,
      new Map([["photo-1", "real-asset-id"]]),
      new Map([
        ["blogi", "real-cat-blogi"],
        ["tarinat", "real-cat-tarinat"],
      ]),
    );
    const [article] = substituted;
    expect(article?.canonicalCategory).toEqual({ _type: "reference", _ref: "real-cat-blogi" });
    expect(article?.secondaryCategories).toEqual([{ _type: "reference", _ref: "real-cat-tarinat", _key: "category-0001" }]);
    const body = article?.body as readonly { readonly media: unknown }[];
    expect(body[0]?.media).toEqual({ _type: "reference", _ref: "real-asset-id" });
  });

  it("leaves an unresolved reference as-is rather than guessing", () => {
    const documents: readonly PlannedDocument[] = [
      { _id: "migrated--media-photo-1", _type: "media", asset: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}photo-unknown` } },
    ];
    const substituted = substitutePendingReferences(documents, new Map(), new Map());
    expect(substituted[0]?.asset).toEqual({ _type: "reference", _ref: `${PENDING_ASSET_PREFIX}photo-unknown` });
  });
});

describe("assertNoPendingReferencesRemain", () => {
  it("does not throw for a fully substituted document set", () => {
    const documents: readonly PlannedDocument[] = [
      { _id: "a", _type: "article", canonicalCategory: { _type: "reference", _ref: "real-cat" } },
    ];
    expect(() => assertNoPendingReferencesRemain(documents)).not.toThrow();
  });

  it("throws when a pending marker survives substitution", () => {
    const documents: readonly PlannedDocument[] = [
      { _id: "a", _type: "media", asset: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}photo-1` } },
    ];
    expect(() => assertNoPendingReferencesRemain(documents)).toThrow(/pending reference/);
  });

  it("does not false-positive when ordinary authored text happens to contain the pending-prefix string (Codex round 8)", () => {
    // An article's own title/body is not a reference, however coincidental the
    // substring match — only an actual _ref value should ever trip this check. An
    // earlier version of this function did a blind JSON.stringify(documents) search,
    // which this exact scenario would have wrongly refused — after every asset had
    // already been uploaded, orphaning them.
    const documents: readonly PlannedDocument[] = [
      {
        _id: "a",
        _type: "article",
        title: `An article about the migrated-pending-asset: placeholder convention itself`,
        canonicalCategory: { _type: "reference", _ref: "real-cat" },
      },
    ];
    expect(() => assertNoPendingReferencesRemain(documents)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// verifyWrittenDocuments
// ---------------------------------------------------------------------------

describe("verifyWrittenDocuments", () => {
  it("sums the count across chunk boundaries", async () => {
    const ids = Array.from({ length: 2000 }, (_, index) => `migrated--media-photo-${index}-${"x".repeat(20)}`);
    let callCount = 0;
    const fetchImplementation = (async (url: string) => {
      callCount += 1;
      const parsed = new URL(url);
      const chunkIds = JSON.parse(parsed.searchParams.get("$ids")!) as readonly string[];
      return jsonResponse({ result: chunkIds.length });
    }) as unknown as typeof fetch;

    const result = await verifyWrittenDocuments(fakeConnection(), ids, { fetchImplementation });
    expect(callCount).toBeGreaterThan(1);
    expect(result).toEqual({ expected: 2000, found: 2000 });
  });

  it("reports a mismatch when fewer documents are found than expected", async () => {
    const fetchImplementation = (async () => jsonResponse({ result: 1 })) as unknown as typeof fetch;
    const result = await verifyWrittenDocuments(fakeConnection(), ["a", "b"], { fetchImplementation });
    expect(result).toEqual({ expected: 2, found: 1 });
  });
});

// ---------------------------------------------------------------------------
// CLI subprocess tests — argument handling and the dry-run network guarantee
// ---------------------------------------------------------------------------

describe("CLI", () => {
  async function withTempDir<T>(run: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(tmpdir(), "joomla-write-cli-"));
    try {
      return await run(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("rejects an unknown flag", async () => {
    await withTempDir(async (dir) => {
      await expect(
        run("node", [
          path.join(import.meta.dirname, "write-joomla-content.mts"),
          "--plan",
          path.join(dir, "p.json"),
          "--image-root",
          dir,
          "--out",
          path.join(dir, "out"),
          "--phaze",
          "x",
        ]),
      ).rejects.toThrow();
    });
  });

  it("requires --plan, --image-root, and --out", async () => {
    await expect(run("node", [path.join(import.meta.dirname, "write-joomla-content.mts")])).rejects.toThrow();
  });

  it("performs a dry run with no Sanity credential and no network access, reporting counts", async () => {
    await withTempDir(async (dir) => {
      const imageRoot = path.join(dir, "images");
      await mkdir(imageRoot, { recursive: true });
      const bytes = await sharp({ create: { width: 300, height: 200, channels: 3, background: { r: 5, g: 5, b: 5 } } })
        .jpeg()
        .toBuffer();
      await writeFile(path.join(imageRoot, "photo.jpg"), bytes);
      const hash = createHash("sha256").update(bytes).digest("hex");

      const documents: readonly PlannedDocument[] = [
        {
          _id: "migrated--media-photo-1",
          _type: "media",
          mediaId: "photo-1",
          mediaType: "image",
          alt: [{ _key: "alt-01", _type: "localizedText", language: "fi", value: "Alt" }],
          publiclyRenderable: true,
          image: { _type: "image", asset: { _type: "reference", _ref: `${PENDING_ASSET_PREFIX}photo-1` } },
        },
      ];
      const assetRequirements = [{ mediaId: "photo-1", sourceLocator: "photo.jpg", contentHash: hash }];
      const plan: ImportPlan = {
        version: IMPORT_PLAN_VERSION,
        conversionPolicy: "x",
        phase: "launch",
        manifestDigest: "m".repeat(64),
        sourceExportDigest: "s".repeat(64),
        documents,
        documentsDigest: writablePlanDigest(documents, assetRequirements, [], []),
        assetRequirements,
        categoryRequirements: [],
        photographIdentities: {},
        blocked: [],
        errors: [],
        writable: false,
        notWritableBecause: [],
      };
      await writeFile(path.join(dir, "plan.json"), JSON.stringify(plan));

      // No SANITY_* environment variables are set for this invocation — if the
      // command reached the network before --yes, it would fail loudly rather
      // than succeeding, since `parseSeedConnection`'s required settings would
      // be missing. A clean exit here is itself evidence of zero fetches.
      const { stdout } = await run("node", [
        path.join(import.meta.dirname, "write-joomla-content.mts"),
        "--plan",
        path.join(dir, "plan.json"),
        "--image-root",
        imageRoot,
        "--out",
        path.join(dir, "out"),
        "--approved-digest",
        plan.documentsDigest,
      ]);
      expect(stdout).toContain("Dry run only");
      expect(stdout).toContain("1 document(s)");
    });
  });

  it("rejects a plan whose digest does not match the operator-supplied --approved-digest", async () => {
    await withTempDir(async (dir) => {
      const documents: readonly PlannedDocument[] = [];
      const plan: ImportPlan = {
        version: IMPORT_PLAN_VERSION,
        conversionPolicy: "x",
        phase: "launch",
        manifestDigest: "m".repeat(64),
        sourceExportDigest: "s".repeat(64),
        documents,
        documentsDigest: writablePlanDigest(documents, [], [], []),
        assetRequirements: [],
        categoryRequirements: [],
        photographIdentities: {},
        blocked: [],
        errors: [],
        writable: false,
        notWritableBecause: [],
      };
      await writeFile(path.join(dir, "plan.json"), JSON.stringify(plan));

      await expect(
        run("node", [
          path.join(import.meta.dirname, "write-joomla-content.mts"),
          "--plan",
          path.join(dir, "plan.json"),
          "--image-root",
          dir,
          "--out",
          path.join(dir, "out"),
          "--approved-digest",
          "0".repeat(64),
        ]),
      ).rejects.toMatchObject({ code: 1 });
    });
  });

  it("requires --approved-digest", async () => {
    await withTempDir(async (dir) => {
      await expect(
        run("node", [
          path.join(import.meta.dirname, "write-joomla-content.mts"),
          "--plan",
          path.join(dir, "plan.json"),
          "--image-root",
          dir,
          "--out",
          path.join(dir, "out"),
        ]),
      ).rejects.toThrow();
    });
  });

  it("refuses to connect when NEXT_PUBLIC_SANITY_MIGRATION_TOKEN is set alongside the real token (Codex round 9)", async () => {
    await withTempDir(async (dir) => {
      const documents: readonly PlannedDocument[] = [];
      const plan: ImportPlan = {
        version: IMPORT_PLAN_VERSION,
        conversionPolicy: "x",
        phase: "launch",
        manifestDigest: "m".repeat(64),
        sourceExportDigest: "s".repeat(64),
        documents,
        documentsDigest: writablePlanDigest(documents, [], [], []),
        assetRequirements: [],
        categoryRequirements: [],
        photographIdentities: {},
        blocked: [],
        errors: [],
        writable: false,
        notWritableBecause: [],
      };
      await writeFile(path.join(dir, "plan.json"), JSON.stringify(plan));

      await expect(
        run(
          "node",
          [
            path.join(import.meta.dirname, "write-joomla-content.mts"),
            "--plan",
            path.join(dir, "plan.json"),
            "--image-root",
            dir,
            "--out",
            path.join(dir, "out"),
            "--approved-digest",
            plan.documentsDigest,
            "--project",
            "abc123",
            "--dataset",
            "prod",
            "--api-version",
            "v2024-01-01",
            "--yes",
          ],
          {
            env: {
              ...process.env,
              SANITY_MIGRATION_TOKEN: "real-token",
              NEXT_PUBLIC_SANITY_MIGRATION_TOKEN: "leaked-copy",
            },
          },
        ),
      ).rejects.toMatchObject({ code: 1 });
    });
  });

  it("writes a private, mode-0600 report for a plan that fails contract validation", async () => {
    await withTempDir(async (dir) => {
      await writeFile(path.join(dir, "plan.json"), JSON.stringify({ version: "wrong-version" }));
      const outDir = path.join(dir, "out");
      await expect(
        run("node", [
          path.join(import.meta.dirname, "write-joomla-content.mts"),
          "--plan",
          path.join(dir, "plan.json"),
          "--image-root",
          dir,
          "--out",
          outDir,
          "--approved-digest",
          "a".repeat(64),
        ]),
      ).rejects.toMatchObject({ code: 1 });
      const { stat } = await import("node:fs/promises");
      const info = await stat(path.join(outDir, "plan-validation-errors.json"));
      expect(info.mode & 0o777).toBe(0o600);
    });
  });
});
