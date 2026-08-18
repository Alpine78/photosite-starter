import { describe, expect, it } from "vitest";

import {
  CONTENT_BLOCK_KINDS,
  CONTENT_BLOCK_OBJECT_TYPES,
  contentBlockTypes,
  defineContentBodyField,
  YOUTUBE_VIDEO_ID_PATTERN,
} from "./content-block";
import { defineSchemaTypes } from "./index";
import { MEDIA_TYPE_NAME } from "./media";
import type {
  SchemaTypeDefinition,
  SchemaValidation,
  SchemaValidationClient,
  SchemaValidationContext,
  SchemaValidationResult,
  SchemaValidationRule,
} from "./schema-types";

/**
 * Duplicated from `media.test.ts` rather than shared — see `category.test.ts`'s
 * comment on the same choice.
 */
type CustomCheck = (
  value: unknown,
  context: SchemaValidationContext,
) => SchemaValidationResult | Promise<SchemaValidationResult>;

function inspect(validation: SchemaValidation | undefined) {
  const checks: CustomCheck[] = [];
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
    warning(check) {
      checks.push(check as CustomCheck);
      return rule;
    },
  };

  validation?.(rule);

  const client: SchemaValidationClient = {
    async fetch() {
      return undefined as never;
    },
    withConfig() {
      return client;
    },
  };

  const run = async (value: unknown) =>
    Promise.all(checks.map((check) => check(value, { getClient: () => client })));

  return { required, min, run };
}

function typeOf(name: string): SchemaTypeDefinition {
  const type = contentBlockTypes.find((candidate) => candidate.name === name);
  if (type === undefined) throw new Error(`no content block type named "${name}"`);
  return type;
}

function fieldOf(type: SchemaTypeDefinition, name: string) {
  const field = type.fields.find((candidate) => candidate.name === name);
  if (field === undefined) throw new Error(`no field named "${name}" on "${type.name}"`);
  return field;
}

describe("the shared block types", () => {
  it("names every ADR-0003 decision 2 block kind", () => {
    expect(CONTENT_BLOCK_KINDS).toEqual([
      "paragraph",
      "heading",
      "list",
      "blockquote",
      "media",
      "youtube",
    ]);
    expect(contentBlockTypes.map((type) => type.name).sort()).toEqual(
      Object.values(CONTENT_BLOCK_OBJECT_TYPES).sort(),
    );
  });

  it("is registered in the schema index", () => {
    const types = defineSchemaTypes({
      datasetVisibility: "public",
      storyRootPaths: ["/stories"],
    });
    const names = types.map((type) => type.name);
    for (const objectType of Object.values(CONTENT_BLOCK_OBJECT_TYPES)) {
      expect(names).toContain(objectType);
    }
  });

  it("does not name any object type after the media document, which already claims it", () => {
    // Sanity type names share one namespace; `media.ts` owns "media" for the
    // shared photograph document.
    expect(Object.values(CONTENT_BLOCK_OBJECT_TYPES)).not.toContain(MEDIA_TYPE_NAME);
    for (const type of contentBlockTypes) {
      expect(type.name).not.toBe(MEDIA_TYPE_NAME);
    }
  });

  it("keeps 'article' out of every block type's own name", () => {
    for (const type of contentBlockTypes) {
      expect(type.name.toLowerCase()).not.toContain("article");
    }
  });
});

describe("the heading block", () => {
  it("only accepts level 2 or 3", async () => {
    const { required, run } = inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.heading), "level").validation);

    expect(required).toBe(true);
    expect(await run(2)).toEqual([true]);
    expect(await run(3)).toEqual([true]);
    for (const rejected of [1, 4, "2", undefined]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });

  it("requires non-empty text", async () => {
    const { required, run } = inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.heading), "text").validation);

    expect(required).toBe(true);
    expect(await run("Gear")).toEqual([true]);
    expect((await run(""))[0]).toEqual(expect.any(String));
  });
});

describe("the list block", () => {
  it("requires the ordered flag and at least one item", async () => {
    const ordered = inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.list), "ordered").validation);
    expect(ordered.required).toBe(true);

    const { required, min } = inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.list), "items").validation);
    expect(required).toBe(true);
    expect(min).toBe(1);
  });

  it("rejects a blank item, matching the read-time projector's own rule", async () => {
    // Otherwise a standard Studio publish could create a list
    // `projectContentBlock` refuses at read time, failing the whole page.
    const { run } = inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.list), "items").validation);

    expect(await run(["Set aperture", "Set shutter speed"])).toEqual([true]);
    expect((await run(["Set aperture", "  "]))[0]).toEqual(expect.any(String));
    expect((await run([""]))[0]).toEqual(expect.any(String));
  });
});

describe("the YouTube block", () => {
  it("accepts an eleven-character video id and refuses a pasted URL", async () => {
    const { run } = inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.youtube), "videoId").validation);

    expect(await run("dQw4w9WgXcQ")).toEqual([true]);
    for (const rejected of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "dQw4w9WgXc",
      "",
      undefined,
    ]) {
      expect((await run(rejected))[0]).toEqual(expect.any(String));
    }
  });

  it("pins the id pattern used to check it at read time", () => {
    expect(YOUTUBE_VIDEO_ID_PATTERN.test("dQw4w9WgXcQ")).toBe(true);
  });

  it("requires an accessible title", async () => {
    const { required, run } = inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.youtube), "title").validation);

    expect(required).toBe(true);
    expect((await run(""))[0]).toEqual(expect.any(String));
  });
});

describe("the media block", () => {
  it("requires a media reference", () => {
    expect(
      inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.media), "media").validation).required,
    ).toBe(true);
    expect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.media), "media").to).toEqual([
      { type: MEDIA_TYPE_NAME },
    ]);
  });
});

describe("defineContentBodyField", () => {
  it("allows every block kind by default", () => {
    const field = defineContentBodyField({ name: "body", title: "Body" });
    expect(field.of?.map((member) => member.type).sort()).toEqual(
      Object.values(CONTENT_BLOCK_OBJECT_TYPES).sort(),
    );
  });

  it("restricts to a context-specific allowed subset", () => {
    // The gallery section introduction ADR-0003 decision 3 describes — plain
    // paragraphs and lists, no headings, media, or embeds — is exactly this
    // shape: a caller-chosen allow-list rather than a second body schema.
    const field = defineContentBodyField({
      name: "introduction",
      title: "Introduction",
      allowedTypes: ["paragraph", "list"],
    });
    expect(field.of?.map((member) => member.type)).toEqual([
      CONTENT_BLOCK_OBJECT_TYPES.paragraph,
      CONTENT_BLOCK_OBJECT_TYPES.list,
    ]);
  });
});
