import { describe, expect, it } from "vitest";

import {
  CONTENT_BLOCK_OBJECT_TYPES as SCHEMA_BLOCK_TYPES,
  YOUTUBE_VIDEO_ID_PATTERN as SCHEMA_YOUTUBE_PATTERN,
} from "../../sanity/schemas/content-block";
import {
  CONTENT_BLOCK_OBJECT_TYPES,
  projectContentBlock,
  readContentBlocks,
  SanityContentBlockError,
  YOUTUBE_VIDEO_ID_PATTERN as ADAPTER_YOUTUBE_PATTERN,
  type RawContentBlock,
} from "@/lib/sanity-content-blocks";
import type { SanityConfig } from "@/lib/sanity-config";

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
});

describe("malformed blocks", () => {
  it.each([
    ["a paragraph with no text", { _key: "k", _type: CONTENT_BLOCK_OBJECT_TYPES.paragraph }],
    ["a heading with an invalid level", { _key: "k", _type: CONTENT_BLOCK_OBJECT_TYPES.heading, level: 4, text: "x" }],
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
});
