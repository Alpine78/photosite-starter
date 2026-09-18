import type { ContentBlock } from "@/lib/content-page";

/**
 * The tab-group body block's own bounds (AB#163, ADR-0020), kept beside the
 * block the way `content-table.ts` and `content-mini-gallery.ts` keep theirs.
 *
 * Both are restated in `sanity/schemas/content-block.ts`, which imports
 * nothing from `src/` (ADR-0006), and a test pins the two copies equal.
 */
export const MIN_TAB_GROUP_TABS = 2;
export const MAX_TAB_GROUP_TABS = 8;
export const MAX_TAB_LABEL_LENGTH = 80;

export type TabGroupBlock = Extract<ContentBlock, { type: "tab-group" }>;
