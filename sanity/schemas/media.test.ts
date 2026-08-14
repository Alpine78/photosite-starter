import { describe, expect, it } from "vitest";

import { defineSchemaTypes } from "./index";
import { localizedTextType } from "./localized-text";
import {
  defineMediaType,
  MAX_PUBLIC_DELIVERY_DIMENSION,
  MEDIA_TYPE_NAME,
} from "./media";
import { publishedIdOf } from "./validation";
import type {
  SchemaFieldDefinition,
  SchemaTypeDefinition,
  SchemaValidation,
  SchemaValidationClient,
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";

/**
 * The schemas are plain objects and their validation rules are plain
 * functions, so a running Studio is not needed to check that they say what they
 * mean. This harness stands in for the rule builder a Studio passes in, records
 * which constraints were declared, and answers the rules' dataset queries from
 * this file — including the asynchronous ones, which are the rules that
 * actually stop a camera master or a duplicated identity from being published.
 */
type CustomCheck = (
  value: unknown,
  context: SchemaValidationContext,
) => SchemaValidationResult | Promise<SchemaValidationResult>;

type RecordedQuery = {
  query: string;
  params: Readonly<Record<string, unknown>> | undefined;
};

function inspect(
  validation: SchemaValidation | undefined,
  dataset: { answer?: unknown } = {},
) {
  const checks: CustomCheck[] = [];
  const queries: RecordedQuery[] = [];
  const clientSettings: { perspective: string; useCdn?: boolean }[] = [];
  let required = false;
  let min: number | undefined;

  const rule: SchemaValidationRule = {
    required() {
      required = true;
      return rule;
    },
    min(value) {
      min = value;
      return rule;
    },
    max() {
      return rule;
    },
    custom(check) {
      checks.push(check as CustomCheck);
      return rule;
    },
  };

  validation?.(rule);

  const contextFor = (
    document?: Record<string, unknown>,
  ): SchemaValidationContext => ({
    ...(document === undefined ? {} : { document }),
    getClient: () => client,
  });

  const client: SchemaValidationClient = {
    async fetch(query, params) {
      queries.push({ query, params });
      return dataset.answer as never;
    },
    withConfig(settings) {
      clientSettings.push(settings);
      return client;
    },
  };

  const run = async (value: unknown, document?: Record<string, unknown>) =>
    Promise.all(checks.map((check) => check(value, contextFor(document))));

  return { required, min, run, queries, clientSettings };
}

function fieldOf(
  type: { readonly fields: readonly SchemaFieldDefinition[] },
  name: string,
): SchemaFieldDefinition {
  const field = type.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}"`);
  return field;
}

const publicMedia = defineMediaType({ datasetVisibility: "public" });
const privateMedia = defineMediaType({ datasetVisibility: "private" });

const fieldNames = (type: SchemaTypeDefinition) =>
  type.fields.map((field) => field.name);

const UNIQUE_AND_UNCHANGED = { taken: false, publishedMediaId: null };

const WEB_EXPORT = {
  width: 1600,
  height: 1067,
  extension: "webp",
  mimeType: "image/webp",
};

describe("the media document", () => {
  it("is registered with the object types it uses", () => {
    const types = defineSchemaTypes({ datasetVisibility: "public" });

    expect(types).toContainEqual(localizedTextType);
    expect(types.map((type) => type.name)).toContain(MEDIA_TYPE_NAME);
  });

  it("keeps every placement-owned field off the photograph", () => {
    // Order, section membership, and a context-specific caption belong to the
    // container that places a photograph (ADR-0002 §3). On the media document
    // they would mean one photograph can live in only one gallery.
    for (const placementField of [
      "order",
      "sectionId",
      "placementId",
      "captionOverride",
      "altOverride",
      "gallery",
    ]) {
      expect(fieldNames(privateMedia)).not.toContain(placementField);
    }
  });

  it("names the two kinds of media the model supports", () => {
    expect(
      fieldOf(privateMedia, "mediaType").options?.list?.map(
        (option) => option.value,
      ),
    ).toEqual(["image", "video"]);
  });

  it("offers no crop control, because a cropped photograph is a different one", () => {
    expect(fieldOf(privateMedia, "image").options?.hotspot).toBe(false);
  });

  it("does not keep the uploaded file's own name", () => {
    // Sanity keeps it by default and warns that filenames carry sensitive
    // information — a client's name, an internal working title — and an asset
    // document in a public dataset is readable by anyone.
    expect(fieldOf(privateMedia, "image").options?.storeOriginalFilename).toBe(
      false,
    );
  });

  it("offers the file picker only web delivery formats", () => {
    expect(fieldOf(privateMedia, "image").options?.accept).toBe(
      "image/avif,image/jpeg,image/png,image/webp",
    );
  });
});

describe("where a master's location may be recorded", () => {
  it("offers no archive field at all in a world-readable dataset", () => {
    // Anyone holding the project id can query every published document in a
    // public dataset, so a field for archive paths would not be server-only in
    // any sense — it would be published. It is absent rather than discouraged.
    expect(fieldNames(publicMedia)).not.toContain("archiveLocator");
  });

  it("offers it in a dataset that requires a credential to read", () => {
    expect(fieldNames(privateMedia)).toContain("archiveLocator");
  });
});

describe("the media identity", () => {
  it("requires the documented form", async () => {
    const { required, run } = inspect(
      fieldOf(privateMedia, "mediaId").validation,
      { answer: UNIQUE_AND_UNCHANGED },
    );

    expect(required).toBe(true);
    expect(await run("coastal-landscape")).toEqual([true]);
    for (const rejected of [
      "Coastal Landscape",
      "coastal--landscape",
      "-coastal",
      "coastal_landscape",
      "",
      undefined,
    ]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });

  it.each([
    ["a published document", "other"],
    // The collision that matters most: two drafts quietly taking one identity,
    // then being published and breaking every reference at once.
    ["another document's unpublished draft", "drafts.other"],
    ["another document inside a content release", "versions.summer-drop.other"],
  ])("refuses an identity %s already claims", async () => {
    const { run } = inspect(fieldOf(privateMedia, "mediaId").validation, {
      answer: { taken: true, publishedMediaId: null },
    });

    expect((await run("coastal-landscape", { _id: "abc" }))[0]).toContain(
      "already uses",
    );
  });

  it("asks with a perspective that can see unpublished documents", async () => {
    // A client's default perspective is `published`, which would make the
    // check above blind to exactly the case it exists for.
    const { run, clientSettings } = inspect(
      fieldOf(privateMedia, "mediaId").validation,
      { answer: UNIQUE_AND_UNCHANGED },
    );

    await run("coastal-landscape", { _id: "abc" });

    expect(clientSettings).toEqual([{ perspective: "raw", useCdn: false }]);
  });

  it.each([
    ["its own published version", "abc"],
    ["its own draft", "drafts.abc"],
    ["its own version in a release", "versions.summer-drop.abc"],
  ])("does not collide with %s", async (_case, ownId) => {
    const { run } = inspect(fieldOf(privateMedia, "mediaId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    expect(await run("coastal-landscape", { _id: ownId })).toEqual([true]);
  });

  it("excludes every version of this document before bounding the collision query", async () => {
    const { run, queries } = inspect(
      fieldOf(privateMedia, "mediaId").validation,
      { answer: UNIQUE_AND_UNCHANGED },
    );

    await run("coastal-landscape", { _id: "abc" });

    // Filtering in GROQ before `[0]` is load-bearing. If twenty release
    // versions were fetched first and filtered in TypeScript, they could hide
    // the twenty-first result belonging to another logical document.
    //
    // `sanity::versionOf` is a boolean predicate evaluated against the
    // document GROQ is currently visiting — Sanity's own uniqueness example
    // uses it bare, as `!sanity::versionOf($id)`. It is not a collection: an
    // earlier draft of this query wrapped it in `_id in (...)`, which compares
    // a string against a boolean, evaluates to `false` for every document by
    // GROQ's own type-mismatch rule, and so never excluded anything —
    // including the document being edited, which made every save of an
    // already-published photograph report its own identity as taken.
    expect(queries[0].query).toContain("!sanity::versionOf($published)");
    expect(queries[0].query).not.toContain("_id in sanity::versionOf");
    expect(queries[0].query).toContain("][0]._id");
    expect(queries[0].query).not.toContain("[0...20]");
  });

  it("refuses to rename an identity that has already been published", async () => {
    const { run } = inspect(fieldOf(privateMedia, "mediaId").validation, {
      answer: { taken: false, publishedMediaId: "coastal-landscape" },
    });

    expect((await run("quiet-coast", { _id: "abc" }))[0]).toContain(
      "coastal-landscape",
    );
  });

  it("allows correcting an identity before the first publish", async () => {
    const { run } = inspect(fieldOf(privateMedia, "mediaId").validation, {
      answer: UNIQUE_AND_UNCHANGED,
    });

    expect(await run("quiet-coast", { _id: "drafts.abc" })).toEqual([true]);
  });
});

describe("which document version an id belongs to", () => {
  it.each([
    ["abc", "abc"],
    ["drafts.abc", "abc"],
    ["versions.summer-drop.abc", "abc"],
    ["versions.summer-drop.abc.def", "abc.def"],
    ["versions.orphan", "orphan"],
  ])("resolves %s to %s", (id, expected) => {
    expect(publishedIdOf(id)).toBe(expected);
  });
});

describe("what may be uploaded as a public image", () => {
  const imageValidation = () => fieldOf(privateMedia, "image").validation;
  const uploaded = { asset: { _ref: "image-abc-1600x1067-webp" } };

  it("accepts an exported web copy", async () => {
    const { run } = inspect(imageValidation(), { answer: WEB_EXPORT });

    expect(await run(uploaded, { mediaType: "image" })).toEqual([true]);
  });

  it("blocks publishing a camera master", async () => {
    // The upload itself cannot be undone — the file is on a public CDN the
    // moment it lands — so the rule stops the publish and says to delete it.
    const { run } = inspect(imageValidation(), {
      answer: { ...WEB_EXPORT, width: 6000, height: 4000 },
    });

    const [message] = await run(uploaded, { mediaType: "image" });
    expect(message).toContain(`${MAX_PUBLIC_DELIVERY_DIMENSION}px`);
    expect(message).toContain("Delete");
  });

  it("accepts a file exactly at the delivery limit", async () => {
    const { run } = inspect(imageValidation(), {
      answer: {
        ...WEB_EXPORT,
        width: MAX_PUBLIC_DELIVERY_DIMENSION,
        height: 1365,
      },
    });

    expect(await run(uploaded, { mediaType: "image" })).toEqual([true]);
  });

  it.each([
    ["a camera format", { ...WEB_EXPORT, extension: "tif", mimeType: "image/tiff" }],
    ["a media type that contradicts the extension", { ...WEB_EXPORT, mimeType: "image/jpeg" }],
    ["a file with no image dimensions", { ...WEB_EXPORT, width: null, height: null }],
  ])("blocks publishing %s", async (_case, answer) => {
    const { run } = inspect(imageValidation(), { answer });

    expect((await run(uploaded, { mediaType: "image" }))[0]).toEqual(
      expect.any(String),
    );
  });

  it("says so when the uploaded asset cannot be read", async () => {
    const { run } = inspect(imageValidation(), { answer: null });

    expect((await run(uploaded, { mediaType: "image" }))[0]).toEqual(
      expect.any(String),
    );
  });

  it("requires an upload for an image and not for another kind", async () => {
    const { run, queries } = inspect(imageValidation(), { answer: WEB_EXPORT });

    expect((await run(undefined, { mediaType: "image" }))[0]).toEqual(
      expect.any(String),
    );
    expect(await run(undefined, { mediaType: "video" })).toEqual([true]);
    // Neither case reaches the dataset: there is nothing to measure.
    expect(queries).toHaveLength(0);
  });
});

describe("authored text", () => {
  it("requires alternative text and refuses two entries for one language", async () => {
    const { required, min, run } = inspect(
      fieldOf(privateMedia, "alt").validation,
    );

    expect(required).toBe(true);
    expect(min).toBe(1);
    expect(await run([{ language: "fi" }, { language: "en" }])).toEqual([true]);
    expect((await run([{ language: "fi" }, { language: "fi" }]))[0]).toContain(
      "fi",
    );
  });

  it("lets a caption exist in some languages and not others", async () => {
    const { required, run } = inspect(
      fieldOf(privateMedia, "caption").validation,
    );

    expect(required).toBe(false);
    expect(await run([{ language: "en" }])).toEqual([true]);
    expect(await run(undefined)).toEqual([true]);
  });

  it("accepts a language subtag and refuses a locale or a name", async () => {
    const { required, run } = inspect(
      fieldOf(localizedTextType, "language").validation,
    );

    expect(required).toBe(true);
    for (const accepted of ["fi", "en", "swe"]) {
      expect(await run(accepted)).toEqual([true]);
    }
    for (const rejected of ["FI", "fi-FI", "finnish", "f", ""]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });

  it("requires the text itself", () => {
    expect(
      inspect(fieldOf(localizedTextType, "value").validation).required,
    ).toBe(true);
  });
});
