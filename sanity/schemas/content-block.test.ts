import { describe, expect, it } from "vitest";

import { inspectValidationRules } from "./validation-test-helper";
import {
  CONTENT_BLOCK_KINDS,
  CONTENT_BLOCK_OBJECT_TYPES,
  contentBlockTypes,
  defineContentBodyField,
  YOUTUBE_VIDEO_ID_PATTERN,
} from "./content-block";
import { defineSchemaTypes } from "./index";
import { MEDIA_TYPE_NAME } from "./media";
import { POLL_TYPE_NAME } from "./poll";
import { assertSemanticHeadingOrder, type ContentBlock } from "../../src/lib/content-page";
import type {
  SchemaTypeDefinition,
  SchemaValidation,
  SchemaValidationClient,
} from "./schema-types";

/**
 * Dataset answers remain local; the rule builder follows shared Sanity semantics.
 */

function inspect(validation: SchemaValidation | undefined) {
  const { required, min, checks } = inspectValidationRules(validation);

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

/**
 * Runs every custom check a rule registered and collapses the answers to the
 * first refusal, or `true` when all of them passed. `min`/`max`/`required` are
 * recorded by the builder rather than run as callbacks, so they are asserted
 * separately from this — see the table's own bounds test.
 */
async function runChecks(
  checks: readonly ((
    value: never,
    context: { getClient: () => SchemaValidationClient },
  ) => unknown)[],
  value: unknown,
) {
  const client: SchemaValidationClient = {
    async fetch() {
      return undefined as never;
    },
    withConfig() {
      return client;
    },
  };
  for (const check of checks) {
    const result = await check(value as never, { getClient: () => client });
    if (result !== true) return result;
  }
  return true;
}

/** The inline object type each `rows` array member uses. */
function rowObject(): SchemaTypeDefinition {
  const member = fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.table), "rows").of?.[0];
  if (member?.fields === undefined) throw new Error("the rows array declares no object member");
  return { name: "tableRow", title: "Row", type: "object", fields: member.fields };
}

describe("the shared block types", () => {
  it("names every ADR-0003 decision 2 block kind, plus ADR-0018's poll", () => {
    expect(CONTENT_BLOCK_KINDS).toEqual([
      "paragraph",
      "heading",
      "list",
      "blockquote",
      "media",
      "youtube",
      "mini-gallery",
      "table",
      "poll",
      "image-comparison",
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
  it("only accepts level 2, 3, or 4", async () => {
    const { required, run } = inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.heading), "level").validation);

    expect(required).toBe(true);
    expect(await run(2)).toEqual([true]);
    expect(await run(3)).toEqual([true]);
    expect(await run(4)).toEqual([true]);
    for (const rejected of [1, 5, "2", undefined]) {
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

describe("the poll block", () => {
  it("requires a poll reference", () => {
    expect(
      inspect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.poll), "poll").validation).required,
    ).toBe(true);
    expect(fieldOf(typeOf(CONTENT_BLOCK_OBJECT_TYPES.poll), "poll").to).toEqual([
      { type: POLL_TYPE_NAME },
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

  describe("semantic heading order (AB#106, generalized to levels 2-4 by AB#21)", () => {
    const heading = (level: 2 | 3 | 4) => ({
      _type: CONTENT_BLOCK_OBJECT_TYPES.heading,
      level,
    });
    const paragraph = () => ({ _type: CONTENT_BLOCK_OBJECT_TYPES.paragraph });

    it("accepts an empty or heading-free body", async () => {
      const { run } = inspect(defineContentBodyField({ name: "body", title: "Body" }).validation);
      expect(await run(undefined)).toEqual([true]);
      expect(await run([paragraph()])).toEqual([true]);
    });

    it("accepts a level-2 heading followed by a level-3 heading", async () => {
      const { run } = inspect(defineContentBodyField({ name: "body", title: "Body" }).validation);
      expect(await run([heading(2), heading(3)])).toEqual([true]);
    });

    it("rejects a level-3 heading as the body's first heading, matching the read-time adapter's own refusal", async () => {
      const { run } = inspect(defineContentBodyField({ name: "body", title: "Body" }).validation);
      const [result] = await run([heading(3)]);
      expect(result).toEqual(expect.any(String));
    });

    it("does not misreport a heading an editor has not yet assigned a level to", async () => {
      // A newly added heading block has `level === undefined` until the
      // editor picks one — the field's own `required()` rule already
      // reports that. This check must not additionally claim "the body's
      // first heading must be level 2" for a block that has no level at all
      // yet.
      const { run } = inspect(defineContentBodyField({ name: "body", title: "Body" }).validation);
      const unleveled = { _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: undefined };
      expect(await run([unleveled])).toEqual([true]);
    });

    it("does not let an unleveled heading reset what a skip would be", async () => {
      // An editor mid-way through adding a heading must not accidentally
      // make a real violation disappear: level 2, an unleveled block, then
      // level 4 is still a skip from level 2.
      const { run } = inspect(defineContentBodyField({ name: "body", title: "Body" }).validation);
      const unleveled = { _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: undefined };
      const [result] = await run([heading(2), unleveled, heading(4)]);
      expect(result).toEqual(expect.any(String));
    });

    it("accepts descending one level at a time down to level 4", async () => {
      const { run } = inspect(defineContentBodyField({ name: "body", title: "Body" }).validation);
      expect(await run([heading(2), heading(3), heading(4)])).toEqual([true]);
    });

    it("rejects skipping from level 2 straight to level 4", async () => {
      const { run } = inspect(defineContentBodyField({ name: "body", title: "Body" }).validation);
      const [result] = await run([heading(2), heading(4)]);
      expect(result).toEqual(expect.any(String));
    });

    it("still applies when the caller supplies its own extra validation", async () => {
      // article.ts's body field adds .required().min(1) on top of this
      // check — a caller must not be able to opt out of the structural
      // invariant just by supplying its own rules.
      const field = defineContentBodyField({
        name: "body",
        title: "Body",
        validation: (rule) => rule.required().min(1),
      });
      const { required, min, run } = inspect(field.validation);
      expect(required).toBe(true);
      expect(min).toBe(1);
      const [result] = await run([heading(3)]);
      expect(result).toEqual(expect.any(String));
    });

    describe("stays pinned to content-page.ts#assertSemanticHeadingOrder", () => {
      // Both sides claim to enforce "the same rule" (ADR-0006: a schema
      // cannot import `src/`, so the two are separate implementations), but
      // nothing before this ran them against a shared set of inputs to
      // check that claim. Each case's heading levels are projected into
      // both a raw Studio-shaped list and a `ContentBlock[]`, so a verdict
      // mismatch here means the Studio guard and the read-time adapter
      // would disagree about the same authored content.
      const cases: ReadonlyArray<{
        readonly name: string;
        readonly levels: readonly (2 | 3 | 4)[];
      }> = [
        { name: "no headings", levels: [] },
        { name: "a single level-2 heading", levels: [2] },
        { name: "level 2 then level 3", levels: [2, 3] },
        { name: "level 2, level 3, level 3", levels: [2, 3, 3] },
        { name: "level 3 first", levels: [3] },
        { name: "level 3 first, level 2 later", levels: [3, 2] },
        { name: "level 2, level 3, level 2, level 3", levels: [2, 3, 2, 3] },
        { name: "level 4 first", levels: [4] },
        { name: "level 2, level 3, level 4", levels: [2, 3, 4] },
        { name: "level 2, level 4 (a skip)", levels: [2, 4] },
        {
          name: "level 2, level 3, level 4, level 2, level 3, level 4",
          levels: [2, 3, 4, 2, 3, 4],
        },
        {
          name: "level 2, level 3, level 4, level 2, level 4 (a skip after returning shallower)",
          levels: [2, 3, 4, 2, 4],
        },
      ];

      it.each(cases)("$name", async ({ levels }) => {
        const rawHeadings = levels.map((level) => ({
          _type: CONTENT_BLOCK_OBJECT_TYPES.heading,
          level,
        }));
        const { run } = inspect(defineContentBodyField({ name: "body", title: "Body" }).validation);
        const [schemaResult] = await run(rawHeadings);

        const blocks: readonly ContentBlock[] = levels.map((level, index) => ({
          type: "heading",
          level,
          text: `Heading ${index}`,
        }));
        let runtimeRejected = false;
        try {
          assertSemanticHeadingOrder(blocks);
        } catch {
          runtimeRejected = true;
        }

        expect(schemaResult !== true).toBe(runtimeRejected);
      });
    });
  });
});

describe("the data table block (AB#22)", () => {
  const block = () => typeOf(CONTENT_BLOCK_OBJECT_TYPES.table);

  it("pins its bounds to the ones the public reader enforces", async () => {
    const { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } = await import(
      "../../src/lib/content-table"
    );
    const schema = await import("./content-block");
    expect(schema.MAX_TABLE_COLUMNS).toBe(MAX_TABLE_COLUMNS);
    expect(schema.MAX_TABLE_ROWS).toBe(MAX_TABLE_ROWS);
  });

  it("bounds headers and rows with blocking Studio validation", async () => {
    const { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } = await import(
      "../../src/lib/content-table"
    );
    // `min`/`max`/`required` are recorded by the rule builder rather than run
    // as callbacks, so they have to be asserted here: executing the custom
    // checks below would never exercise them.
    const headers = inspectValidationRules(
      fieldOf(block(), "headers").validation,
    );
    expect(headers.required).toBe(true);
    expect(headers.min).toBe(1);
    expect(headers.max).toBe(MAX_TABLE_COLUMNS);
    expect(headers.warnings).toHaveLength(0);

    const rows = inspectValidationRules(fieldOf(block(), "rows").validation);
    expect(rows.required).toBe(true);
    expect(rows.min).toBe(1);
    expect(rows.max).toBe(MAX_TABLE_ROWS);
    expect(rows.warnings).toHaveLength(0);

    const cells = inspectValidationRules(
      fieldOf(rowObject(), "cells").validation,
    );
    expect(cells.required).toBe(true);
    expect(cells.min).toBe(1);
    expect(cells.max).toBe(MAX_TABLE_COLUMNS);
  });

  it("rejects a blank column header", async () => {
    const { checks } = inspectValidationRules(
      fieldOf(block(), "headers").validation,
    );
    expect(await runChecks(checks, ["Lens", "Weight"])).toBe(true);
    expect(await runChecks(checks, ["Lens", "  "])).not.toBe(true);
  });

  it("leaves the caption optional but rejects a blank one", async () => {
    const { required, checks } = inspectValidationRules(
      fieldOf(block(), "caption").validation,
    );
    expect(required).toBe(false);
    expect(await runChecks(checks, undefined)).toBe(true);
    expect(await runChecks(checks, "Specifications")).toBe(true);
    expect(await runChecks(checks, "   ")).not.toBe(true);
  });

  describe("the object's own rectangularity rule", () => {
    const run = (value: unknown) =>
      runChecks(inspectValidationRules(block().validation).checks, value);

    it("accepts a rectangular table, including all-empty cells", async () => {
      expect(
        await run({ headers: ["A", "B"], rows: [{ cells: ["1", "2"] }] }),
      ).toBe(true);
      expect(
        await run({ headers: ["A", "B"], rows: [{ cells: ["", ""] }] }),
      ).toBe(true);
    });

    it("rejects a row that is short or long, naming the row", async () => {
      const short = await run({
        headers: ["A", "B"],
        rows: [{ cells: ["1", "2"] }, { cells: ["1"] }],
      });
      expect(short).not.toBe(true);
      expect(String(short)).toContain("Row 2");
      expect(
        await run({ headers: ["A", "B"], rows: [{ cells: ["1", "2", "3"] }] }),
      ).not.toBe(true);
    });

    it("stays silent on states the field rules already report", async () => {
      // Mid-edit: an editor who has added a header but not yet a row should
      // see that field's own `required` message, not a width complaint — and
      // the rule must not throw on any of these shapes.
      expect(await run(undefined)).toBe(true);
      expect(await run({})).toBe(true);
      expect(await run({ headers: [], rows: [{ cells: ["1"] }] })).toBe(true);
      expect(await run({ headers: ["A"], rows: undefined })).toBe(true);
      expect(await run({ headers: ["A"], rows: [undefined] })).toBe(true);
      expect(await run({ headers: ["A"], rows: [{}] })).toBe(true);
      expect(await run({ headers: "A", rows: [{ cells: ["1"] }] })).toBe(true);
    });
  });
});

it("bounds the mini-gallery's image array with blocking Studio validation", async () => {
  const { MAX_MINI_GALLERY_ITEMS, MAX_MINI_GALLERY_TITLE_LENGTH } = await import("../../src/lib/content-mini-gallery");
  const schema = await import("./content-block");
  expect(schema.MAX_MINI_GALLERY_ITEMS).toBe(MAX_MINI_GALLERY_ITEMS);
  expect(schema.MAX_MINI_GALLERY_TITLE_LENGTH).toBe(MAX_MINI_GALLERY_TITLE_LENGTH);
  const block = typeOf(CONTENT_BLOCK_OBJECT_TYPES["mini-gallery"]);
  const validation = inspectValidationRules(fieldOf(block, "images").validation);
  expect(validation.required).toBe(true);
  expect(validation.min).toBe(1);
  expect(validation.max).toBe(MAX_MINI_GALLERY_ITEMS);
  expect(validation.warnings).toHaveLength(0);
  expect(inspectValidationRules(fieldOf(block, "title").validation).max).toBe(MAX_MINI_GALLERY_TITLE_LENGTH);
});

it("requires comparison image references and bounded nonblank side labels in Studio", async () => {
  const block = typeOf(CONTENT_BLOCK_OBJECT_TYPES["image-comparison"]);
  for (const name of ["first", "second"]) {
    const field = fieldOf(block, name);
    expect(inspect(field.validation).required).toBe(true);
    expect(field.to).toEqual([{ type: "media" }]);
  }
  for (const name of ["firstLabel", "secondLabel"]) {
    const validation = inspectValidationRules(fieldOf(block, name).validation);
    expect(validation.required).toBe(true);
    expect(validation.max).toBe(200);
  }
  expect(inspectValidationRules(fieldOf(block, "title").validation).max).toBe(120);
});
