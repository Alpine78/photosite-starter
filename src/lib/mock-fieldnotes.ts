/**
 * A generated block of short English-only "field note" articles under
 * `cat-gear` and its child `cat-gear-notebook`, sized so `cat-gear`'s
 * aggregated branch listing runs past `MAX_CONTENT_LISTING_PAGE_SIZE` and the
 * category listing continuation (AB#140, ADR-0003 decision 8, ADR-0013) has a
 * real multi-page fixture to walk — in the mock layer and in the JS-disabled
 * `category-continuation.spec.ts`.
 *
 * The three mock modules (`mock-content-tree`, `mock-content-listing`,
 * `mock-content-pages`) each generate their own slice of one note from these
 * shared helpers, so the placement, the card, and the (minimal) body cannot
 * drift apart. `cat-gear` already holds one authored article, so its subtree
 * total is `FIELDNOTE_COUNT + 1`.
 */

/** How many notes to generate. `cat-gear` subtree total is this plus one. */
export const FIELDNOTE_COUNT = 29;

/** Notes 1..this are canonically placed directly in `cat-gear`; the rest in its child. */
const FIELDNOTE_DIRECT_COUNT = 15;

/** `1 -> "01"`, kept two digits so ids and slugs sort the way the numbers do. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function fieldnoteContentId(n: number): string {
  return `content-fieldnote-${pad(n)}`;
}

export function fieldnoteSlug(n: number): string {
  return `fieldnote-${pad(n)}`;
}

export function fieldnoteCanonicalCategoryId(n: number): string {
  return n <= FIELDNOTE_DIRECT_COUNT ? "cat-gear" : "cat-gear-notebook";
}

/**
 * Distinct dates in January 2023, descending with the note number, so every
 * note is older than `cat-gear`'s one authored 2024 article and the aggregated
 * order is fully determined.
 */
export function fieldnotePublishedAt(n: number): string {
  return `2023-01-${pad(FIELDNOTE_COUNT + 1 - n)}`;
}

/** Every note number, `1 .. FIELDNOTE_COUNT`. */
export const FIELDNOTE_NUMBERS: readonly number[] = Array.from(
  { length: FIELDNOTE_COUNT },
  (_, index) => index + 1,
);
