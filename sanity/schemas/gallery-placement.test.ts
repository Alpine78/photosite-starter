import { describe, expect, it } from "vitest";

import { defineSchemaTypes } from "./index";
import { GALLERY_TYPE_NAME } from "./gallery";
import {
  galleryPlacementType,
  GALLERY_PLACEMENT_TYPE_NAME,
  MAX_PLACEMENT_ID_LENGTH,
} from "./gallery-placement";
import { MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaFieldDefinition,
  SchemaValidation,
  SchemaValidationClient,
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";

type CustomCheck = (
  value: unknown,
  context: SchemaValidationContext,
) => SchemaValidationResult | Promise<SchemaValidationResult>;

function inspect(
  validation: SchemaValidation | undefined,
  dataset: { answer?: unknown } = {},
) {
  const checks: CustomCheck[] = [];
  const warnings: CustomCheck[] = [];
  const queries: { query: string; params?: Readonly<Record<string, unknown>> }[] = [];
  let required = false;

  const rule: SchemaValidationRule = {
    required() {
      required = true;
      return rule;
    },
    min() {
      return rule;
    },
    max() {
      return rule;
    },
    custom(check) {
      checks.push(check as CustomCheck);
      return rule;
    },
    warning(check) {
      warnings.push(check as CustomCheck);
      return rule;
    },
  };

  validation?.(rule);

  const client: SchemaValidationClient = {
    async fetch(query, params) {
      queries.push({ query, ...(params === undefined ? {} : { params }) });
      return dataset.answer as never;
    },
    withConfig() {
      return client;
    },
  };

  const contextFor = (document?: Record<string, unknown>): SchemaValidationContext => ({
    ...(document === undefined ? {} : { document }),
    getClient: () => client,
  });

  const run = async (value: unknown, document?: Record<string, unknown>) =>
    Promise.all(checks.map((check) => check(value, contextFor(document))));
  const runWarnings = async (value: unknown, document?: Record<string, unknown>) =>
    Promise.all(warnings.map((check) => check(value, contextFor(document))));

  return { required, run, runWarnings, queries };
}

function fieldOf(name: string): SchemaFieldDefinition {
  const field = galleryPlacementType.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}"`);
  return field;
}

const currentDocument = (overrides: Record<string, unknown> = {}) => ({
  _id: "placement-doc-abc",
  gallery: { _ref: "gallery-doc-abc" },
  media: { _ref: "media-a" },
  ...overrides,
});

type GalleryShorthand = { contentId: string; sections: readonly { sectionId: string }[] } | null;

/**
 * `gallery` is a convenience shorthand for the common case (a single
 * published-only gallery, or none at all) — `validateGalleryPlacementPublication`
 * actually reads `galleryVersions`, an array covering both the published and
 * draft copies (see that function's own comment on why). A test exercising
 * the draft-vs-published distinction itself overrides `galleryVersions`
 * directly instead of using this shorthand.
 */
const galleryAnswer = (
  overrides: Record<string, unknown> & { gallery?: GalleryShorthand } = {},
) => {
  const { gallery, ...rest } = overrides;
  const galleryVersions =
    gallery === undefined
      ? [{ _id: "gallery-doc-abc", contentId: "content-northern-coast", sections: [] }]
      : gallery === null
        ? []
        : [{ _id: "gallery-doc-abc", ...gallery }];

  return {
    published: null,
    conflicting: [],
    galleryVersions,
    ...rest,
  };
};

describe("the gallery placement document", () => {
  it("is registered in the schema index", () => {
    const types = defineSchemaTypes({
      datasetVisibility: "public",
      storyRootPaths: ["/stories"],
    });
    expect(types.some((type) => type.name === GALLERY_PLACEMENT_TYPE_NAME)).toBe(true);
  });

  it("references a gallery and media document", () => {
    expect(fieldOf("gallery").to).toEqual([{ type: GALLERY_TYPE_NAME }]);
    expect(fieldOf("media").to).toEqual([{ type: MEDIA_TYPE_NAME }]);
    expect(inspect(fieldOf("gallery").validation).required).toBe(true);
  });

  it("defaults visible to true and pinned to false", () => {
    expect(fieldOf("visible").initialValue).toBe(true);
    expect(fieldOf("pinned").initialValue).toBe(false);
  });

  it("requires order to be a non-negative integer", async () => {
    const { required, run } = inspect(fieldOf("order").validation);
    expect(required).toBe(true);
    expect(await run(0)).toEqual([true]);
    expect(await run(12)).toEqual([true]);
    for (const rejected of [-1, 1.5, undefined]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });
});

describe("placementId", () => {
  it("requires the documented form", async () => {
    const { required, run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer(),
    });
    expect(required).toBe(true);
    for (const rejected of ["Not Valid", "-leading", "", undefined]) {
      expect((await run(rejected, currentDocument()))[0]).toEqual(expect.any(String));
    }
  });

  it("rejects a placement id longer than the public read boundary's own limit", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer(),
    });
    const tooLong = "a".repeat(MAX_PLACEMENT_ID_LENGTH + 1);
    const result = await run(tooLong, currentDocument());
    expect(result[0]).toContain(`${MAX_PLACEMENT_ID_LENGTH}`);
  });

  it("accepts a placement id exactly at the limit", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer(),
    });
    const atLimit = "a".repeat(MAX_PLACEMENT_ID_LENGTH);
    expect(await run(atLimit, currentDocument())).toEqual([true]);
  });

  it("passes a well-formed id whose gallery resolves and names no section", async () => {
    const { run } = inspect(fieldOf("placementId").validation, { answer: galleryAnswer() });
    expect(await run("northern-coast-01", currentDocument())).toEqual([true]);
  });

  it("rejects a gallery reference that does not resolve", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer({ gallery: null }),
    });
    expect((await run("northern-coast-01", currentDocument()))[0]).toContain(
      "does not resolve",
    );
  });

  it("rejects a section the gallery does not declare", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer({ gallery: { contentId: "content-x", sections: [{ sectionId: "known" }] } }),
    });
    const result = await run(
      "northern-coast-01",
      currentDocument({ sectionId: "unknown" }),
    );
    expect(result[0]).toContain("does not declare");
  });

  it("passes a section the gallery declares", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer({ gallery: { contentId: "content-x", sections: [{ sectionId: "known" }] } }),
    });
    expect(
      await run("northern-coast-01", currentDocument({ sectionId: "known" })),
    ).toEqual([true]);
  });

  it("sees a section just added to the gallery's own unpublished draft, not only its published copy", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: {
        published: null,
        conflicting: [],
        galleryVersions: [
          { _id: "gallery-doc-abc", contentId: "content-x", sections: [] },
          { _id: "drafts.gallery-doc-abc", contentId: "content-x", sections: [{ sectionId: "brand-new" }] },
        ],
      },
    });
    const result = await run("northern-coast-01", currentDocument({ sectionId: "brand-new" }));
    expect(result).toEqual([true]);
  });

  it("falls back to the published gallery when it has no unpublished draft", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: {
        published: null,
        conflicting: [],
        galleryVersions: [{ _id: "gallery-doc-abc", contentId: "content-x", sections: [{ sectionId: "known" }] }],
      },
    });
    expect(
      await run("northern-coast-01", currentDocument({ sectionId: "known" })),
    ).toEqual([true]);
  });

  it("rejects a placement id already used by a different gallery (site-wide uniqueness)", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer({
        conflicting: [
          {
            _id: "other-placement-doc",
            mediaRef: "media-x",
            sectionId: null,
            galleryContentId: "content-different-gallery",
          },
        ],
      }),
    });
    const result = await run("northern-coast-01", currentDocument());
    expect(result[0]).toContain("already used by a different gallery");
  });

  it("allows a matching placement id on a sibling-language version of the same gallery", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer({
        conflicting: [
          {
            _id: "other-placement-doc",
            mediaRef: "media-a",
            sectionId: null,
            galleryContentId: "content-northern-coast",
          },
        ],
      }),
    });
    expect(await run("northern-coast-01", currentDocument())).toEqual([true]);
  });

  it("rejects a sibling-language placement id rebound to a different photograph", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer({
        conflicting: [
          {
            _id: "other-placement-doc",
            mediaRef: "media-different",
            sectionId: null,
            galleryContentId: "content-northern-coast",
          },
        ],
      }),
    });
    const result = await run("northern-coast-01", currentDocument());
    expect(result[0]).toContain("different photograph or section");
  });

  it("rejects replacing a published placement's media without minting a new placement id", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer({
        published: { galleryRef: "gallery-doc-abc", mediaRef: "media-was-here" },
      }),
    });
    const result = await run("northern-coast-01", currentDocument());
    expect(result[0]).toContain("already published against a different photograph");
  });

  it("allows re-publishing a placement whose media and gallery are unchanged", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer({
        published: { galleryRef: "gallery-doc-abc", mediaRef: "media-a" },
      }),
    });
    expect(await run("northern-coast-01", currentDocument())).toEqual([true]);
  });

  it("rejects moving a published placement to a different gallery", async () => {
    const { run } = inspect(fieldOf("placementId").validation, {
      answer: galleryAnswer({
        published: { galleryRef: "gallery-doc-different", mediaRef: "media-a" },
      }),
    });
    const result = await run("northern-coast-01", currentDocument());
    expect(result[0]).toContain("already published under a different gallery");
  });
});

describe("repeated media within one gallery", () => {
  it("warns, without blocking, when a photograph repeats (ADR-0002 §2)", async () => {
    const { runWarnings } = inspect(fieldOf("media").validation, {
      answer: {
        siblings: [
          { _id: "placement-doc-abc", mediaRef: "media-a" },
          { _id: "other-placement-doc", mediaRef: "media-a" },
        ],
      },
    });
    const result = await runWarnings({ _ref: "media-a" }, currentDocument());
    expect(result[0]).toEqual(expect.any(String));
  });

  it("does not warn when this is the only placement using the media", async () => {
    const { runWarnings } = inspect(fieldOf("media").validation, {
      answer: { siblings: [{ _id: "placement-doc-abc", mediaRef: "media-a" }] },
    });
    expect(await runWarnings({ _ref: "media-a" }, currentDocument())).toEqual([true]);
  });
});
