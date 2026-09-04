/**
 * The image placements inside a content body, in authored source order.
 *
 * A body media block is a content placement, never a gallery item (ADR-0003
 * decision 2): it has its own lightbox sequence, separate from a gallery
 * variant's curated grid, sections, and pagination. This module is the one
 * place that sequence is derived, so the server slide builder and the renderer
 * that wires each figure to a slide cannot disagree about which occurrence is
 * at which position.
 *
 * `itemId` is a per-*occurrence* identity, not a media identity. The same
 * photograph may legitimately be placed twice in one body, and focus has to
 * return to the figure the visitor actually opened — so `mediaId` cannot serve
 * here. A block carries a stable store key only when a CMS supplies one
 * (Sanity's array-item `_key`); the mock layer omits it. When it is absent the
 * ordinal among the body's image placements is used, which is stable for a
 * given authored body and derived identically from either source.
 */

import type { ContentBlock } from "@/lib/content-page";
import type { ImageMedia } from "@/lib/media";

/** Fallback identity prefix, kept distinct from any plausible store key. */
const OCCURRENCE_ID_PREFIX = "body-image";

/** One image placed in a content body, tied to its lightbox slide position. */
export type ContentBodyImage = {
  /** Per-occurrence identity: the block's store key, or its image ordinal. */
  readonly itemId: string;
  /** Position in the body's image sequence — the lightbox slide index. */
  readonly index: number;
  readonly media: ImageMedia;
};

/** Whether a block is an image placement the lightbox can present. */
export function isContentBodyImageBlock(
  block: ContentBlock,
): block is Extract<ContentBlock, { type: "media" }> & {
  media: ImageMedia;
} {
  return block.type === "media" && block.media.type === "image";
}

/**
 * The body's image placements keyed by their position in the block array, each
 * with a stable identity and its slide index. Keying by block index lets the
 * renderer look up the block it is on rather than counting images itself and
 * risking a different answer from the slide builder. A video media block is
 * absent rather than carried: it renders nothing today (ADR-0003 decision 2)
 * and must not become a slide.
 */
export function indexContentBodyImages(
  blocks: readonly ContentBlock[],
): ReadonlyMap<number, ContentBodyImage> {
  const byBlock = new Map<number, ContentBodyImage>();

  blocks.forEach((block, blockIndex) => {
    if (!isContentBodyImageBlock(block)) return;

    const index = byBlock.size;
    byBlock.set(blockIndex, {
      itemId: block.key ?? `${OCCURRENCE_ID_PREFIX}-${index}`,
      index,
      media: block.media,
    });
  });

  return byBlock;
}

/**
 * The body's image placements in authored source order — `Map` iteration keeps
 * insertion order, which is block order, which is slide order.
 */
export function listContentBodyImages(
  blocks: readonly ContentBlock[],
): readonly ContentBodyImage[] {
  return [...indexContentBodyImages(blocks).values()];
}
