/**
 * The page-jump navigation ADR-0003 decision 3 derives from a body's structure.
 *
 * The rule is that the navigation is *derived*, not authored: there is no CMS
 * toggle for it, so a body with headings gets a table of contents and a body
 * without them gets nothing to skip over. The article variant uses the
 * heading half of that rule and omits the grid link it has no grid for.
 *
 * The ids live here rather than in the renderer because two components need the
 * same answer — the navigation writes the fragment and the body writes the
 * anchor — and a mismatch between them is a link that silently goes nowhere.
 * They are derived from the heading text so a shared URL keeps meaning across a
 * rebuild, and de-duplicated by position so two headings reading the same never
 * produce one id twice.
 *
 * AB#21 widens the table of contents from level-2-only to the full three-level
 * body heading model (h2/h3/h4) `content-page.ts#assertSemanticHeadingOrder`
 * enforces. The one thing that must not move is every id a level-2 heading
 * already produces: `buildHeadingIds` reserves the complete legacy level-2 id
 * set in one pass before a level-3/4 heading can ever compete for the same
 * namespace, so publishing a deeper heading can never rename a published
 * level-2 anchor.
 */

import type { ContentBlock } from "@/lib/content-page";

/** Fragment prefix, so an id is never empty, numeric, or a page-owned id. */
const HEADING_ID_PREFIX = "section";

/** The one heading level the original (pre-AB#21) table of contents listed. */
const LEGACY_TOC_HEADING_LEVEL = 2;

export type ContentHeading = {
  /** Fragment id, without the `#`. */
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3 | 4;
};

/**
 * One heading plus every heading nested beneath it, in authored order.
 * `nestContentHeadings` is the only producer.
 */
export type ContentHeadingNode = ContentHeading & {
  readonly children: readonly ContentHeadingNode[];
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
 * Fragment id per body-block index, for every heading (level 2, 3, or 4) the
 * table of contents lists. Keyed by index so the renderer looks up the block
 * it is on rather than recomputing — and cannot disagree about which repeat
 * it is looking at.
 *
 * Two passes, not one, is the AC4 compatibility requirement made literal:
 * pass one reserves every level-2 id exactly as the original single-level
 * algorithm would (same code, same order, same collisions), so a body
 * carrying only level-2 headings gets byte-identical ids to before this
 * story. Only once that complete legacy set already occupies the shared
 * `issued` namespace does pass two assign ids to level-3/4 headings — so a
 * deeper heading whose slug collides with a level-2 id, including one
 * authored later in the document, is always the one bumped to a suffix,
 * never the reverse. The returned map's *insertion* order therefore no
 * longer equals document order once a body mixes levels; callers that need
 * document order (`listContentHeadings`) derive it themselves rather than
 * trusting map iteration.
 */
export function buildHeadingIds(
  blocks: readonly ContentBlock[],
): ReadonlyMap<number, string> {
  const ids = new Map<number, string>();
  // Every id already issued, not a count per base slug: a suffixed id competes
  // for the same namespace as an authored one. Headings reading "Gear",
  // "Gear 2", and "Gear" would otherwise hand the third the second's id.
  const issued = new Set<string>();

  const assign = (index: number, text: string) => {
    const base = toFragment(text);
    let id = base;
    for (let suffix = 2; issued.has(id); suffix += 1) {
      id = `${base}-${suffix}`;
    }
    issued.add(id);
    ids.set(index, id);
  };

  blocks.forEach((block, index) => {
    if (block.type === "heading" && block.level === LEGACY_TOC_HEADING_LEVEL) {
      assign(index, block.text);
    }
  });

  blocks.forEach((block, index) => {
    if (block.type === "heading" && block.level !== LEGACY_TOC_HEADING_LEVEL) {
      assign(index, block.text);
    }
  });

  return ids;
}

/**
 * The table of contents itself, in authored document order, each entry
 * carrying the level `ContentPageJumpNav`/`nestContentHeadings` nest it by.
 * Empty when the body carries no heading, which is the case ADR-0003 renders
 * no navigation for.
 */
export function listContentHeadings(
  blocks: readonly ContentBlock[],
): readonly ContentHeading[] {
  const ids = buildHeadingIds(blocks);

  return blocks.flatMap((block, index) => {
    const id = ids.get(index);
    if (block.type !== "heading" || id === undefined) return [];
    return [{ id, text: block.text, level: block.level }];
  });
}

/**
 * Projects the flat, authored-order heading list into the nested shape AC5
 * requires: a level-3 entry is a child of the level-2 entry before it, and a
 * level-4 entry a child of the level-3 entry before it. Pure and exported so
 * the tree-shaping rule is unit-testable independent of how it renders.
 *
 * Assumes `content-page.ts#assertSemanticHeadingOrder`'s invariant already
 * held for `headings` — enforced at both the Studio and read boundaries
 * before a body ever reaches this function — so it never has to decide what
 * an impossible skip would nest under.
 */
export function nestContentHeadings(
  headings: readonly ContentHeading[],
): readonly ContentHeadingNode[] {
  type MutableNode = ContentHeading & { children: MutableNode[] };

  const roots: MutableNode[] = [];
  // The currently open ancestor at each depth (0 = level 2, 1 = level 3).
  const openAncestors: MutableNode[] = [];

  for (const heading of headings) {
    const depth = heading.level - LEGACY_TOC_HEADING_LEVEL;
    const node: MutableNode = { ...heading, children: [] };

    // Drop every ancestor at or deeper than this heading — a same-level or
    // shallower heading closes whatever was open beneath its own parent.
    openAncestors.length = depth;
    const parent = openAncestors[depth - 1];
    (parent ? parent.children : roots).push(node);
    openAncestors[depth] = node;
  }

  return roots;
}
