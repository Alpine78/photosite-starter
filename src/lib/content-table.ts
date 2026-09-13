import type { ContentBlock } from "@/lib/content-page";

/**
 * The data table body block's own bounds (AB#22), kept beside the block the
 * way `content-mini-gallery.ts` keeps its own.
 *
 * Both are restated in `sanity/schemas/content-block.ts`, which imports
 * nothing from `src/` (ADR-0006), and `sanity/schemas/content-block.test.ts`
 * pins the two copies equal.
 *
 * A table is an editorial aid for comparison articles, not a data grid: the
 * bounds are what one can read across on a phone and still follow, not a
 * storage limit. Sorting, filtering, and column resizing are deliberately not
 * part of this block.
 */
export const MAX_TABLE_COLUMNS = 8;
export const MAX_TABLE_ROWS = 20;

export type TableBlock = Extract<ContentBlock, { type: "table" }>;
