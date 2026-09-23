import { describe, expect, it } from "vitest";

import {
  CAPTURE_SEQUENCE_GALLERY_TYPE,
  CAPTURE_SEQUENCE_MEDIA_TYPE,
  CAPTURE_SEQUENCE_ORDERING_RULE,
  captureSequenceField,
} from "./capture-sequence";
import { galleryType, GALLERY_TYPE_NAME, ORDERING_RULES } from "./gallery";
import { galleryPlacementType } from "./gallery-placement";
import { defineMediaType, MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaFieldDefinition,
  SchemaValidation,
  SchemaValidationClient,
  SchemaValidationContext,
} from "./schema-types";
import { inspectValidationRules } from "./validation-test-helper";

function inspect(validation: SchemaValidation | undefined, answer?: unknown) {
  const queries: { query: string; params?: Readonly<Record<string, unknown>> }[] = [];
  const { checks } = inspectValidationRules(validation);
  const client: SchemaValidationClient = {
    async fetch(query, params) {
      queries.push({ query, ...(params === undefined ? {} : { params }) });
      return answer as never;
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
  return { run, queries };
}

function fieldOf(
  fields: readonly SchemaFieldDefinition[],
  name: string,
): SchemaFieldDefinition {
  const field = fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}"`);
  return field;
}

const mediaDocument = { _id: "drafts.media-abc" };
const valid = { galleryContentId: "rally-example-2024", sequence: 327, sectionId: "ss2" };

const captureGallery = (overrides: Record<string, unknown> = {}) => ({
  _id: "gallery-rally-example-2024-fi",
  orderingRule: CAPTURE_SEQUENCE_ORDERING_RULE,
  sections: [{ sectionId: "ss1" }, { sectionId: "ss2" }],
  ...overrides,
});

describe("restated type names", () => {
  it("match the schemas they stand in for", () => {
    expect(CAPTURE_SEQUENCE_GALLERY_TYPE).toBe(GALLERY_TYPE_NAME);
    expect(CAPTURE_SEQUENCE_MEDIA_TYPE).toBe(MEDIA_TYPE_NAME);
  });
});

describe("the media captureSequence field (ADR-0022 §1)", () => {
  it("is on the media document in both dataset visibilities", () => {
    for (const datasetVisibility of ["public", "private"] as const) {
      const media = defineMediaType({ datasetVisibility });
      expect(fieldOf(media.fields, "captureSequence")).toBe(captureSequenceField);
    }
    expect(
      captureSequenceField.fields?.map((field) => field.name),
    ).toEqual(["galleryContentId", "sequence", "sectionId"]);
  });

  it("accepts an absent value without a query", async () => {
    const { run, queries } = inspect(captureSequenceField.validation);
    expect(await run(undefined, mediaDocument)).toEqual([true]);
    expect(queries).toEqual([]);
  });

  it("rejects a malformed gallery id, sequence, or section before querying", async () => {
    const { run, queries } = inspect(captureSequenceField.validation);
    for (const rejected of [
      { ...valid, galleryContentId: "Rally 2024" },
      { ...valid, galleryContentId: undefined },
      { ...valid, sequence: 0 },
      { ...valid, sequence: 1.5 },
      { ...valid, sequence: "327" },
      { ...valid, sectionId: "" },
    ]) {
      expect((await run(rejected, mediaDocument))[0]).toEqual(expect.any(String));
    }
    expect(queries).toEqual([]);
  });

  it("accepts a sequence in a capture-sequence gallery that declares the section in every language", async () => {
    const { run, queries } = inspect(captureSequenceField.validation, {
      galleries: [captureGallery(), captureGallery({ _id: "gallery-rally-example-2024-en" })],
      sequenceTaken: false,
    });
    expect(await run(valid, mediaDocument)).toEqual([true]);
    expect(queries[0]?.params).toMatchObject({
      galleryContentId: "rally-example-2024",
      sequence: 327,
      published: "media-abc",
    });
    expect(queries[0]?.query).toContain("!sanity::versionOf($published)");
  });

  it("accepts a photograph with no section", async () => {
    const { run } = inspect(captureSequenceField.validation, {
      galleries: [captureGallery({ sections: [] })],
      sequenceTaken: false,
    });
    const withoutSection = { galleryContentId: valid.galleryContentId, sequence: valid.sequence };
    expect(await run(withoutSection, mediaDocument)).toEqual([true]);
  });

  it("refuses an unknown gallery", async () => {
    const { run } = inspect(captureSequenceField.validation, {
      galleries: [],
      sequenceTaken: false,
    });
    expect((await run(valid, mediaDocument))[0]).toMatch(/No gallery/);
  });

  it("refuses a gallery that is not ordered by capture sequence in every language", async () => {
    const { run } = inspect(captureSequenceField.validation, {
      galleries: [captureGallery(), captureGallery({ orderingRule: "manual" })],
      sequenceTaken: false,
    });
    expect((await run(valid, mediaDocument))[0]).toMatch(/not ordered by capture sequence/);
  });

  it("refuses a section one language does not declare", async () => {
    const { run } = inspect(captureSequenceField.validation, {
      galleries: [captureGallery(), captureGallery({ sections: [{ sectionId: "ss1" }] })],
      sequenceTaken: false,
    });
    expect((await run(valid, mediaDocument))[0]).toMatch(/does not declare section "ss2"/);
  });

  it("refuses a sequence another photograph of the gallery already holds", async () => {
    const { run } = inspect(captureSequenceField.validation, {
      galleries: [captureGallery()],
      sequenceTaken: true,
    });
    expect((await run(valid, mediaDocument))[0]).toMatch(/already has sequence 327/);
  });
});

describe("the gallery capture-sequence ordering rule", () => {
  const orderingRule = fieldOf(galleryType.fields, "orderingRule");

  it("is one of the offered rules", () => {
    expect(ORDERING_RULES).toContain(CAPTURE_SEQUENCE_ORDERING_RULE);
  });

  it("is refused while any placement still references the gallery", async () => {
    const { run, queries } = inspect(orderingRule.validation, true);
    const [result] = await run(CAPTURE_SEQUENCE_ORDERING_RULE, {
      _id: "drafts.gallery-abc",
    });
    expect(result).toMatch(/still has placements/);
    expect(queries[0]?.params).toMatchObject({
      published: "gallery-abc",
      draft: "drafts.gallery-abc",
    });
  });

  it("is accepted once no placement references the gallery", async () => {
    const { run } = inspect(orderingRule.validation, false);
    expect(await run(CAPTURE_SEQUENCE_ORDERING_RULE, { _id: "gallery-abc" })).toEqual([true]);
  });

  it("does not query for the other rules", async () => {
    const { run, queries } = inspect(orderingRule.validation, true);
    expect(await run("manual", { _id: "gallery-abc" })).toEqual([true]);
    expect(await run("seeded-random", { _id: "gallery-abc" })).toEqual([true]);
    expect(queries).toEqual([]);
  });
});

describe("a placement against a capture-sequence gallery", () => {
  it("is refused (one representation per gallery)", async () => {
    const placementId = fieldOf(galleryPlacementType.fields, "placementId");
    const { run } = inspect(placementId.validation, {
      published: null,
      conflicting: [],
      galleryVersions: [
        {
          _id: "gallery-doc-abc",
          contentId: "rally-example-2024",
          orderingRule: CAPTURE_SEQUENCE_ORDERING_RULE,
          sections: [],
        },
      ],
    });
    const [result] = await run("rally-example-2024-0001", {
      _id: "placement-doc-abc",
      gallery: { _ref: "gallery-doc-abc" },
      media: { _ref: "media-a" },
    });
    expect(result).toMatch(/ordered by capture sequence/);
  });
});
