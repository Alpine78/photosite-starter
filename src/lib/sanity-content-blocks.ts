/**
 * The shared rich-content body block adapter: Sanity block objects in,
 * `content-page.ts`'s `ContentBlock` union out.
 *
 * This is the read-side counterpart of `sanity/schemas/content-block.ts`.
 * Deliberately not article-owned: `sanity-article.ts` is the first caller, and
 * a later gallery adapter (AB#113) embeds `CONTENT_BLOCK_PROJECTION` in its own
 * query and calls `readContentBlocks` the same way, rather than the gallery
 * adapter re-deriving block parsing.
 *
 * `CONTENT_BLOCK_OBJECT_TYPES` restates the schema's domain-discriminant → Sanity
 * object-type-name map rather than importing it: these schemas are exported to
 * a Studio that does not have this repository's application code on its import
 * path (ADR-0006), so the two sides are pinned equal by a test instead.
 *
 * A media block reuses `projectPublicMedia` unchanged, so a photograph placed in
 * a body is validated by exactly the boundary ADR-0005 §5 established for every
 * other public rendition — this module adds no second check and no second
 * failure mode for the same asset.
 */

import "server-only";

import type { ContentBlock } from "@/lib/content-page";
import type { SanityConfig } from "@/lib/sanity-config";
import {
  projectPublicMedia,
  PUBLIC_MEDIA_PROJECTION,
  type RawPublicMediaDocument,
} from "@/lib/sanity-media";
import { isRecord, readString } from "@/lib/sanity-values";

/**
 * Restated from `sanity/schemas/content-block.ts`'s map of the same name.
 * `sanity-content-blocks.test.ts` pins the two copies equal.
 */
export const CONTENT_BLOCK_OBJECT_TYPES = {
  paragraph: "contentParagraphBlock",
  heading: "contentHeadingBlock",
  list: "contentListBlock",
  blockquote: "contentQuoteBlock",
  media: "contentMediaBlock",
  youtube: "contentYoutubeBlock",
} as const;

/** Restated from the schema's `YOUTUBE_VIDEO_ID_PATTERN`; pinned by the test. */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/**
 * One flat projection over every block kind. GROQ tolerates asking for a field
 * a given `_type` does not declare — it simply comes back `null` — so one
 * projection covers all six kinds instead of a per-type union query. Embedded
 * by any adapter whose body field uses `defineContentBodyField`.
 */
export const CONTENT_BLOCK_PROJECTION = `{
  _type,
  text,
  level,
  ordered,
  items,
  attribution,
  videoId,
  title,
  "media": media->${PUBLIC_MEDIA_PROJECTION}
}`;

/** Why a body could not become a validated `ContentBlock[]`. */
export type SanityContentBlockRejection =
  /** A block's own required fields are missing or malformed. */
  | "malformed-block"
  /** A block's `_type` names none of the six shared kinds. */
  | "unsupported-block-type"
  /** The body did not evaluate to a list of block objects. */
  | "malformed-result";

export class SanityContentBlockError extends Error {
  readonly rejection: SanityContentBlockRejection;

  constructor(rejection: SanityContentBlockRejection, detail: string) {
    super(`[sanity-content-blocks] ${detail}`);
    this.name = "SanityContentBlockError";
    this.rejection = rejection;
  }
}

/**
 * One block as `CONTENT_BLOCK_PROJECTION` returns it. Every field is
 * `unknown`, and only the ones its `_type` actually declares are ever
 * populated — the rest arrive as `null` from the flat projection above.
 */
export type RawContentBlock = {
  readonly _type?: unknown;
  readonly text?: unknown;
  readonly level?: unknown;
  readonly ordered?: unknown;
  readonly items?: unknown;
  readonly attribution?: unknown;
  readonly videoId?: unknown;
  readonly title?: unknown;
  readonly media?: unknown;
};

export type ContentBlockProjectionOptions = {
  readonly language: string;
  readonly fallbackLanguage: string;
  readonly config: SanityConfig;
};

/**
 * Projects one block. Pure and exported so a fixture test can exercise every
 * kind, including a malformed one, without a network — the same shape
 * `sanity-media.ts#projectPublicMedia` takes.
 */
export function projectContentBlock(
  raw: RawContentBlock,
  index: number,
  options: ContentBlockProjectionOptions,
): ContentBlock {
  const reject: (detail: string) => never = (detail) => {
    throw new SanityContentBlockError(
      "malformed-block",
      `body block at position ${index}: ${detail}`,
    );
  };

  switch (raw._type) {
    case CONTENT_BLOCK_OBJECT_TYPES.paragraph: {
      const text = readString(raw.text);
      if (text === undefined) reject("a paragraph needs non-empty text");
      return { type: "paragraph", text };
    }

    case CONTENT_BLOCK_OBJECT_TYPES.heading: {
      const text = readString(raw.text);
      if (text === undefined) reject("a heading needs non-empty text");
      if (raw.level !== 2 && raw.level !== 3) {
        reject("a heading needs level 2 or 3");
      }
      return { type: "heading", level: raw.level, text };
    }

    case CONTENT_BLOCK_OBJECT_TYPES.list: {
      if (typeof raw.ordered !== "boolean") {
        reject("a list needs its ordered flag");
      }
      if (
        !Array.isArray(raw.items) ||
        raw.items.length === 0 ||
        !raw.items.every(
          (item) => typeof item === "string" && item.trim().length > 0,
        )
      ) {
        reject("a list needs at least one non-empty item");
      }
      return { type: "list", ordered: raw.ordered, items: raw.items };
    }

    case CONTENT_BLOCK_OBJECT_TYPES.blockquote: {
      const text = readString(raw.text);
      if (text === undefined) reject("a quote needs non-empty text");
      const attribution = readString(raw.attribution);
      return {
        type: "blockquote",
        text,
        ...(attribution === undefined ? {} : { attribution }),
      };
    }

    case CONTENT_BLOCK_OBJECT_TYPES.media: {
      if (!isRecord(raw.media)) {
        reject("a media block has no resolved media reference");
      }
      const media = projectPublicMedia(
        raw.media as RawPublicMediaDocument,
        options,
      );
      return { type: "media", media };
    }

    case CONTENT_BLOCK_OBJECT_TYPES.youtube: {
      const videoId = readString(raw.videoId);
      const title = readString(raw.title);
      if (videoId === undefined || !YOUTUBE_VIDEO_ID_PATTERN.test(videoId)) {
        reject("a YouTube block needs a valid eleven-character video id");
      }
      if (title === undefined) {
        reject("a YouTube block needs an accessible title");
      }
      return { type: "youtube", videoId, title };
    }

    default:
      throw new SanityContentBlockError(
        "unsupported-block-type",
        `body block at position ${index} has an unrecognized type "${String(raw._type)}"`,
      );
  }
}

/**
 * Projects a whole body. A missing or `null` body is an authored empty body —
 * ADR-0003 decision 3 lets a gallery consist of only its lead and grid — while
 * anything present that is not a list of block objects is a broken query
 * contract, not an empty one.
 */
export function readContentBlocks(
  value: unknown,
  options: ContentBlockProjectionOptions,
): readonly ContentBlock[] {
  if (value === undefined || value === null) return [];

  if (!Array.isArray(value) || !value.every(isRecord)) {
    throw new SanityContentBlockError(
      "malformed-result",
      "a body did not evaluate to a list of block objects",
    );
  }

  return value.map((raw, index) =>
    projectContentBlock(raw as RawContentBlock, index, options),
  );
}
