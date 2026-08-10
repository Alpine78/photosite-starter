/**
 * The page-jump navigation ADR-0003 decision 3 derives from a body's structure.
 *
 * The rule is that the navigation is *derived*, not authored: there is no CMS
 * toggle for it, so a body with level-2 headings gets a table of contents and a
 * body without them gets nothing to skip over. The article variant uses the
 * heading half of that rule and omits the grid link it has no grid for.
 *
 * The ids live here rather than in the renderer because two components need the
 * same answer — the navigation writes the fragment and the body writes the
 * anchor — and a mismatch between them is a link that silently goes nowhere.
 * They are derived from the heading text so a shared URL keeps meaning across a
 * rebuild, and de-duplicated by position so two headings reading the same never
 * produce one id twice.
 */

import type { ContentBlock } from "@/lib/content-page";

/** Fragment prefix, so an id is never empty, numeric, or a page-owned id. */
const HEADING_ID_PREFIX = "section";

/** Depth the derived table of contents lists. */
const TOC_HEADING_LEVEL = 2;

export type ContentHeading = {
  /** Fragment id, without the `#`. */
  readonly id: string;
  readonly text: string;
};

/**
 * A stable fragment from heading text.
 *
 * Diacritics are folded rather than dropped so Finnish and English headings
 * both survive as something readable: `Ilta­valo` and `Iltavalo` should not
 * collapse to `-`. Text that leaves nothing behind — punctuation or a script
 * this folding does not cover — falls back to the bare prefix, which the
 * de-duplication below then numbers.
 */
function toFragment(text: string): string {
  const slug = text
    .normalize("NFD")
    // Combining marks left by the decomposition above.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug.length === 0 ? HEADING_ID_PREFIX : `${HEADING_ID_PREFIX}-${slug}`;
}

/**
 * Fragment id per body-block index, for every heading the table of contents
 * lists. Keyed by index so the renderer looks up the block it is on rather than
 * recomputing — and cannot disagree about which repeat it is looking at.
 */
export function buildHeadingIds(
  blocks: readonly ContentBlock[],
): ReadonlyMap<number, string> {
  const ids = new Map<number, string>();
  // Every id already issued, not a count per base slug: a suffixed id competes
  // for the same namespace as an authored one. Headings reading "Gear",
  // "Gear 2", and "Gear" would otherwise hand the third the second's id.
  const issued = new Set<string>();

  blocks.forEach((block, index) => {
    if (block.type !== "heading" || block.level !== TOC_HEADING_LEVEL) return;

    const base = toFragment(block.text);
    let id = base;
    for (let suffix = 2; issued.has(id); suffix += 1) {
      id = `${base}-${suffix}`;
    }

    issued.add(id);
    ids.set(index, id);
  });

  return ids;
}

/**
 * The table of contents itself, in document order. Empty when the body carries
 * no level-2 heading, which is the case ADR-0003 renders no navigation for.
 */
export function listContentHeadings(
  blocks: readonly ContentBlock[],
): readonly ContentHeading[] {
  const ids = buildHeadingIds(blocks);

  return [...ids].flatMap(([index, id]) => {
    const block = blocks[index];
    return block?.type === "heading" ? [{ id, text: block.text }] : [];
  });
}
