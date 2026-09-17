/**
 * Synthetic fixtures only. The last block is the end-to-end case: a manifest
 * string and a source body, through conversion, into a document plan — the path
 * a real run takes, with nothing private and nothing on the network.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { convertJoomlaBody, CONVERSION_POLICY_VERSION, resolvedConversionDigest } from "./joomla-html-conversion.mts";
import { MANIFEST_COLUMNS, reviewImportManifest, type ApprovedArticle } from "./joomla-import-manifest.mts";
import {
  buildImportPlan,
  endGalleryPlacementId,
  IMPORT_PLAN_VERSION,
  migratedId,
  MIGRATED_ID_PREFIX,
  mintPhotographIdentity,
  PENDING_ASSET_PREFIX,
  PENDING_CATEGORY_PREFIX,
  validateMigrationDocuments,
  type PlannedArticleInput,
  type PlannedDocument,
} from "./joomla-import-plan.mts";
import { isSeedDocumentId, SEED_ID_PREFIX } from "./sanity-seed-fixtures.mts";

const DIGEST = "b".repeat(64);
const RESOLVED_DIGEST = "c".repeat(64);

function approval(overrides: Partial<ApprovedArticle> = {}): ApprovedArticle {
  return {
    sourceId: "347",
    language: "fi",
    contentId: "pentax-645z",
    slug: "pentax-645z",
    canonicalCategory: "blogi",
    secondaryCategories: [],
    phase: "launch",
    publishedAt: "2015-06-01T00:00:00.000Z",
    sourceDigest: DIGEST,
    // A placeholder the caller almost always wants replaced with the digest
    // of their own conversion — `article()` does this automatically unless
    // the caller supplies `resolvedDigest` explicitly (see its own comment).
    resolvedDigest: RESOLVED_DIGEST,
    conversionPolicy: CONVERSION_POLICY_VERSION,
    acknowledgedFindings: [],
    approvedBy: "Ilkka",
    approvedAt: "2026-09-17",
    ...overrides,
  };
}

function article(overrides: Partial<PlannedArticleInput> = {}): PlannedArticleInput {
  const conversion = overrides.conversion ?? {
    blocks: [{ _type: "contentParagraphBlock", text: "Teksti." }],
    findings: [],
    resolvedImageAltText: [],
    resolvedImageContentHashes: [],
    convertible: true,
  };
  // Always derived from the *actual* conversion this article carries, never
  // taken from whatever `approval()`'s own default happens to be — otherwise
  // every fixture that overrides `approval` for an unrelated reason (a
  // different category, a different sourceId, …) would also need to
  // hand-compute a matching resolved digest just to avoid a spurious mismatch
  // blocker. A genuine mismatch is exercised directly against
  // `assessApprovedConversion` (joomla-import-manifest.test.mts) and once
  // more here at the plan level (see "round-6" below).
  const baseApproval = overrides.approval ?? approval();
  return {
    title: "Pentax 645Z laajassa kokeilussa",
    sourceDigest: DIGEST,
    ...overrides,
    approval: { ...baseApproval, resolvedDigest: resolvedConversionDigest(conversion) },
    conversion,
  };
}

function plan(input: Partial<Parameters<typeof buildImportPlan>[0]> = {}) {
  return buildImportPlan({
    phase: "launch",
    manifestDigest: "m".repeat(64),
    sourceExportDigest: "s".repeat(64),
    articles: [article()],
    knownCategoryIds: ["blogi", "tarinat"],
    sourceLocators: {},
    ...input,
  });
}

describe("id namespace", () => {
  it("never collides with the demo seeder's namespace", () => {
    // Real launch content under `seed--` would be destroyable by
    // `npm run seed:sanity -- --delete-all`.
    const id = migratedId("article", "pentax-645z", "fi");
    expect(id.startsWith(MIGRATED_ID_PREFIX)).toBe(true);
    expect(id.startsWith(SEED_ID_PREFIX)).toBe(false);
    expect(isSeedDocumentId(id)).toBe(false);
    expect(MIGRATED_ID_PREFIX.startsWith(SEED_ID_PREFIX)).toBe(false);
  });

  it("produces public root-level, dot-free ids and rejects an invalid segment", () => {
    expect(migratedId("media", "photo-abc")).not.toContain(".");
    expect(() => migratedId("media", "Not Valid")).toThrow(TypeError);
  });
});

describe("photograph identity", () => {
  it("mints an opaque id with no relationship to any locator — never deterministic from one (Codex review round 9)", () => {
    // ADR-0002 §1 forbids deriving `mediaId` from a filename; an earlier
    // draft hashed the locator into the id, which made the id trivially
    // recoverable from — and dependent on — the private source path. Two
    // calls now produce two different ids even given "the same locator",
    // because the function no longer takes one at all: identity is minted
    // once, opaquely, and carried forward only through the persisted map.
    const a = mintPhotographIdentity();
    const b = mintPhotographIdentity();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^photo-[0-9a-f]{16}$/u);
    expect(b).toMatch(/^photo-[0-9a-f]{16}$/u);
  });

  it("keeps an identity carried over from an earlier phase", () => {
    const result = plan({
      articles: [
        article({
          conversion: {
            blocks: [{ _type: "contentMediaBlock", media: "photo-existing" }],
            findings: [],
            resolvedImageAltText: [{ mediaId: "photo-existing", language: "fi", value: "Alt" }],
            resolvedImageContentHashes: [],
            convertible: true,
          },
        }),
      ],
      sourceLocators: { "photo-existing": "stories/a/one.jpg" },
      photographIdentities: { "stories/a/one.jpg": "photo-existing" },
    });
    expect(result.errors).toEqual([]);
    expect(result.photographIdentities["stories/a/one.jpg"]).toBe("photo-existing");
  });

  it("gives one photograph used twice one identity and two placements", () => {
    const repeated = Array.from({ length: 14 }, () => "photo-same");
    const result = plan({
      articles: [
        article({
          conversion: {
            blocks: [{ _type: "contentParagraphBlock", text: "Teksti." }],
            findings: [],
            resolvedImageAltText: [{ mediaId: "photo-same", language: "fi", value: "Alt" }],
            resolvedImageContentHashes: [],
            convertible: true,
            endGallery: { sourcePath: "stories/large", mediaIds: repeated },
          },
        }),
      ],
      sourceLocators: { "photo-same": "stories/large/one.jpg" },
    });
    expect(result.errors).toEqual([]);
    const media = result.documents.filter((document) => document._type === "media");
    const placements = result.documents.filter((document) => document._type === "articleEndGalleryPlacement");
    expect(media).toHaveLength(1);
    expect(placements).toHaveLength(14);
    expect(new Set(placements.map((entry) => entry.placementId)).size).toBe(14);
  });

  it("numbers a placement by occurrence, not by photograph — and not by language", () => {
    // Deliberately language-free: an fi/en translation pair shares the same
    // occurrence id for the same photograph sequence (Codex review round 3).
    expect(endGalleryPlacementId("pentax-645z", 0)).toBe("pentax-645z-0001");
  });
});

describe("round-3 review finding: cross-language end-gallery occurrence identity", () => {
  it("gives an fi/en translation pair's matching gallery occurrence the same placementId", () => {
    const mediaIds = ["photo-a", "photo-b"];
    const conversionFor = (): PlannedArticleInput["conversion"] => ({
      blocks: [{ _type: "contentParagraphBlock", text: "Teksti." }],
      findings: [],
      resolvedImageAltText: [
        { mediaId: "photo-a", language: "fi", value: "Alt a" },
        { mediaId: "photo-b", language: "fi", value: "Alt b" },
      ],
      resolvedImageContentHashes: [],
      convertible: true,
      endGallery: { sourcePath: "stories/x", mediaIds },
    });
    const fi = article({ conversion: conversionFor() });
    const en = article({
      approval: approval({ sourceId: "394", language: "en" }),
      conversion: {
        ...conversionFor(),
        resolvedImageAltText: [
          { mediaId: "photo-a", language: "en", value: "Alt a en" },
          { mediaId: "photo-b", language: "en", value: "Alt b en" },
        ],
        resolvedImageContentHashes: [],
      },
    });

    const result = plan({
      articles: [fi, en],
      sourceLocators: { "photo-a": "stories/x/a.jpg", "photo-b": "stories/x/b.jpg" },
    });
    expect(result.errors).toEqual([]);
    const placements = result.documents.filter((document) => document._type === "articleEndGalleryPlacement");
    expect(placements).toHaveLength(4); // 2 occurrences × 2 languages
    const placementIds = new Set(placements.map((entry) => entry.placementId));
    // One id per occurrence, shared across the translation pair — not four.
    expect(placementIds.size).toBe(2);
    // But each language still has its own document.
    expect(new Set(placements.map((entry) => entry._id)).size).toBe(4);

    const media = result.documents.filter((document) => document._type === "media");
    const photoA = media.find((entry) => entry.mediaId === "photo-a");
    expect(photoA?.alt).toEqual([
      { _key: "alt-01", _type: "localizedText", language: "en", value: "Alt a en" },
      { _key: "alt-02", _type: "localizedText", language: "fi", value: "Alt a" },
    ]);
  });

  it("rejects a placementId reused for two genuinely different occurrences", () => {
    const withPlacement = (id: string, mediaRef: string): PlannedDocument => ({
      _id: migratedId("end-gallery", id, "x"),
      _type: "articleEndGalleryPlacement",
      placementId: id,
      order: 0,
      visible: true,
      article: { _type: "reference", _ref: migratedId("article", "a", "fi") },
      media: { _type: "reference", _ref: mediaRef },
    });
    const article1: PlannedDocument = {
      _id: migratedId("article", "a", "fi"),
      _type: "article",
      contentId: "a",
      language: "fi",
      title: "T",
      slug: "a",
      endGalleryId: "a-end",
      publishedAt: "2015-06-01T00:00:00.000Z",
      canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
      body: [{ _key: "block-0001", _type: "contentParagraphBlock", text: "x" }],
    };
    const mediaA: PlannedDocument = {
      _id: migratedId("media", "photo-a"),
      _type: "media",
      mediaId: "photo-a",
      mediaType: "image",
      alt: [{ _key: "alt-01", _type: "localizedText", language: "fi", value: "A" }],
      publiclyRenderable: true,
    };
    const mediaB: PlannedDocument = {
      _id: migratedId("media", "photo-b"),
      _type: "media",
      mediaId: "photo-b",
      mediaType: "image",
      alt: [{ _key: "alt-01", _type: "localizedText", language: "fi", value: "B" }],
      publiclyRenderable: true,
    };
    const violations = validateMigrationDocuments([
      article1,
      mediaA,
      mediaB,
      withPlacement("shared-id", mediaA._id),
      { ...withPlacement("shared-id", mediaB._id), _id: migratedId("end-gallery", "shared-id", "y") },
    ]);
    expect(violations.join(" ")).toContain("bound to two different occurrences");
  });
});

describe("round-3 review finding: a blocked article's metadata never reaches a shared photograph", () => {
  it("excludes a blocked article's alt text from the media document", () => {
    const accepted = article({
      conversion: {
        blocks: [{ _type: "contentMediaBlock", media: "photo-shared" }],
        findings: [],
        resolvedImageAltText: [{ mediaId: "photo-shared", language: "fi", value: "Hyväksytty teksti" }],
        resolvedImageContentHashes: [],
        convertible: true,
      },
    });
    const blocked = article({
      approval: approval({ sourceId: "999", canonicalCategory: "ei-ole" }), // not in knownCategoryIds → blocked
      conversion: {
        blocks: [{ _type: "contentMediaBlock", media: "photo-shared" }],
        findings: [],
        resolvedImageAltText: [{ mediaId: "photo-shared", language: "fi", value: "Torjutun artikkelin teksti" }],
        resolvedImageContentHashes: [],
        convertible: true,
      },
    });

    const result = plan({
      articles: [accepted, blocked],
      sourceLocators: { "photo-shared": "stories/a/one.jpg" },
    });
    expect(result.errors).toEqual([]);
    expect(result.blocked).toHaveLength(1);
    const media = result.documents.find((document) => document._type === "media" && document.mediaId === "photo-shared");
    expect(media?.alt).toEqual([{ _key: "alt-01", _type: "localizedText", language: "fi", value: "Hyväksytty teksti" }]);
  });
});

describe("the plan is never writable from here", () => {
  it("emits pending markers instead of guessing an asset or a category id", () => {
    const result = plan({
      articles: [
        article({
          conversion: {
            blocks: [{ _type: "contentMediaBlock", media: "photo-1" }],
            findings: [],
            resolvedImageAltText: [{ mediaId: "photo-1", language: "fi", value: "Alt" }],
            resolvedImageContentHashes: [],
            convertible: true,
          },
        }),
      ],
      sourceLocators: { "photo-1": "stories/a/one.jpg" },
    });
    const media = result.documents.find((document) => document._type === "media");
    const articleDocument = result.documents.find((document) => document._type === "article");
    expect(JSON.stringify(media)).toContain(PENDING_ASSET_PREFIX);
    expect(JSON.stringify(articleDocument?.canonicalCategory)).toContain(PENDING_CATEGORY_PREFIX);
    expect(result.writable).toBe(false);
    expect(result.notWritableBecause.join(" ")).toContain("not uploaded");
    expect(result.notWritableBecause.join(" ")).toContain("converts and reports only");
    expect(result.assetRequirements).toEqual([{ mediaId: "photo-1", sourceLocator: "stories/a/one.jpg" }]);
    expect(result.categoryRequirements).toEqual([{ categoryId: "blogi" }]);
  });

  it("carries its version, policy, phase, and both digests", () => {
    const result = plan();
    expect(result).toMatchObject({
      version: IMPORT_PLAN_VERSION,
      conversionPolicy: CONVERSION_POLICY_VERSION,
      phase: "launch",
      manifestDigest: "m".repeat(64),
      sourceExportDigest: "s".repeat(64),
    });
  });
});

describe("round-5 review finding: Sanity's document id length limit is checked before assembly", () => {
  it("blocks an article whose contentId would push the article document id past 128 characters", () => {
    // migratedId("article", contentId, "fi") = "migrated--article-<contentId>-fi"
    const longContentId = "x".repeat(120);
    const result = plan({ articles: [article({ approval: approval({ contentId: longContentId }) })] });
    expect(result.documents).toEqual([]);
    expect(result.blocked[0]?.reasons.join(" ")).toContain("exceed Sanity's 128-character document id limit");
  });

  it("migratedId itself throws rather than silently truncating, as a last-resort invariant", () => {
    expect(() => migratedId("article", "x".repeat(120), "fi")).toThrow(TypeError);
  });

  it("does not block a normal short contentId", () => {
    expect(plan().blocked).toEqual([]);
  });
});

describe("round-4 review finding: derived id length limits", () => {
  it("blocks an article whose derived endGalleryId would exceed the schema's 128-character limit", () => {
    const longContentId = "x".repeat(126); // + "-end" = 130 chars, over the limit
    const result = plan({
      articles: [
        article({
          approval: approval({ contentId: longContentId }),
          conversion: {
            blocks: [{ _type: "contentParagraphBlock", text: "Teksti." }],
            findings: [],
            resolvedImageAltText: [{ mediaId: "photo-a", language: "fi", value: "Alt" }],
            resolvedImageContentHashes: [],
            convertible: true,
            endGallery: { sourcePath: "stories/x", mediaIds: ["photo-a"] },
          },
        }),
      ],
      sourceLocators: { "photo-a": "stories/x/a.jpg" },
    });
    expect(result.documents).toEqual([]);
    expect(result.blocked[0]?.reasons.join(" ")).toContain("past the schema's 128-character limit");
  });

  it("does not block a short contentId's end gallery on length", () => {
    const result = plan({
      articles: [
        article({
          conversion: {
            blocks: [{ _type: "contentParagraphBlock", text: "Teksti." }],
            findings: [],
            resolvedImageAltText: [{ mediaId: "photo-a", language: "fi", value: "Alt" }],
            resolvedImageContentHashes: [],
            convertible: true,
            endGallery: { sourcePath: "stories/x", mediaIds: ["photo-a"] },
          },
        }),
      ],
      sourceLocators: { "photo-a": "stories/x/a.jpg" },
    });
    expect(result.blocked).toEqual([]);
  });
});

describe("blocking", () => {
  it("blocks an article whose category is not in the target tree", () => {
    const result = plan({ articles: [article({ approval: approval({ canonicalCategory: "ei-ole" }) })] });
    expect(result.documents).toEqual([]);
    expect(result.blocked[0]?.reasons[0]).toContain("not in the target content tree");
  });

  it("blocks an article whose conversion refused", () => {
    const result = plan({
      articles: [
        article({
          conversion: {
            blocks: [{ _type: "contentParagraphBlock", text: "Teksti." }],
            findings: [{ severity: "refusal", code: "unknown-plugin-marker", message: "x" }],
            resolvedImageAltText: [],
            resolvedImageContentHashes: [],
            convertible: false,
          },
        }),
      ],
    });
    expect(result.blocked[0]?.reasons).toContain('unresolved refusal "unknown-plugin-marker"');
  });

  it("errors when a referenced photograph has no source locator", () => {
    const result = plan({
      articles: [
        article({
          conversion: {
            blocks: [{ _type: "contentMediaBlock", media: "photo-missing" }],
            findings: [],
            resolvedImageAltText: [{ mediaId: "photo-missing", language: "fi", value: "Alt" }],
            resolvedImageContentHashes: [],
            convertible: true,
          },
        }),
      ],
    });
    expect(result.errors[0]).toContain("has no source locator");
  });
});

describe("validateMigrationDocuments", () => {
  const media: PlannedDocument = {
    _id: migratedId("media", "photo-1"),
    _type: "media",
    mediaId: "photo-1",
    mediaType: "image",
    alt: [{ _key: "alt-01", _type: "localizedText", language: "fi", value: "Alt" }],
    publiclyRenderable: true,
  };
  const good: PlannedDocument = {
    _id: migratedId("article", "a", "fi"),
    _type: "article",
    contentId: "a",
    language: "fi",
    title: "T",
    slug: "a",
    publishedAt: "2015-06-01T00:00:00.000Z",
    canonicalCategory: { _type: "reference", _ref: `${PENDING_CATEGORY_PREFIX}blogi` },
    body: [{ _key: "block-0001", _type: "contentParagraphBlock", text: "x" }],
  };

  it("accepts a well-formed set", () => {
    expect(validateMigrationDocuments([good, media])).toEqual([]);
  });

  it("rejects a media document missing mediaType or alt text — restating the Studio's own required fields", () => {
    const noType = { ...media, mediaType: undefined };
    expect(validateMigrationDocuments([good, noType]).join(" ")).toContain('mediaType must be "image" or "video"');

    const noAlt = { ...media, alt: [] };
    expect(validateMigrationDocuments([good, noAlt]).join(" ")).toContain("alt is required");

    const blankAlt = { ...media, alt: [{ _key: "alt-01", _type: "localizedText", language: "fi", value: "  " }] };
    expect(validateMigrationDocuments([good, blankAlt]).join(" ")).toContain("missing a language or a non-empty value");

    const duplicateLanguage = {
      ...media,
      alt: [
        { _key: "alt-01", _type: "localizedText", language: "fi", value: "A" },
        { _key: "alt-02", _type: "localizedText", language: "fi", value: "B" },
      ],
    };
    expect(validateMigrationDocuments([good, duplicateLanguage]).join(" ")).toContain("duplicate alt entry");
  });

  it("rejects a duplicate id and an id outside the namespace", () => {
    expect(validateMigrationDocuments([good, good])[0]).toContain("more than one document claims this id");
    expect(validateMigrationDocuments([{ ...good, _id: "seed--article-a-fi" }])[0]).toContain("namespace");
  });

  it("rejects two articles sharing one contentId and language, and one route", () => {
    const twin = { ...good, _id: migratedId("article", "a", "fi", "dup") };
    const violations = validateMigrationDocuments([good, twin]);
    expect(violations.join(" ")).toContain("share one contentId and language");
    expect(violations.join(" ")).toContain("claim the route");
  });

  it("rejects an unresolved body media reference", () => {
    const dangling = {
      ...good,
      body: [
        {
          _key: "block-0001",
          _type: "contentMediaBlock",
          media: { _type: "reference", _ref: migratedId("media", "photo-ghost") },
        },
      ],
    };
    expect(validateMigrationDocuments([dangling])[0]).toContain("is not a media document");
  });

  it("rejects an empty body and a bad publish instant", () => {
    expect(validateMigrationDocuments([{ ...good, body: [] }])[0]).toContain("at least one block");
    expect(validateMigrationDocuments([{ ...good, publishedAt: "2015-02-31T00:00:00.000Z" }])[0]).toContain(
      "not a real ISO instant",
    );
  });

  it("rejects a duplicate array _key", () => {
    const collided = {
      ...good,
      body: [
        { _key: "same", _type: "contentParagraphBlock", text: "a" },
        { _key: "same", _type: "contentParagraphBlock", text: "b" },
      ],
    };
    expect(validateMigrationDocuments([collided])[0]).toContain('duplicate _key "same"');
  });

  it("rejects a placement whose article declares no end gallery", () => {
    const placement: PlannedDocument = {
      _id: migratedId("end-gallery", "a-fi-0001"),
      _type: "articleEndGalleryPlacement",
      placementId: "a-fi-0001",
      order: 0,
      visible: true,
      article: { _type: "reference", _ref: good._id },
      media: { _type: "reference", _ref: media._id },
    };
    expect(validateMigrationDocuments([good, media, placement]).join(" ")).toContain("declares no endGalleryId");
  });

  it("rejects an article declaring an end gallery with no placements, and a gapped order", () => {
    const withGallery = { ...good, endGalleryId: "a-end" };
    expect(validateMigrationDocuments([withGallery, media]).join(" ")).toContain("has no placements");

    const gapped: PlannedDocument = {
      _id: migratedId("end-gallery", "a-fi-0002"),
      _type: "articleEndGalleryPlacement",
      placementId: "a-fi-0002",
      order: 5,
      visible: true,
      article: { _type: "reference", _ref: good._id },
      media: { _type: "reference", _ref: media._id },
    };
    expect(validateMigrationDocuments([withGallery, media, gapped]).join(" ")).toContain("dense 0-based sequence");
  });
});

describe("end to end: manifest text and source body into a document plan", () => {
  const body =
    "<p>Kokeilin kameraa.</p><h2>Havainnot</h2><p>Tarkka.</p>" +
    '<p><img src="stories/blogi/Pentax_645Z/kuva1.jpg"></p>' +
    "{gallery}stories/blogi/Pentax_645Z{/gallery}";
  const title = "Pentax 645Z laajassa kokeilussa";
  // Mirrors `sourceRecordDigest` in convert-joomla-content.mts: the whole
  // imported record, not the body alone.
  const sourceDigest = createHash("sha256")
    .update(JSON.stringify({ title, summary: null, author: null, tags: null, body }), "utf8")
    .digest("hex");

  const galleryMediaIds = Array.from({ length: 32 }, (_, index) => `photo-gallery-${index}`);

  // Computed once, at describe scope, so the manifest's `resolved_digest` and
  // the test's own conversion are provably the same conversion — the whole
  // point of the round-6 fix being tested here.
  function convert(): ReturnType<typeof convertJoomlaBody> {
    return convertJoomlaBody(body, {
      language: "fi",
      resolveImage: (src) => (src.endsWith("kuva1.jpg") ? { mediaId: "photo-body-1", alt: "Kamera" } : undefined),
      resolveGallery: (path) =>
        path === "stories/blogi/Pentax_645Z"
          ? {
              kind: "end",
              mediaIds: galleryMediaIds,
              altTextByMediaId: Object.fromEntries(galleryMediaIds.map((id) => [id, `Alt ${id}`])),
            }
          : undefined,
    });
  }

  function manifestText(): string {
    const cells: Record<string, string> = {
      joomla_id: "347",
      language: "fi-FI",
      content_id: "pentax-645z",
      slug: "pentax-645z",
      canonical_category: "blogi",
      secondary_categories: "",
      phase: "launch",
      published_at: "2015-06-01T00:00:00.000Z",
      event_date: "",
      source_digest: sourceDigest,
      resolved_digest: resolvedConversionDigest(convert()),
      conversion_policy: CONVERSION_POLICY_VERSION,
      acknowledged_findings: "",
      public_launch_decision: "INCLUDE",
      eligible_for_import: "YES",
      approved_by: "Ilkka Rytkönen",
      approved_at: "2026-09-17",
    };
    return [MANIFEST_COLUMNS.join(";"), MANIFEST_COLUMNS.map((column) => cells[column] ?? "").join(";")].join("\n");
  }

  it("walks the whole path and produces a coherent, non-writable plan", () => {
    const review = reviewImportManifest(manifestText(), { phase: "launch" });
    expect(review.errors).toEqual([]);
    const approved = review.approved[0];
    expect(approved).toBeDefined();

    const conversion = convert();
    expect(conversion.convertible).toBe(true);

    const locators: Record<string, string> = { "photo-body-1": "stories/blogi/Pentax_645Z/kuva1.jpg" };
    for (const [index, mediaId] of galleryMediaIds.entries()) {
      locators[mediaId] = `stories/blogi/Pentax_645Z/g${index}.jpg`;
    }

    const result = buildImportPlan({
      phase: "launch",
      manifestDigest: review.digest,
      sourceExportDigest: sourceDigest,
      articles: [
        {
          approval: approved!,
          title,
          sourceDigest,
          conversion,
        },
      ],
      knownCategoryIds: ["blogi"],
      sourceLocators: locators,
    });

    expect(result.errors).toEqual([]);
    expect(result.blocked).toEqual([]);

    const articleDocument = result.documents.find((document) => document._type === "article");
    expect(articleDocument).toMatchObject({
      contentId: "pentax-645z",
      language: "fi",
      endGalleryId: "pentax-645z-end",
    });

    // 33 photographs (one in the body, 32 in the gallery), 32 placements, 1 article.
    expect(result.documents.filter((document) => document._type === "media")).toHaveLength(33);
    expect(result.documents.filter((document) => document._type === "articleEndGalleryPlacement")).toHaveLength(32);
    expect(result.assetRequirements).toHaveLength(33);

    // The end gallery is its own sequence: it is not also in the body.
    expect((articleDocument?.body as readonly { _type: string }[]).map((block) => block._type)).toEqual([
      "contentParagraphBlock",
      "contentHeadingBlock",
      "contentParagraphBlock",
      "contentMediaBlock",
    ]);

    expect(result.writable).toBe(false);
  });
});
