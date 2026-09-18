import { describe, expect, it } from "vitest";

import {
  CONTENT_BLOCK_OBJECT_TYPES as SCHEMA_BLOCK_TYPES,
  YOUTUBE_VIDEO_ID_PATTERN as SCHEMA_YOUTUBE_PATTERN,
} from "../../sanity/schemas/content-block";
import { MIN_POLL_OPTIONS as SCHEMA_MIN_POLL_OPTIONS, MAX_POLL_OPTIONS as SCHEMA_MAX_POLL_OPTIONS } from "../../sanity/schemas/poll";
import {
  CONTENT_BLOCK_OBJECT_TYPES,
  MIN_POLL_OPTIONS,
  MAX_POLL_OPTIONS,
  projectContentBlock,
  readContentBlocks,
  SanityContentBlockError,
  YOUTUBE_VIDEO_ID_PATTERN as ADAPTER_YOUTUBE_PATTERN,
  type RawContentBlock,
} from "@/lib/sanity-content-blocks";
import type { SanityConfig } from "@/lib/sanity-config";
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "@/lib/content-table";

const config: SanityConfig = {
  projectId: "zp7mbokg",
  dataset: "production",
  datasetVisibility: "public",
  apiVersion: "v2026-06-24",
};

const options = { language: "fi", fallbackLanguage: "fi", config };

const mediaDocument = {
  mediaId: "coastal-landscape",
  mediaType: "image",
  publiclyRenderable: true,
  alt: [{ language: "fi", value: "Kivinen rantaviiva" }],
  caption: [],
  credit: "Placeholder credit",
  asset: {
    url: `https://cdn.sanity.io/images/${config.projectId}/${config.dataset}/abc123-1600x1067.webp`,
    path: `images/${config.projectId}/${config.dataset}/abc123-1600x1067.webp`,
    extension: "webp",
    mimeType: "image/webp",
    width: 1600,
    height: 1067,
  },
};

function rejectionOf(run: () => unknown): SanityContentBlockError {
  try {
    run();
  } catch (error) {
    if (error instanceof SanityContentBlockError) return error;
    throw error;
  }
  throw new Error("expected projection to throw");
}

describe("the domain-to-Sanity type map", () => {
  it("matches the schema's own map exactly", () => {
    expect(CONTENT_BLOCK_OBJECT_TYPES).toEqual(SCHEMA_BLOCK_TYPES);
  });

  it("pins the restated YouTube video id pattern to the schema's", () => {
    expect(ADAPTER_YOUTUBE_PATTERN.source).toBe(SCHEMA_YOUTUBE_PATTERN.source);
  });

  it("pins the restated poll option bounds to the schema's", () => {
    expect(MIN_POLL_OPTIONS).toBe(SCHEMA_MIN_POLL_OPTIONS);
    expect(MAX_POLL_OPTIONS).toBe(SCHEMA_MAX_POLL_OPTIONS);
  });
});

describe("projecting each block kind", () => {
  it("maps a paragraph and carries its stable Sanity key", () => {
    const block: RawContentBlock = {
      _key: "a1",
      _type: CONTENT_BLOCK_OBJECT_TYPES.paragraph,
      text: "An overcast morning is not a compromise on the coast.",
    };
    expect(projectContentBlock(block, 0, options)).toEqual({
      type: "paragraph",
      text: "An overcast morning is not a compromise on the coast.",
      key: "a1",
    });
  });

  it("maps a heading", () => {
    const block: RawContentBlock = {
      _key: "a2",
      _type: CONTENT_BLOCK_OBJECT_TYPES.heading,
      level: 2,
      text: "Waiting for the cloud to even out",
    };
    expect(projectContentBlock(block, 0, options)).toEqual({
      type: "heading",
      level: 2,
      text: "Waiting for the cloud to even out",
      key: "a2",
    });
  });

  it("maps a level-4 heading", () => {
    const block: RawContentBlock = {
      _key: "a2b",
      _type: CONTENT_BLOCK_OBJECT_TYPES.heading,
      level: 4,
      text: "Reading the KP index",
    };
    expect(projectContentBlock(block, 0, options)).toEqual({
      type: "heading",
      level: 4,
      text: "Reading the KP index",
      key: "a2b",
    });
  });

  it("maps a list", () => {
    const block: RawContentBlock = {
      _key: "a3",
      _type: CONTENT_BLOCK_OBJECT_TYPES.list,
      ordered: true,
      items: ["Set aperture", "Set shutter speed"],
    };
    expect(projectContentBlock(block, 0, options)).toEqual({
      type: "list",
      ordered: true,
      items: ["Set aperture", "Set shutter speed"],
      key: "a3",
    });
  });

  it("maps a quote with and without an attribution", () => {
    expect(
      projectContentBlock(
        {
          _key: "a4",
          _type: CONTENT_BLOCK_OBJECT_TYPES.blockquote,
          text: "Bad light is mostly light you have not worked out what to do with yet.",
        },
        0,
        options,
      ),
    ).toEqual({
      type: "blockquote",
      text: "Bad light is mostly light you have not worked out what to do with yet.",
      key: "a4",
    });

    expect(
      projectContentBlock(
        {
          _key: "a5",
          _type: CONTENT_BLOCK_OBJECT_TYPES.blockquote,
          text: "Expose to the right.",
          attribution: "Common digital photography guideline",
        },
        0,
        options,
      ),
    ).toEqual({
      type: "blockquote",
      text: "Expose to the right.",
      attribution: "Common digital photography guideline",
      key: "a5",
    });
  });

  it("maps a media placement through the shared public media boundary", () => {
    const block: RawContentBlock = {
      _key: "a6",
      _type: CONTENT_BLOCK_OBJECT_TYPES.media,
      media: mediaDocument,
    };
    const projected = projectContentBlock(block, 0, options);
    expect(projected).toEqual({
      type: "media",
      media: expect.objectContaining({ mediaId: "coastal-landscape" }),
      key: "a6",
    });
  });

  it("maps a click-to-load YouTube block", () => {
    const block: RawContentBlock = {
      _key: "a7",
      _type: CONTENT_BLOCK_OBJECT_TYPES.youtube,
      videoId: "dQw4w9WgXcQ",
      title: "Telephoto lens field test",
    };
    expect(projectContentBlock(block, 0, options)).toEqual({
      type: "youtube",
      videoId: "dQw4w9WgXcQ",
      title: "Telephoto lens field test",
      key: "a7",
    });
  });

  it("maps a poll block from its dereferenced poll", () => {
    const block: RawContentBlock = {
      _key: "a8",
      _type: CONTENT_BLOCK_OBJECT_TYPES.poll,
      poll: {
        pollId: "camera-preference",
        question: "Which do you prefer?",
        closeDate: "2099-01-01T00:00:00.000Z",
        options: [
          { optionId: "mirrorless", label: "Mirrorless" },
          { optionId: "dslr", label: "DSLR" },
        ],
      },
    };
    expect(projectContentBlock(block, 0, options)).toEqual({
      type: "poll",
      pollId: "camera-preference",
      question: "Which do you prefer?",
      closeDate: "2099-01-01T00:00:00.000Z",
      options: [
        { optionId: "mirrorless", label: "Mirrorless" },
        { optionId: "dslr", label: "DSLR" },
      ],
      key: "a8",
    });
  });
});

describe("a poll block's rejections", () => {
  const poll = (fields: Record<string, unknown> | null) =>
    ({
      _key: "k",
      _type: CONTENT_BLOCK_OBJECT_TYPES.poll,
      poll:
        fields === null
          ? null
          : {
              pollId: "camera-preference",
              question: "Which do you prefer?",
              closeDate: "2099-01-01T00:00:00.000Z",
              options: [
                { optionId: "mirrorless", label: "Mirrorless" },
                { optionId: "dslr", label: "DSLR" },
              ],
              ...fields,
            },
    }) as RawContentBlock;

  it("rejects an unresolved poll reference", () => {
    expect(rejectionOf(() => projectContentBlock(poll(null), 0, options)).rejection).toBe("malformed-block");
  });

  it("rejects a missing pollId", () => {
    expect(rejectionOf(() => projectContentBlock(poll({ pollId: null }), 0, options)).rejection).toBe("malformed-block");
  });

  it("rejects a missing question", () => {
    expect(rejectionOf(() => projectContentBlock(poll({ question: null }), 0, options)).rejection).toBe("malformed-block");
  });

  it("rejects a missing or unparseable closeDate", () => {
    expect(rejectionOf(() => projectContentBlock(poll({ closeDate: null }), 0, options)).rejection).toBe("malformed-block");
    expect(rejectionOf(() => projectContentBlock(poll({ closeDate: "not-a-date" }), 0, options)).rejection).toBe("malformed-block");
  });

  it("rejects fewer than the minimum number of options", () => {
    expect(rejectionOf(() => projectContentBlock(poll({ options: [{ optionId: "only-one", label: "Only" }] }), 0, options)).rejection).toBe(
      "malformed-block",
    );
  });

  it("rejects more than the maximum number of options", () => {
    const tooMany = Array.from({ length: MAX_POLL_OPTIONS + 1 }, (_, i) => ({ optionId: `option-${i}`, label: `Option ${i}` }));
    expect(rejectionOf(() => projectContentBlock(poll({ options: tooMany }), 0, options)).rejection).toBe("malformed-block");
  });

  it("accepts exactly the minimum and maximum option counts", () => {
    const min = Array.from({ length: MIN_POLL_OPTIONS }, (_, i) => ({ optionId: `option-${i}`, label: `Option ${i}` }));
    const max = Array.from({ length: MAX_POLL_OPTIONS }, (_, i) => ({ optionId: `option-${i}`, label: `Option ${i}` }));
    expect(() => projectContentBlock(poll({ options: min }), 0, options)).not.toThrow();
    expect(() => projectContentBlock(poll({ options: max }), 0, options)).not.toThrow();
  });

  it("rejects an option missing its optionId or label", () => {
    expect(
      rejectionOf(() =>
        projectContentBlock(poll({ options: [{ optionId: null, label: "Mirrorless" }, { optionId: "dslr", label: "DSLR" }] }), 0, options),
      ).rejection,
    ).toBe("malformed-block");
    expect(
      rejectionOf(() =>
        projectContentBlock(poll({ options: [{ optionId: "mirrorless", label: null }, { optionId: "dslr", label: "DSLR" }] }), 0, options),
      ).rejection,
    ).toBe("malformed-block");
  });
});

describe("a table block", () => {
  const table = (fields: Record<string, unknown>) =>
    ({
      _key: "k",
      _type: CONTENT_BLOCK_OBJECT_TYPES.table,
      headers: ["Lens", "Weight"],
      rows: [{ cells: ["Model A", "1480 g"] }],
      ...fields,
    }) as RawContentBlock;

  it("projects headers, rows, and an authored caption", () => {
    expect(
      projectContentBlock(table({ caption: "Specifications" }), 0, options),
    ).toEqual({
      type: "table",
      headers: ["Lens", "Weight"],
      rows: [["Model A", "1480 g"]],
      caption: "Specifications",
      key: "k",
    });
  });

  it("omits an absent caption rather than carrying an empty one", () => {
    const block = projectContentBlock(table({}), 0, options);
    expect(block).not.toHaveProperty("caption");
    // The flat projection returns null for a field this _type does not set,
    // so an explicit null has to read as "no caption", not as a defect.
    expect(projectContentBlock(table({ caption: null }), 0, options)).toEqual(
      block,
    );
  });

  it("keeps an empty cell, which is authored content rather than a defect", () => {
    const block = projectContentBlock(
      table({ rows: [{ cells: ["Model C", ""] }] }),
      0,
      options,
    );
    expect(block).toMatchObject({ rows: [["Model C", ""]] });
  });

  it("accepts a row whose cells are all empty", () => {
    expect(
      projectContentBlock(table({ rows: [{ cells: ["", ""] }] }), 0, options),
    ).toMatchObject({ rows: [["", ""]] });
  });

  it("accepts both ends of the column and row bounds", () => {
    const widest = Array.from({ length: MAX_TABLE_COLUMNS }, (_, i) => `H${i}`);
    expect(
      projectContentBlock(
        table({ headers: widest, rows: [{ cells: widest.map(() => "x") }] }),
        0,
        options,
      ),
    ).toMatchObject({ headers: widest });

    const tallest = Array.from({ length: MAX_TABLE_ROWS }, (_, i) => ({
      cells: [`row ${i}`, "x"],
    }));
    expect(
      projectContentBlock(table({ rows: tallest }), 0, options),
    ).toMatchObject({ rows: tallest.map((row) => row.cells) });

    // One column, one row: the narrowest table the bounds allow.
    expect(
      projectContentBlock(
        table({ headers: ["Only"], rows: [{ cells: ["x"] }] }),
        0,
        options,
      ),
    ).toMatchObject({ headers: ["Only"], rows: [["x"]] });
  });

  it.each([
    ["no headers at all", { headers: undefined }],
    ["an empty header list", { headers: [] }],
    ["headers that are not an array", { headers: "Lens" }],
    [
      "more headers than the column bound",
      {
        headers: Array.from({ length: MAX_TABLE_COLUMNS + 1 }, (_, i) => `H${i}`),
        rows: [
          { cells: Array.from({ length: MAX_TABLE_COLUMNS + 1 }, () => "x") },
        ],
      },
    ],
    ["a blank header", { headers: ["Lens", "  "] }],
    ["a non-string header", { headers: ["Lens", 7] }],
    ["no rows at all", { rows: undefined }],
    ["an empty row list", { rows: [] }],
    ["rows that are not an array", { rows: { cells: ["x", "y"] } }],
    [
      "more rows than the row bound",
      {
        rows: Array.from({ length: MAX_TABLE_ROWS + 1 }, () => ({
          cells: ["a", "b"],
        })),
      },
    ],
    ["a row that is not an object", { rows: [["Model A", "1480 g"]] }],
    ["a row with no cells", { rows: [{}] }],
    ["a row whose cells are not an array", { rows: [{ cells: "Model A" }] }],
    ["a short row", { rows: [{ cells: ["Model A"] }] }],
    ["a long row", { rows: [{ cells: ["Model A", "1480 g", "extra"] }] }],
    ["a non-string cell", { rows: [{ cells: ["Model A", 1480] }] }],
    ["a blank caption", { caption: "   " }],
  ])("rejects %s", (_case, fields) => {
    const error = rejectionOf(() =>
      projectContentBlock(table(fields), 3, options),
    );
    expect(error.rejection).toBe("malformed-block");
    expect(error.message).toContain("position 3");
  });
});

describe("malformed blocks", () => {
  it.each([
    ["a paragraph with no text", { _key: "k", _type: CONTENT_BLOCK_OBJECT_TYPES.paragraph }],
    ["a heading with an invalid level", { _key: "k", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 5, text: "x" }],
    ["a list with no items", { _key: "k", _type: CONTENT_BLOCK_OBJECT_TYPES.list, ordered: false, items: [] }],
    ["a quote with no text", { _key: "k", _type: CONTENT_BLOCK_OBJECT_TYPES.blockquote }],
    ["a media block with no resolved reference", { _key: "k", _type: CONTENT_BLOCK_OBJECT_TYPES.media }],
    ["a YouTube block with a full URL instead of an id", { _key: "k", _type: CONTENT_BLOCK_OBJECT_TYPES.youtube, videoId: "https://youtu.be/dQw4w9WgXcQ", title: "x" }],
    ["a block with no stable key", { _type: CONTENT_BLOCK_OBJECT_TYPES.paragraph, text: "x" }],
  ])("rejects %s", (_case, block) => {
    const error = rejectionOf(() => projectContentBlock(block as RawContentBlock, 3, options));
    expect(error.rejection).toBe("malformed-block");
    expect(error.message).toContain("position 3");
  });

  it("rejects an unrecognized block type", () => {
    const error = rejectionOf(() =>
      projectContentBlock({ _key: "k", _type: "somethingElse" }, 0, options),
    );
    expect(error.rejection).toBe("unsupported-block-type");
  });
});

describe("reading a whole body", () => {
  it("treats a missing body as an authored empty one", () => {
    expect(readContentBlocks(undefined, options)).toEqual([]);
    expect(readContentBlocks(null, options)).toEqual([]);
  });

  it("maps an ordered sequence of mixed block kinds, each with its own key", () => {
    const body: readonly RawContentBlock[] = [
      { _key: "b1", _type: CONTENT_BLOCK_OBJECT_TYPES.paragraph, text: "Intro." },
      { _key: "b2", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 2, text: "Section" },
    ];
    expect(readContentBlocks(body, options)).toEqual([
      { type: "paragraph", text: "Intro.", key: "b1" },
      { type: "heading", level: 2, text: "Section", key: "b2" },
    ]);
  });

  it("rejects a body that is not a list of block objects", () => {
    const error = rejectionOf(() => readContentBlocks("not a list", options));
    expect(error.rejection).toBe("malformed-result");
  });

  it("rejects two blocks sharing one stable key", () => {
    // Sanity's own array editor guarantees this for the ordinary Studio
    // editor; an API import does not go through it. A duplicate would hand
    // React two elements with the same list key.
    const body: readonly RawContentBlock[] = [
      { _key: "b1", _type: CONTENT_BLOCK_OBJECT_TYPES.paragraph, text: "First." },
      { _key: "b1", _type: CONTENT_BLOCK_OBJECT_TYPES.paragraph, text: "Second." },
    ];
    const error = rejectionOf(() => readContentBlocks(body, options));
    expect(error.rejection).toBe("malformed-result");
    expect(error.message).toContain("b1");
  });

  it("rejects a level-3 heading appearing before any level-2 heading (AB#106) — an API import bypasses Studio's own guard", () => {
    const body: readonly RawContentBlock[] = [
      { _key: "b1", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 3, text: "Too soon" },
    ];
    const error = rejectionOf(() => readContentBlocks(body, options));
    expect(error.rejection).toBe("non-semantic-heading-order");
  });

  it("accepts a level-2 heading followed by a level-3 heading", () => {
    const body: readonly RawContentBlock[] = [
      { _key: "b1", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 2, text: "Section" },
      { _key: "b2", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 3, text: "Subsection" },
    ];
    expect(() => readContentBlocks(body, options)).not.toThrow();
  });

  it("accepts descending one level at a time down to level 4 (AB#21)", () => {
    const body: readonly RawContentBlock[] = [
      { _key: "b1", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 2, text: "Section" },
      { _key: "b2", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 3, text: "Subsection" },
      { _key: "b3", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 4, text: "Detail" },
    ];
    expect(() => readContentBlocks(body, options)).not.toThrow();
  });

  it("rejects a level-2-to-level-4 skip (AB#21) — an API import bypasses Studio's own guard", () => {
    const body: readonly RawContentBlock[] = [
      { _key: "b1", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 2, text: "Section" },
      { _key: "b2", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 4, text: "Too deep" },
    ];
    const error = rejectionOf(() => readContentBlocks(body, options));
    expect(error.rejection).toBe("non-semantic-heading-order");
  });
});

describe("mini-gallery projection", () => {
  const entry = (key: string) => ({ _key: key, media: mediaDocument });
  const block = (images: unknown) => ({ _key: "set", _type: CONTENT_BLOCK_OBJECT_TYPES["mini-gallery"], images });

  it("preserves repeated media as distinct occurrences and projects only public fields", () => {
    const result = projectContentBlock({ ...block([
      { ...entry("first"), archiveLocator: "private-entry", media: { ...mediaDocument, archiveLocator: "private-medium" } },
      entry("second"),
    ]), title: "Details" }, 0, options);
    expect(result.type).toBe("mini-gallery");
    if (result.type !== "mini-gallery") throw new Error("wrong block");
    expect(result.items.map(i => i.key)).toEqual(["first", "second"]);
    expect(result.items[0].media.mediaId).toBe(result.items[1].media.mediaId);
    expect(JSON.stringify(result)).not.toMatch(/archiveLocator|private-entry|private-medium|asset|_key/);
  });

  it("accepts the maximum and refuses an overfull block before media projection", () => {
    expect(projectContentBlock(block(Array.from({ length: 12 }, (_, i) => entry(String(i)))), 0, options).type).toBe("mini-gallery");
    expect(rejectionOf(() => projectContentBlock(block(Array(13).fill(null)), 0, options)).rejection).toBe("malformed-block");
  });

  it.each([undefined, null, {}, [], [null], [{ _key: "x", media: null }], [entry("x"), entry("x")], [{ media: mediaDocument }]])(
    "refuses malformed lists or occurrence identities: %j", images => {
      expect(rejectionOf(() => projectContentBlock(block(images), 0, options)).rejection).toBe("malformed-block");
    },
  );

  it.each(["", " ", 42, "x".repeat(121)])("refuses malformed titles: %j", title => {
    expect(rejectionOf(() => projectContentBlock({ ...block([entry("a")]), title }, 0, options)).rejection).toBe("malformed-block");
  });

  it.each([
    { publiclyRenderable: false }, { privateOnly: true }, { mediaType: "video" }, { asset: null },
  ])("refuses media outside the public derivative boundary: %j", change => {
    expect(() => projectContentBlock(block([{ _key: "a", media: { ...mediaDocument, ...change } }]), 0, options)).toThrow();
  });
});

it("bounds reference expansion at the maximum plus one overflow witness", async () => {
  const { CONTENT_BLOCK_PROJECTION } = await import("./sanity-content-blocks");
  expect(CONTENT_BLOCK_PROJECTION).toContain('"images": images[0...13]{_key, "media": media->');
});
