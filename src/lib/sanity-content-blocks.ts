import { isPollDefinition } from "@/lib/poll";
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
import {
  MAX_COMPARISON_LABEL_LENGTH,
  MAX_COMPARISON_TITLE_LENGTH,
  isComparisonText,
} from "@/lib/content-image-comparison";
import {
  MAX_MINI_GALLERY_ITEMS,
  MAX_MINI_GALLERY_TITLE_LENGTH,
} from "@/lib/content-mini-gallery";
import { MAX_TABLE_COLUMNS, MAX_TABLE_ROWS } from "@/lib/content-table";
import { MIN_TAB_GROUP_TABS, MAX_TAB_GROUP_TABS, MAX_TAB_LABEL_LENGTH } from "@/lib/content-tab-group";

import { assertSemanticHeadingOrder, type ContentBlock } from "@/lib/content-page";
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
  "mini-gallery": "contentGalleryBlock",
  table: "contentTableBlock",
  poll: "contentPollBlock",
  "image-comparison": "contentImageComparisonBlock",
  "tab-group": "contentTabGroupBlock",
} as const;

/** Restated from the schema's `YOUTUBE_VIDEO_ID_PATTERN`; pinned by the test. */
export const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

/** Restated from `sanity/schemas/poll.ts`'s bounds of the same names; pinned by the test. */
export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;

/**
 * One flat projection over every block kind. GROQ tolerates asking for a field
 * a given `_type` does not declare — it simply comes back `null` — so one
 * projection covers the shared kinds instead of a per-type union query. Embedded
 * by any adapter whose body field uses `defineContentBodyField`.
 *
 * The bounded slices ask for one more than the maximum on purpose: an oversized
 * array has to arrive oversized for the projector below to reject it, rather
 * than arriving silently truncated to exactly the limit and passing.
 */
export const CONTENT_BLOCK_PROJECTION = `{
  _key,
  _type,
  text,
  level,
  ordered,
  items,
  attribution,
  videoId,
  title,
  caption,
  "headers": headers[0...${MAX_TABLE_COLUMNS + 1}],
  "rows": rows[0...${MAX_TABLE_ROWS + 1}]{"cells": cells[0...${MAX_TABLE_COLUMNS + 1}]},
  firstLabel,
  secondLabel,
  "first": first->${PUBLIC_MEDIA_PROJECTION},
  "second": second->${PUBLIC_MEDIA_PROJECTION},
  "media": media->${PUBLIC_MEDIA_PROJECTION},
  "images": images[0...${MAX_MINI_GALLERY_ITEMS + 1}]{_key, "media": media->${PUBLIC_MEDIA_PROJECTION}},
  "poll": poll->{pollId, question, closeDate, "options": options[0...${MAX_POLL_OPTIONS + 1}]{optionId, label}},
  "tabs": tabs[0...${MAX_TAB_GROUP_TABS + 1}]{
    _key,
    label,
    "table": table{
      caption,
      "headers": headers[0...${MAX_TABLE_COLUMNS + 1}],
      "rows": rows[0...${MAX_TABLE_ROWS + 1}]{"cells": cells[0...${MAX_TABLE_COLUMNS + 1}]}
    }
  }
}`;

/** Why a body could not become a validated `ContentBlock[]`. */
export type SanityContentBlockRejection =
  /** A block's own required fields are missing or malformed. */
  | "malformed-block"
  /** A block's `_type` names none of the shared kinds. */
  | "unsupported-block-type"
  /** The body did not evaluate to a list of block objects. */
  | "malformed-result"
  /** A heading skips a level, or the body's first heading isn't level 2 (AB#106, AB#21). */
  | "non-semantic-heading-order";

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
  readonly _key?: unknown;
  readonly _type?: unknown;
  readonly text?: unknown;
  readonly level?: unknown;
  readonly ordered?: unknown;
  readonly items?: unknown;
  readonly attribution?: unknown;
  readonly videoId?: unknown;
  readonly title?: unknown;
  readonly caption?: unknown;
  readonly headers?: unknown;
  readonly rows?: unknown;
  readonly media?: unknown;
  readonly images?: unknown;
  readonly poll?: unknown;
  readonly first?: unknown;
  readonly second?: unknown;
  readonly firstLabel?: unknown;
  readonly secondLabel?: unknown;
  readonly tabs?: unknown;
};

export type ContentBlockProjectionOptions = {
  readonly language: string;
  readonly fallbackLanguage: string;
  readonly config: SanityConfig;
};

type RawTableFields = {
  readonly headers?: unknown;
  readonly rows?: unknown;
  readonly caption?: unknown;
};

/**
 * The table block's own field validation, factored out so a tab-group's
 * per-tab table (AB#163) shares it exactly rather than restating it: the two
 * can never drift on what counts as a valid table. `reject` is the caller's
 * own bound rejection, so a tab's table failure still names the whole body
 * block's position, not a table-shaped position of its own.
 */
function projectTableFields(
  raw: RawTableFields,
  reject: (detail: string) => never,
): { readonly headers: readonly string[]; readonly rows: readonly (readonly string[])[]; readonly caption?: string } {
  // Headers first: their count is the contract every row is measured
  // against, so nothing below can be checked until it is known good.
  if (
    !Array.isArray(raw.headers) ||
    raw.headers.length === 0 ||
    raw.headers.length > MAX_TABLE_COLUMNS
  ) {
    reject(`a table needs between 1 and ${MAX_TABLE_COLUMNS} column headers`);
  }
  const headers = raw.headers.map((header) => {
    const text = readString(header);
    if (text === undefined) reject("a table column header cannot be empty");
    return text;
  });

  if (
    !Array.isArray(raw.rows) ||
    raw.rows.length === 0 ||
    raw.rows.length > MAX_TABLE_ROWS
  ) {
    reject(`a table needs between 1 and ${MAX_TABLE_ROWS} rows`);
  }
  const rows = raw.rows.map((row) => {
    if (!isRecord(row) || !Array.isArray(row.cells)) {
      reject("a table row needs its cells");
    }
    if (row.cells.length !== headers.length) {
      reject(
        `a table row has ${row.cells.length} cell(s) but the table has ${headers.length} column(s)`,
      );
    }
    // Deliberately a bare string check rather than `readString`: that
    // helper trims and reports an empty string as absent, which is exactly
    // what a legitimately blank cell looks like. A gap in a comparison
    // table is content, not a defect.
    if (!row.cells.every((cell) => typeof cell === "string")) {
      reject("a table cell must be text");
    }
    return row.cells as readonly string[];
  });

  const caption = readString(raw.caption);
  if (raw.caption != null && caption === undefined) {
    reject("a table caption must be non-empty when present");
  }

  return { headers, rows, ...(caption === undefined ? {} : { caption }) };
}

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

  // Sanity assigns every array item a `_key` on save, and it is what makes a
  // block's identity survive a reorder or an edit rather than degrading to
  // its position in the array (`content-body.tsx` prefers it over index for
  // exactly that reason). Its absence means the query dropped the field, not
  // that the block has no identity, so this is a defect worth failing loudly
  // on rather than silently falling back to a position-derived one.
  const key = readString(raw._key);
  if (key === undefined) reject("a block needs its stable _key");

  switch (raw._type) {
    case CONTENT_BLOCK_OBJECT_TYPES["image-comparison"]: {
      if (!isRecord(raw.first) || !isRecord(raw.second)) {
        reject("a comparison needs two resolved public images");
      }
      const first = projectPublicMedia(raw.first as RawPublicMediaDocument, options);
      const second = projectPublicMedia(raw.second as RawPublicMediaDocument, options);
      if (
        !isComparisonText(raw.firstLabel, MAX_COMPARISON_LABEL_LENGTH) ||
        !isComparisonText(raw.secondLabel, MAX_COMPARISON_LABEL_LENGTH)
      ) {
        reject("a comparison needs bounded non-blank side labels");
      }
      if (raw.title != null && !isComparisonText(raw.title, MAX_COMPARISON_TITLE_LENGTH)) {
        reject("a comparison title must be bounded and non-blank");
      }
      return {
        type: "image-comparison",
        first,
        second,
        firstLabel: raw.firstLabel,
        secondLabel: raw.secondLabel,
        ...(raw.title == null ? {} : { title: raw.title as string }),
        key,
      };
    }
    case CONTENT_BLOCK_OBJECT_TYPES.paragraph: {
      const text = readString(raw.text);
      if (text === undefined) reject("a paragraph needs non-empty text");
      return { type: "paragraph", text, key };
    }

    case CONTENT_BLOCK_OBJECT_TYPES.heading: {
      const text = readString(raw.text);
      if (text === undefined) reject("a heading needs non-empty text");
      if (raw.level !== 2 && raw.level !== 3 && raw.level !== 4) {
        reject("a heading needs level 2, 3, or 4");
      }
      return { type: "heading", level: raw.level, text, key };
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
      return { type: "list", ordered: raw.ordered, items: raw.items, key };
    }

    case CONTENT_BLOCK_OBJECT_TYPES.blockquote: {
      const text = readString(raw.text);
      if (text === undefined) reject("a quote needs non-empty text");
      const attribution = readString(raw.attribution);
      return {
        type: "blockquote",
        text,
        key,
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
      return { type: "media", media, key };
    }

    case CONTENT_BLOCK_OBJECT_TYPES["mini-gallery"]: {
      if (
        !Array.isArray(raw.images) ||
        raw.images.length === 0 ||
        raw.images.length > MAX_MINI_GALLERY_ITEMS
      ) {
        reject("a mini-gallery needs between 1 and 12 images");
      }
      const title = readString(raw.title);
      if (
        raw.title != null &&
        (title === undefined || title.length > MAX_MINI_GALLERY_TITLE_LENGTH)
      ) {
        reject("a mini-gallery title must be non-blank and at most 120 characters");
      }
      const seen = new Set<string>();
      const items = raw.images.map((entry) => {
        if (!isRecord(entry) || !isRecord(entry.media)) {
          reject("a mini-gallery image has no resolved media reference");
        }
        const itemKey = readString(entry._key);
        if (itemKey === undefined || seen.has(itemKey)) {
          reject("mini-gallery images need unique stable keys");
        }
        seen.add(itemKey);
        // The same fail-closed public derivative boundary as loose body images.
        const media = projectPublicMedia(
          entry.media as RawPublicMediaDocument,
          options,
        );
        return { key: itemKey, media };
      });
      return {
        type: "mini-gallery",
        key,
        items,
        ...(title === undefined ? {} : { title }),
      };
    }

    case CONTENT_BLOCK_OBJECT_TYPES.table: {
      const { headers, rows, caption } = projectTableFields(raw, reject);
      return {
        type: "table",
        headers,
        rows,
        key,
        ...(caption === undefined ? {} : { caption }),
      };
    }

    case CONTENT_BLOCK_OBJECT_TYPES["tab-group"]: {
      if (
        !Array.isArray(raw.tabs) ||
        raw.tabs.length < MIN_TAB_GROUP_TABS ||
        raw.tabs.length > MAX_TAB_GROUP_TABS
      ) {
        reject(`a tab group needs between ${MIN_TAB_GROUP_TABS} and ${MAX_TAB_GROUP_TABS} tabs`);
      }
      const seenTabKeys = new Set<string>();
      const tabs = raw.tabs.map((entry) => {
        if (!isRecord(entry)) reject("a tab needs its label and table");
        const tabKey = readString(entry._key);
        if (tabKey === undefined || seenTabKeys.has(tabKey)) {
          reject("tabs need unique stable keys");
        }
        seenTabKeys.add(tabKey);
        const label = readString(entry.label);
        if (label === undefined || label.length > MAX_TAB_LABEL_LENGTH) {
          reject(`a tab label must be non-blank and at most ${MAX_TAB_LABEL_LENGTH} characters`);
        }
        if (!isRecord(entry.table)) reject("a tab needs its table");
        const { headers, rows, caption } = projectTableFields(entry.table, reject);
        return { key: tabKey, label, table: { headers, rows, ...(caption === undefined ? {} : { caption }) } };
      });
      return { type: "tab-group", tabs, key };
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
      return { type: "youtube", videoId, title, key };
    }

    case CONTENT_BLOCK_OBJECT_TYPES.poll: {
      // The block carries no poll content of its own (ADR-0018 §1) — everything
      // comes from the dereferenced `poll` document, so an unresolved reference
      // (a draft-only or deleted poll) looks exactly like a missing field here.
      if (!isRecord(raw.poll)) {
        reject("a poll block needs its referenced poll to resolve");
      }
      if (!isPollDefinition(raw.poll)) reject("a poll needs valid identities, text, unique options, and a valid closeDate");
      const { pollId, question, closeDate } = raw.poll;
      const options = raw.poll.options.map(({ optionId, label }) => ({ optionId, label }));

      return { type: "poll", pollId, question, closeDate, options, key };
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
 *
 * Sanity's own array editor guarantees each item's `_key` is unique, but that
 * guarantee binds the ordinary Studio editor, not an API import. Two blocks
 * sharing one key is a whole-body defect — checked here, once every block is
 * projected, rather than per block — because a duplicate is exactly the
 * stable identity `ContentBody` hands React as its list `key`, and two
 * elements sharing one silently breaks reconciliation rather than merely
 * failing to render.
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

  const blocks = value.map((raw, index) =>
    projectContentBlock(raw as RawContentBlock, index, options),
  );

  const seenKeys = new Set<string>();
  for (const block of blocks) {
    if (block.key === undefined) continue;
    if (seenKeys.has(block.key)) {
      throw new SanityContentBlockError(
        "malformed-result",
        `more than one body block shares the key "${block.key}"`,
      );
    }
    seenKeys.add(block.key);
  }

  try {
    assertSemanticHeadingOrder(blocks);
  } catch (cause) {
    throw new SanityContentBlockError(
      "non-semantic-heading-order",
      cause instanceof TypeError ? cause.message : String(cause),
    );
  }

  return blocks;
}
